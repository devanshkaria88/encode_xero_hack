import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import {
  AuditActor,
  Client,
  Detection,
  DetectionState,
  DetectionType,
  DetectionEvidence,
  InvoiceProposal,
  InvoiceProposalState,
  ProposalLine,
  ProvenanceKind,
  Task,
  TaskRefType,
  TaskState,
  TaskType,
} from '../../entities';
import { XeroService } from '../xero/xero.service';
import { AuditService } from '../audit/audit.service';
import {
  DetectionActionResultDto,
  DetectionDto,
  DetectionProposeResultDto,
  RunDetectorsResultDto,
} from './dto/detection-response.dto';

const UK_VAT_PCT = 20;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A detector's proposed row before it is persisted (dedupe + audit happen once,
// centrally, in persistCandidates).
interface Candidate {
  type: DetectionType;
  clientId: string | null;
  valueGbp: number;
  evidence: DetectionEvidence;
  dedupeKey: string;
}

// Loop 3: the three deterministic ledger detectors. Every detector reads Xero
// when it is live and falls back to LOCAL Postgres/seed data when it is not, so
// the recovery loop always demos. The detectors PROPOSE money to recover; they
// never write to Xero. Each new detection records an AuditEvent, and re-running
// is idempotent via the unique Detection.dedupeKey.
@Injectable()
export class DetectionsService {
  private readonly log = new Logger('DetectionsService');

  constructor(
    @InjectRepository(Detection)
    private readonly detections: Repository<Detection>,
    @InjectRepository(Client)
    private readonly clients: Repository<Client>,
    @InjectRepository(InvoiceProposal)
    private readonly proposals: Repository<InvoiceProposal>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    private readonly xero: XeroService,
    private readonly audit: AuditService,
  ) {}

  // ---- Run the three detectors --------------------------------------------

  async runDetectors(): Promise<RunDetectorsResultDto> {
    const ranAt = new Date();
    const clients = await this.clients.find();

    // Probe Xero once. Even when it reports LIVE each call is still wrapped, so
    // a mid-run failure degrades to the local path rather than 500-ing.
    let xeroLive = false;
    try {
      xeroLive = (await this.xero.health()).ok;
    } catch (err) {
      this.log.warn(`Xero health probe failed: ${errMsg(err)}`);
    }

    const candidates: Candidate[] = [];
    const usedXero = { value: false };
    const usedLocal = { value: false };

    for (const detect of [
      () => this.detectQuoteNotInvoiced(clients, xeroLive, usedXero, usedLocal),
      () => this.detectRetainerStopped(clients, xeroLive, usedXero, usedLocal),
      () => this.detectExpenseNotRecharged(clients, usedLocal),
    ]) {
      try {
        candidates.push(...(await detect()));
      } catch (err) {
        // A detector must never sink the whole run.
        this.log.warn(`Detector failed: ${errMsg(err)}`);
      }
    }

    const { created, skipped } = await this.persistCandidates(candidates);

    const counts = {
      QUOTE_NOT_INVOICED: created.filter((d) => d.type === DetectionType.QUOTE_NOT_INVOICED).length,
      RETAINER_STOPPED: created.filter((d) => d.type === DetectionType.RETAINER_STOPPED).length,
      EXPENSE_NOT_RECHARGED: created.filter((d) => d.type === DetectionType.EXPENSE_NOT_RECHARGED).length,
    };

    const source =
      usedXero.value && usedLocal.value ? 'mixed' : usedXero.value ? 'xero' : 'local';

    const nameById = new Map(clients.map((c) => [c.id, c.name]));
    const detections = created.map((d) => this.toDto(d, nameById.get(d.clientId ?? '') ?? 'Unknown client', null));

    await this.audit.record({
      actor: AuditActor.ROBYN,
      action: 'detections.run',
      summary:
        `Ledger detectors ran (${source}): ${created.length} new detection(s), ${skipped} already known ` +
        `(quotes ${counts.QUOTE_NOT_INVOICED}, retainers ${counts.RETAINER_STOPPED}, expenses ${counts.EXPENSE_NOT_RECHARGED}).`,
      subjectType: 'detection',
      inputs: { source, created: created.length, skipped, counts },
    });

    return {
      source,
      created: created.length,
      skipped,
      counts,
      detections,
      ranAt: ranAt.toISOString(),
      message:
        created.length > 0
          ? `Found ${created.length} new recoverable item(s) worth £${round2(created.reduce((s, d) => s + Number(d.valueGbp), 0))}.`
          : 'No new leaks found. Everything billable is accounted for.',
    };
  }

  // ---- Detector 1: accepted quote never invoiced --------------------------

  private async detectQuoteNotInvoiced(
    clients: Client[],
    xeroLive: boolean,
    usedXero: { value: boolean },
    usedLocal: { value: boolean },
  ): Promise<Candidate[]> {
    // Gather accepted quotes from Xero, else from a local seed fixture.
    type QuoteRow = {
      id: string;
      number: string;
      contactName: string;
      total: number;
      reference: string;
    };
    let quotes: QuoteRow[] = [];
    let source: 'xero' | 'local' = 'local';

    if (xeroLive) {
      try {
        const raw = await this.xero.listQuotes('ACCEPTED');
        quotes = raw.map((q) => ({
          id: q.QuoteID ?? q.QuoteNumber ?? '',
          number: q.QuoteNumber ?? q.QuoteID ?? '',
          contactName: q.Contact?.Name ?? '',
          total: Number(q.Total ?? 0),
          reference: q.Reference ?? '',
        }));
        source = 'xero';
        usedXero.value = true;
      } catch (err) {
        this.log.warn(`listQuotes failed, using local quote fixture: ${errMsg(err)}`);
      }
    }
    if (source === 'local') {
      const rawFixtures = await this.readJsonFixture(['quotes.json']);
      quotes = rawFixtures
        // Keep ACCEPTED rows; if no status field is present, assume seedable.
        .filter((r) => {
          const st = this.str(r, 'status', 'Status');
          return st ? st.toUpperCase() === 'ACCEPTED' : true;
        })
        .map((r) => ({
          id: this.str(r, 'quoteId', 'QuoteID', 'id', 'quoteNumber', 'number'),
          number: this.str(r, 'quoteNumber', 'QuoteNumber', 'number', 'id'),
          contactName: this.str(r, 'contactName', 'clientName', 'ContactName', 'name'),
          total: this.num(r, 'total', 'Total', 'amount', 'value'),
          reference: this.str(r, 'reference', 'Reference'),
        }));
      if (quotes.length > 0) usedLocal.value = true;
    }

    if (quotes.length === 0) return [];

    // Which quotes are already invoiced? Reference strings from live ACCREC
    // invoices + local proposals; a quote is invoiced if its number/reference
    // shows up in one of them.
    const invoicedRefs = new Set<string>();
    if (xeroLive) {
      try {
        const { invoices } = await this.xero.listInvoices(['SUBMITTED', 'AUTHORISED', 'PAID', 'DRAFT']);
        for (const inv of invoices) {
          if (inv.Reference) invoicedRefs.add(inv.Reference.toLowerCase());
        }
        usedXero.value = true;
      } catch (err) {
        this.log.warn(`listInvoices failed while checking quotes: ${errMsg(err)}`);
      }
    }
    const localProposals = await this.proposals.find();
    for (const p of localProposals) {
      if (p.reference) invoicedRefs.add(p.reference.toLowerCase());
    }

    const isInvoiced = (q: QuoteRow): boolean => {
      const needles = [q.number, q.reference].map((s) => s.toLowerCase()).filter(Boolean);
      for (const ref of invoicedRefs) {
        if (needles.some((n) => ref.includes(n))) return true;
      }
      return false;
    };

    const out: Candidate[] = [];
    for (const q of quotes) {
      if (isInvoiced(q)) continue;
      const clientId = this.resolveClientIdByName(clients, q.contactName);
      out.push({
        type: DetectionType.QUOTE_NOT_INVOICED,
        clientId,
        valueGbp: round2(q.total),
        dedupeKey: `${DetectionType.QUOTE_NOT_INVOICED}:${q.id || q.number}`,
        evidence: {
          summary:
            `Accepted quote ${q.number || q.id} for ${q.contactName || 'a client'} (£${round2(q.total)}) ` +
            `was never turned into an invoice.`,
          source,
          quoteId: q.id,
          quoteNumber: q.number,
          contactName: q.contactName,
          total: round2(q.total),
          reference: q.reference || null,
        },
      });
    }
    return out;
  }

  // ---- Detector 2: retainer cadence broke this month ----------------------

  private async detectRetainerStopped(
    clients: Client[],
    xeroLive: boolean,
    usedXero: { value: boolean },
    usedLocal: { value: boolean },
  ): Promise<Candidate[]> {
    const now = new Date();
    const gapMonth = monthKey(now); // e.g. "2026-07"
    const gapLabel = monthLabel(now);

    // Retainer clients: cadence mentions "retainer" or "month".
    const retainerClients = clients.filter((c) => {
      const cadence = (c.billingProfile?.cadence ?? '').toLowerCase();
      return cadence.includes('retainer') || cadence.includes('month');
    });
    if (retainerClients.length === 0) return [];

    // Local SENT history is the reliable seed-backed cadence signal.
    const clientIds = retainerClients.map((c) => c.id);
    const sent = await this.proposals.find({
      where: { clientId: In(clientIds), state: InvoiceProposalState.SENT },
    });
    const monthsByClient = new Map<string, Set<string>>();
    for (const p of sent) {
      const created = p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt);
      const set = monthsByClient.get(p.clientId) ?? new Set<string>();
      set.add(monthKey(created));
      monthsByClient.set(p.clientId, set);
    }

    // When Xero is live, corroborate with the payments feed (best-effort).
    let paymentCount: number | null = null;
    if (xeroLive) {
      try {
        paymentCount = (await this.xero.listPayments()).length;
        usedXero.value = true;
      } catch (err) {
        this.log.warn(`listPayments failed for retainer cadence: ${errMsg(err)}`);
      }
    }

    const out: Candidate[] = [];
    for (const c of retainerClients) {
      const months = monthsByClient.get(c.id) ?? new Set<string>();
      const priorMonths = [...months].filter((m) => m < gapMonth).sort();
      // Need an established cadence (>=2 prior invoiced months) with none this month.
      if (priorMonths.length < 2) continue;
      if (months.has(gapMonth)) continue;

      const expected = Number(c.billingProfile?.rate ?? 0);
      const source: 'xero' | 'local' = paymentCount !== null ? 'xero' : 'local';
      if (source === 'xero') usedXero.value = true;
      else usedLocal.value = true;

      out.push({
        type: DetectionType.RETAINER_STOPPED,
        clientId: c.id,
        valueGbp: round2(expected),
        dedupeKey: `${DetectionType.RETAINER_STOPPED}:${c.id}:${gapMonth}`,
        evidence: {
          summary:
            `${c.name} has invoiced a retainer in ${priorMonths.length} prior month(s) but no invoice was ` +
            `raised for ${gapLabel}. Expected £${round2(expected)}.`,
          source,
          expectedGbp: round2(expected),
          gapMonth,
          gapLabel,
          cadence: c.billingProfile?.cadence ?? null,
          invoicedMonths: priorMonths,
          lastInvoicedMonth: priorMonths[priorMonths.length - 1] ?? null,
          ...(paymentCount !== null ? { xeroPaymentsSeen: paymentCount } : {}),
        },
      });
    }
    return out;
  }

  // ---- Detector 3: billable expense never recharged -----------------------

  private async detectExpenseNotRecharged(
    clients: Client[],
    usedLocal: { value: boolean },
  ): Promise<Candidate[]> {
    // There is no Xero expense read in this project, so recharge detection is
    // driven from local seed data: billable expenses that never made it onto an
    // invoice. Read defensively so a hand-written fixture still loads.
    const rows = await this.readJsonFixture(['expenses.json']);
    if (rows.length === 0) return [];

    const out: Candidate[] = [];
    for (const r of rows) {
      const billable = this.bool(r, 'billable', 'isBillable', 'rechargeable') ?? true;
      const invoiced = this.bool(r, 'invoiced', 'recharged', 'onInvoice') ?? false;
      if (!billable || invoiced) continue;

      const id = this.str(r, 'id', 'expenseId', 'reference', 'Reference');
      const amount = this.num(r, 'amount', 'Amount', 'total', 'value', 'gbp');
      const description = this.str(r, 'description', 'Description', 'name', 'label') || 'Billable expense';
      const clientName = this.str(r, 'clientName', 'contactName', 'client', 'name');
      const clientId = this.str(r, 'clientId') || this.resolveClientIdByName(clients, clientName);

      out.push({
        type: DetectionType.EXPENSE_NOT_RECHARGED,
        clientId: clientId || null,
        valueGbp: round2(amount),
        dedupeKey: `${DetectionType.EXPENSE_NOT_RECHARGED}:${id || `${description}:${amount}`}`,
        evidence: {
          summary:
            `Billable expense "${description}" (£${round2(amount)})${clientName ? ` for ${clientName}` : ''} ` +
            `was never recharged to the client.`,
          source: 'local',
          expenseId: id || null,
          description,
          amount: round2(amount),
          clientName: clientName || null,
        },
      });
    }
    if (out.length > 0) usedLocal.value = true;
    return out;
  }

  // ---- Persist candidates idempotently ------------------------------------

  private async persistCandidates(
    candidates: Candidate[],
  ): Promise<{ created: Detection[]; skipped: number }> {
    const created: Detection[] = [];
    let skipped = 0;

    for (const c of candidates) {
      const existing = await this.detections.findOne({ where: { dedupeKey: c.dedupeKey } });
      if (existing) {
        skipped += 1;
        continue;
      }
      const row = this.detections.create({
        type: c.type,
        clientId: c.clientId,
        valueGbp: round2(c.valueGbp),
        evidence: c.evidence,
        state: DetectionState.OPEN,
        xeroInvoiceId: null,
        dedupeKey: c.dedupeKey,
      });
      const saved = await this.detections.save(row);
      created.push(saved);

      await this.audit.record({
        actor: AuditActor.ROBYN,
        action: 'detection.created',
        summary: `${c.type} detected (£${round2(c.valueGbp)}): ${c.evidence.summary}`,
        subjectType: 'detection',
        subjectId: saved.id,
        inputs: { type: c.type, valueGbp: round2(c.valueGbp), source: c.evidence.source, dedupeKey: c.dedupeKey },
      });
    }

    return { created, skipped };
  }

  // ---- List ---------------------------------------------------------------

  async list(state?: DetectionState, type?: DetectionType): Promise<DetectionDto[]> {
    const where: { state?: DetectionState; type?: DetectionType } = {};
    if (state) where.state = state;
    if (type) where.type = type;
    const rows = await this.detections.find({ where, order: { createdAt: 'DESC' } });

    const clientIds = [...new Set(rows.map((r) => r.clientId).filter((v): v is string => !!v))];
    const clientRows = clientIds.length
      ? await this.clients.find({ where: { id: In(clientIds) } })
      : [];
    const nameById = new Map(clientRows.map((c) => [c.id, c.name]));

    // Link any proposal built from these detections (for the drill-down).
    const detectionIds = rows.map((r) => r.id);
    const proposalRows = detectionIds.length
      ? await this.proposals.find({ where: { detectionId: In(detectionIds) } })
      : [];
    const proposalByDetection = new Map(proposalRows.map((p) => [p.detectionId as string, p.id]));

    return rows.map((d) =>
      this.toDto(
        d,
        d.clientId ? nameById.get(d.clientId) ?? 'Unknown client' : 'Unmatched',
        proposalByDetection.get(d.id) ?? null,
      ),
    );
  }

  // ---- Propose: build an invoice proposal from a detection ----------------

  async propose(id: string): Promise<DetectionProposeResultDto> {
    const detection = await this.detections.findOne({ where: { id } });
    if (!detection) throw new NotFoundException(`Detection ${id} not found`);

    // Idempotent: if we already proposed, return the existing proposal.
    const already = await this.proposals.findOne({ where: { detectionId: detection.id } });
    if (already) {
      return this.proposeResult(detection, already, null, 'This detection was already turned into a proposal.');
    }

    // A proposal must belong to a client (the invoice recipient). An unmatched
    // detection has to be tied to a client before it can be invoiced.
    if (!detection.clientId) {
      throw new BadRequestException(
        `Detection ${id} is not matched to a client, so it cannot be turned into an invoice yet.`,
      );
    }

    const client = await this.clients.findOne({ where: { id: detection.clientId } });
    const value = round2(Number(detection.valueGbp));
    const subtotal = value;
    const taxTotal = round2((subtotal * UK_VAT_PCT) / 100);
    const total = round2(subtotal + taxTotal);

    const accountCode = await this.defaultAccountCode();
    const line: ProposalLine = {
      description: detection.evidence?.summary ?? `${detection.type} recovery`,
      quantity: 1,
      unit_amount: value,
      account_code: accountCode,
      line_amount: value,
      provenance: [
        {
          kind: ProvenanceKind.LEDGER,
          label: detection.type,
          detail: detection.evidence?.summary ?? '',
          source_ref: detection.id,
        },
      ],
    };

    const reference = `ROBYN-DET-${detection.id.slice(0, 8)}`;
    const proposal = this.proposals.create({
      meetingId: null,
      detectionId: detection.id,
      clientId: detection.clientId,
      lines: [line],
      currency: 'GBP',
      subtotal,
      taxTotal,
      total,
      policyResult: {
        auto: false,
        reasons: [
          `Ledger detection (${detection.type}) — a human confirms before this is invoiced.`,
        ],
      },
      state: InvoiceProposalState.IN_REVIEW,
      reference,
      autoSent: false,
    });
    const savedProposal = await this.proposals.save(proposal);

    detection.state = DetectionState.PROPOSED;
    // xeroInvoiceId intentionally stays null — nothing is written to Xero here.
    await this.detections.save(detection);

    const taskId = await this.raiseReviewTask(savedProposal, client?.name ?? 'client', total);

    await this.audit.record({
      actor: AuditActor.ROBYN,
      action: 'detection.proposed',
      summary:
        `Built proposal ${reference} from ${detection.type} for ${client?.name ?? 'unmatched client'} ` +
        `(£${total} incl. VAT). Raised REVIEW_INVOICE for the human.`,
      subjectType: 'detection',
      subjectId: detection.id,
      inputs: { proposalId: savedProposal.id, reference, total, taskId },
    });

    return this.proposeResult(detection, savedProposal, taskId, `Proposal ${reference} is ready for your review.`);
  }

  // ---- Dismiss ------------------------------------------------------------

  async dismiss(id: string, reason?: string): Promise<DetectionActionResultDto> {
    const detection = await this.detections.findOne({ where: { id } });
    if (!detection) throw new NotFoundException(`Detection ${id} not found`);

    detection.state = DetectionState.DISMISSED;
    await this.detections.save(detection);

    await this.audit.record({
      actor: AuditActor.HUMAN,
      action: 'detection.dismissed',
      summary:
        `Dismissed ${detection.type} (£${round2(Number(detection.valueGbp))})` +
        (reason ? `: ${reason}` : '.'),
      subjectType: 'detection',
      subjectId: detection.id,
      inputs: { reason: reason ?? null },
    });

    return {
      id: detection.id,
      state: detection.state,
      message: 'Detection dismissed.',
    };
  }

  // ---- Helpers ------------------------------------------------------------

  private toDto(d: Detection, clientName: string, proposalId: string | null): DetectionDto {
    return {
      id: d.id,
      type: d.type,
      clientId: d.clientId,
      clientName,
      valueGbp: Number(d.valueGbp),
      summary: d.evidence?.summary ?? '',
      source: (d.evidence?.source as string) ?? 'local',
      evidence: (d.evidence ?? {}) as Record<string, unknown>,
      state: d.state,
      proposalId,
      xeroInvoiceId: d.xeroInvoiceId,
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
    };
  }

  private proposeResult(
    detection: Detection,
    proposal: InvoiceProposal,
    taskId: string | null,
    message: string,
  ): DetectionProposeResultDto {
    return {
      detectionId: detection.id,
      detectionState: detection.state,
      proposalId: proposal.id,
      proposalReference: proposal.reference,
      subtotal: Number(proposal.subtotal),
      taxTotal: Number(proposal.taxTotal),
      total: Number(proposal.total),
      taskId,
      message,
    };
  }

  private async raiseReviewTask(
    proposal: InvoiceProposal,
    clientName: string,
    total: number,
  ): Promise<string | null> {
    const dedupeKey = `${TaskType.REVIEW_INVOICE}:${proposal.id}`;
    const existing = await this.tasks.findOne({ where: { dedupeKey } });
    if (existing) return existing.id;

    const task = this.tasks.create({
      type: TaskType.REVIEW_INVOICE,
      refType: TaskRefType.PROPOSAL,
      refId: proposal.id,
      state: TaskState.OPEN,
      title: `Review invoice for ${clientName}`,
      summary: `Ledger recovery proposal ${proposal.reference ?? proposal.id} needs review (£${round2(total)}).`,
      context: {
        proposalId: proposal.id,
        detectionId: proposal.detectionId,
        clientName,
        total: round2(total),
        currency: proposal.currency,
        actionEndpoint: `/api/proposals/${proposal.id}/approve`,
        rejectEndpoint: `/api/proposals/${proposal.id}/reject`,
      },
      dedupeKey,
    });
    const saved = await this.tasks.save(task);
    return saved.id;
  }

  private async defaultAccountCode(): Promise<string> {
    try {
      return await this.xero.defaultSalesAccountCode();
    } catch {
      return '200';
    }
  }

  private resolveClientIdByName(clients: Client[], name: string): string | null {
    const needle = (name ?? '').trim().toLowerCase();
    if (!needle) return null;
    const match = clients.find(
      (c) => c.name.trim().toLowerCase() === needle || c.name.trim().toLowerCase().includes(needle),
    );
    return match?.id ?? null;
  }

  // --- Local seed fixture reader (mirrors the email fixture pattern) --------
  // Looks for detector source rows the seed writes under seed/data/detections/.
  // Each file is a single object or an array; missing files return [].
  private async readJsonFixture(fileNames: string[]): Promise<Record<string, unknown>[]> {
    const dir = await this.resolveFixtureDir();
    if (!dir) return [];
    const out: Record<string, unknown>[] = [];
    for (const name of fileNames) {
      try {
        const raw = await fs.readFile(path.join(dir, name), 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        const records = Array.isArray(parsed) ? parsed : [parsed];
        for (const rec of records) {
          if (rec && typeof rec === 'object') out.push(rec as Record<string, unknown>);
        }
      } catch {
        // missing / unreadable fixture — treat as empty
      }
    }
    return out;
  }

  private async resolveFixtureDir(): Promise<string | null> {
    const candidates = [
      path.resolve(process.cwd(), 'seed/data/detections'),
      path.resolve(process.cwd(), '../seed/data/detections'),
      path.resolve(__dirname, '../../../../seed/data/detections'),
      path.resolve(__dirname, '../../../../../seed/data/detections'),
    ];
    for (const c of candidates) {
      try {
        const st = await fs.stat(c);
        if (st.isDirectory()) return c;
      } catch {
        // try next
      }
    }
    return null;
  }

  private str(r: Record<string, unknown>, ...keys: string[]): string {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === 'string' && v.trim().length > 0) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return '';
  }

  private num(r: Record<string, unknown>, ...keys: string[]): number {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === 'number' && !Number.isNaN(v)) return v;
      if (typeof v === 'string') {
        const n = Number(v.replace(/[^0-9.\-]/g, ''));
        if (!Number.isNaN(n) && v.trim() !== '') return n;
      }
    }
    return 0;
  }

  private bool(r: Record<string, unknown>, ...keys: string[]): boolean | null {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (['true', 'yes', '1'].includes(s)) return true;
        if (['false', 'no', '0'].includes(s)) return false;
      }
    }
    return null;
  }
}

// --- month helpers -----------------------------------------------------------
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(d: Date): string {
  return d.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}
