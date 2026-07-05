import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AuditActor,
  Client,
  Contract,
  Detection,
  InvoiceProposal,
  InvoiceProposalState,
  Meeting,
  MeetingState,
  Task,
  TaskRefType,
  TaskState,
  TaskType,
  Transcript,
  ProposalLine,
} from '../../entities';
import { XeroService } from '../xero/xero.service';
import { AuditService } from '../audit/audit.service';
import type { WriteInvoiceEvidence, XeroLineItem } from '../xero/xero-api';
import {
  ProposalActionResultDto,
  ProposalDetailDto,
  ProposalSummaryDto,
} from './dto/proposal-response.dto';
import { ProposalLineDto } from './dto/proposal-line.dto';

const UK_VAT_PCT = 20;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class ProposalsService {
  private readonly log = new Logger('ProposalsService');

  constructor(
    @InjectRepository(InvoiceProposal)
    private readonly proposals: Repository<InvoiceProposal>,
    @InjectRepository(Meeting)
    private readonly meetings: Repository<Meeting>,
    @InjectRepository(Detection)
    private readonly detections: Repository<Detection>,
    @InjectRepository(Client)
    private readonly clients: Repository<Client>,
    @InjectRepository(Contract)
    private readonly contracts: Repository<Contract>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(Transcript)
    private readonly transcripts: Repository<Transcript>,
    private readonly xero: XeroService,
    private readonly audit: AuditService,
  ) {}

  // ---- Reads ---------------------------------------------------------------

  async list(state?: InvoiceProposalState): Promise<ProposalSummaryDto[]> {
    const where = state ? { state } : {};
    const rows = await this.proposals.find({
      where,
      order: { createdAt: 'DESC' },
    });
    const clientIds = [...new Set(rows.map((r) => r.clientId).filter(Boolean))];
    const clientRows = clientIds.length
      ? await this.clients.find({ where: { id: In(clientIds) } })
      : [];
    const nameById = new Map(clientRows.map((c) => [c.id, c.name]));
    return rows.map((p) => this.toSummary(p, nameById.get(p.clientId) ?? 'Unknown client'));
  }

  async detail(id: string): Promise<ProposalDetailDto> {
    const p = await this.proposals.findOne({ where: { id } });
    if (!p) throw new NotFoundException(`Proposal ${id} not found`);

    const client = await this.clients.findOne({ where: { id: p.clientId } });
    const summary = this.toSummary(p, client?.name ?? 'Unknown client');

    // Evidence chain: meeting + transcript, or detection; plus the contract clause.
    let meetingEv: ProposalDetailDto['evidence']['meeting'] = null;
    let transcriptEv: ProposalDetailDto['evidence']['transcript'] = null;
    let detectionEv: ProposalDetailDto['evidence']['detection'] = null;
    let contractEv: ProposalDetailDto['evidence']['contract'] = null;

    if (p.meetingId) {
      const meeting = await this.meetings.findOne({ where: { id: p.meetingId } });
      if (meeting) {
        meetingEv = {
          id: meeting.id,
          title: meeting.title,
          start: meeting.start instanceof Date ? meeting.start.toISOString() : String(meeting.start),
          end: meeting.end instanceof Date ? meeting.end.toISOString() : String(meeting.end),
          durationHours: Number(meeting.durationHours),
          state: meeting.state,
          attendees: (meeting.attendees ?? []).map((a) => a.email),
        };
        const transcript = meeting.transcriptId
          ? await this.transcripts.findOne({ where: { id: meeting.transcriptId } })
          : await this.transcripts.findOne({ where: { meetingId: meeting.id } });
        if (transcript) {
          const scopeQuotes = (transcript.parsed?.scope_items ?? [])
            .filter((s) => s.billable)
            .map((s) => s.evidence_quote);
          transcriptEv = {
            id: transcript.id,
            summary: transcript.parsed?.summary ?? null,
            scopeQuotes,
            excerpt: (transcript.rawText ?? '').slice(0, 600),
          };
        }
      }
    }

    if (p.detectionId) {
      const detection = await this.detections.findOne({ where: { id: p.detectionId } });
      if (detection) {
        detectionEv = {
          id: detection.id,
          type: detection.type,
          valueGbp: Number(detection.valueGbp),
          summary: detection.evidence?.summary ?? '',
        };
      }
    }

    const contract = await this.contracts.findOne({ where: { clientId: p.clientId } });
    if (contract) {
      const firstClause = contract.parsed?.clauses?.[0] ?? null;
      contractEv = {
        contractId: contract.id,
        clauseLabel: firstClause?.ref ?? null,
        clauseText: firstClause?.text ?? null,
      };
    }

    let xeroStatus: string | null = null;
    if (p.xeroInvoiceId) {
      try {
        const inv = await this.xero.getInvoice(p.xeroInvoiceId);
        xeroStatus = inv?.Status ?? null;
      } catch (err) {
        // Xero may not be live — never break the read.
        this.log.warn(`getInvoice failed for ${p.xeroInvoiceId}: ${errMsg(err)}`);
      }
    }

    return {
      ...summary,
      lines: (p.lines ?? []) as unknown as ProposalLineDto[],
      evidence: {
        meeting: meetingEv,
        transcript: transcriptEv,
        detection: detectionEv,
        contract: contractEv,
      },
      xeroStatus,
      xeroError: null,
    };
  }

  // ---- Writes --------------------------------------------------------------

  /** POST /proposals/:id/approve — authorise + send to Xero. */
  async approve(id: string): Promise<ProposalActionResultDto> {
    return this.writeToXero(id, true);
  }

  /** POST /proposals/:id/save-draft — create a DRAFT in Xero, stay IN_REVIEW. */
  async saveDraft(id: string): Promise<ProposalActionResultDto> {
    return this.writeToXero(id, false);
  }

  private async writeToXero(id: string, authorise: boolean): Promise<ProposalActionResultDto> {
    const p = await this.proposals.findOne({ where: { id } });
    if (!p) throw new NotFoundException(`Proposal ${id} not found`);
    if (p.state === InvoiceProposalState.REJECTED) {
      throw new BadRequestException(`Proposal ${id} was rejected and cannot be written to Xero`);
    }

    const client = await this.clients.findOne({ where: { id: p.clientId } });
    const contract = await this.contracts.findOne({ where: { clientId: p.clientId } });

    // Ensure a stable idempotency reference exists (rule 6 of BUILD_SPEC).
    if (!p.reference) {
      const seed = p.meetingId ?? p.detectionId ?? p.id;
      p.reference = `ROBYN-${seed.replace(/-/g, '').slice(0, 12)}`;
    }

    const accountCode = await this.defaultAccountCode();
    const lineItems: XeroLineItem[] = (p.lines ?? []).map((l) => ({
      Description: l.description,
      Quantity: Number(l.quantity),
      UnitAmount: Number(l.unit_amount),
      AccountCode: l.account_code ?? accountCode,
      ...(l.tax_type ? { TaxType: l.tax_type } : {}),
    }));

    const decisionNote = this.buildDecisionNote(p, client, authorise);
    const evidence = await this.buildEvidence(p, contract);
    // Contract-stated payment terms drive the DueDate (e.g. due in 7 days).
    const termsDays = contract?.parsed?.billing_rules?.paymentTermsDays ?? null;

    try {
      const result = await this.xero.writeInvoice({
        clientName: client?.name ?? 'Client',
        clientEmail: client?.emails?.[0],
        existingContactId: client?.xeroContactId ?? undefined,
        reference: p.reference,
        lines: lineItems,
        currency: p.currency ?? 'GBP',
        dueDate: termsDays != null ? isoDateInDays(termsDays) : undefined,
        authorise,
        decisionNote,
        evidence,
      });

      p.xeroInvoiceId = result.invoiceId;
      p.xeroInvoiceNumber = result.invoiceNumber;
      p.xeroDeepLink = result.deepLink;

      if (authorise) {
        p.state = InvoiceProposalState.SENT;
      } else if (p.state === InvoiceProposalState.DRAFT) {
        // A saved draft is now awaiting a human's approve — surface it for review.
        p.state = InvoiceProposalState.IN_REVIEW;
      }
      await this.proposals.save(p);

      if (authorise) {
        await this.resolveReviewTask(p.id, 'Approved and sent to Xero');
        await this.markMeetingSent(p.meetingId);
      }

      await this.audit.record({
        actor: authorise ? AuditActor.HUMAN : AuditActor.ROBYN,
        action: authorise ? 'proposal.approved' : 'proposal.saved_draft',
        summary: authorise
          ? `Approved proposal ${p.reference} for ${client?.name ?? 'client'}, AUTHORISED in Xero (${result.deepLink})`
          : `Saved proposal ${p.reference} for ${client?.name ?? 'client'} as a Xero DRAFT (${result.deepLink})`,
        subjectType: 'proposal',
        subjectId: p.id,
        inputs: {
          authorise,
          xeroInvoiceId: result.invoiceId,
          xeroInvoiceNumber: result.invoiceNumber,
          total: Number(p.total),
          alreadyExisted: result.alreadyExisted,
        },
      });

      // Email the authorised invoice to the client via Xero. Best-effort by
      // design: a failure here never fails the approve — the invoice is
      // already AUTHORISED and stays that way.
      let emailNote = '';
      if (authorise) {
        emailNote = await this.emailInvoiceViaXero(
          p,
          client?.emails?.[0],
          result.invoiceId,
          result.invoiceNumber ?? result.invoiceId,
        );
      }

      return {
        id: p.id,
        state: p.state,
        xeroWritten: true,
        xeroInvoiceId: p.xeroInvoiceId,
        xeroInvoiceNumber: p.xeroInvoiceNumber,
        xeroDeepLink: p.xeroDeepLink,
        xeroError: null,
        emailedAt: p.emailedAt ? new Date(p.emailedAt).toISOString() : null,
        subtotal: Number(p.subtotal),
        taxTotal: Number(p.taxTotal),
        total: Number(p.total),
        message: authorise
          ? `Invoice authorised and sent to Xero.${emailNote}`
          : 'Draft invoice created in Xero. Still awaiting your approval to send.',
      };
    } catch (err) {
      // Xero may be down / creds pending: keep local state, surface the error,
      // record it, and return a normal (non-500) response.
      const message = errMsg(err);
      if (p.state === InvoiceProposalState.DRAFT) {
        p.state = InvoiceProposalState.IN_REVIEW;
      }
      await this.proposals.save(p);
      // Keep the REVIEW_INVOICE task OPEN so the human can retry.
      if (p.state === InvoiceProposalState.IN_REVIEW) {
        await this.raiseReviewTaskIfMissing(p, client?.name ?? 'client');
      }
      await this.audit.record({
        actor: AuditActor.XERO,
        action: authorise ? 'proposal.approve_failed' : 'proposal.save_draft_failed',
        summary: `Xero write failed for proposal ${p.reference} (${client?.name ?? 'client'}): ${message}`,
        subjectType: 'proposal',
        subjectId: p.id,
        inputs: { authorise, error: message },
      });

      return {
        id: p.id,
        state: p.state,
        xeroWritten: false,
        xeroInvoiceId: p.xeroInvoiceId ?? null,
        xeroInvoiceNumber: p.xeroInvoiceNumber ?? null,
        xeroDeepLink: p.xeroDeepLink ?? null,
        xeroError: message,
        emailedAt: p.emailedAt ? new Date(p.emailedAt).toISOString() : null,
        subtotal: Number(p.subtotal),
        taxTotal: Number(p.taxTotal),
        total: Number(p.total),
        message: `Xero write failed. Proposal kept in review. ${message}`,
      };
    }
  }

  /**
   * Ask Xero to email an authorised invoice to the client's address
   * (POST /Invoices/{id}/Email). Best-effort: never throws, audits every
   * outcome, and returns a sentence fragment for the action message.
   */
  private async emailInvoiceViaXero(
    p: InvoiceProposal,
    clientEmail: string | undefined,
    invoiceId: string,
    invoiceLabel: string,
  ): Promise<string> {
    if (p.emailedAt) return ' Already emailed to the client earlier.';
    if (!clientEmail) {
      await this.audit.record({
        actor: AuditActor.ROBYN,
        action: 'xero.invoice.email_skipped',
        summary: `Invoice ${invoiceLabel} was not emailed: the client has no email address on file.`,
        subjectType: 'proposal',
        subjectId: p.id,
        inputs: { invoiceId },
      });
      return ' Not emailed: the client has no email address on file.';
    }
    try {
      await this.xero.emailInvoice(invoiceId);
      p.emailedAt = new Date();
      await this.proposals.save(p);
      await this.audit.record({
        actor: AuditActor.XERO,
        action: 'xero.invoice.emailed',
        summary: `Invoice ${invoiceLabel} emailed to ${clientEmail} via Xero.`,
        subjectType: 'proposal',
        subjectId: p.id,
        inputs: { invoiceId, email: clientEmail },
      });
      return ` Emailed to ${clientEmail} via Xero.`;
    } catch (err) {
      const reason = errMsg(err).slice(0, 300);
      await this.audit.record({
        actor: AuditActor.XERO,
        action: 'xero.invoice.email_failed',
        summary: `Xero accepted the invoice but the email step failed: ${reason}`,
        subjectType: 'proposal',
        subjectId: p.id,
        inputs: { invoiceId, email: clientEmail, error: reason },
      });
      return ` The invoice is authorised, but the email step failed: ${reason}`;
    }
  }

  /** POST /proposals/:id/reject */
  async reject(id: string, reason: string): Promise<ProposalActionResultDto> {
    const p = await this.proposals.findOne({ where: { id } });
    if (!p) throw new NotFoundException(`Proposal ${id} not found`);
    if (p.state === InvoiceProposalState.SENT) {
      throw new BadRequestException(`Proposal ${id} was already sent to Xero and cannot be rejected`);
    }

    p.state = InvoiceProposalState.REJECTED;
    await this.proposals.save(p);
    await this.resolveReviewTask(p.id, `Rejected: ${reason}`);

    await this.audit.record({
      actor: AuditActor.HUMAN,
      action: 'proposal.rejected',
      summary: `Rejected proposal ${p.reference ?? p.id}: ${reason}`,
      subjectType: 'proposal',
      subjectId: p.id,
      inputs: { reason },
    });

    return {
      id: p.id,
      state: p.state,
      xeroWritten: false,
      xeroInvoiceId: p.xeroInvoiceId ?? null,
      xeroInvoiceNumber: p.xeroInvoiceNumber ?? null,
      xeroDeepLink: p.xeroDeepLink ?? null,
      xeroError: null,
      emailedAt: p.emailedAt ? new Date(p.emailedAt).toISOString() : null,
      subtotal: Number(p.subtotal),
      taxTotal: Number(p.taxTotal),
      total: Number(p.total),
      message: 'Proposal rejected.',
    };
  }

  /** PATCH /proposals/:id/lines — edit lines, recompute totals. */
  async patchLines(id: string, lines: ProposalLineDto[]): Promise<ProposalActionResultDto> {
    const p = await this.proposals.findOne({ where: { id } });
    if (!p) throw new NotFoundException(`Proposal ${id} not found`);
    if (p.state === InvoiceProposalState.SENT) {
      throw new BadRequestException(`Proposal ${id} was already sent to Xero and cannot be edited`);
    }
    if (p.state === InvoiceProposalState.REJECTED) {
      throw new BadRequestException(`Proposal ${id} was rejected and cannot be edited`);
    }

    // Recompute each line_amount deterministically, then the running totals.
    const rebuilt: ProposalLine[] = lines.map((l) => {
      const quantity = Number(l.quantity);
      const unit_amount = Number(l.unit_amount);
      return {
        description: l.description,
        quantity,
        unit_amount,
        account_code: l.account_code,
        tax_type: l.tax_type,
        line_amount: round2(quantity * unit_amount),
        provenance: (l.provenance ?? []).map((pr) => ({
          kind: pr.kind,
          label: pr.label,
          detail: pr.detail,
          source_ref: pr.source_ref,
        })),
      };
    });

    // Preserve the original tax treatment (0% stays 0%, 20% stays 20%).
    const prevSubtotal = Number(p.subtotal);
    const prevTax = Number(p.taxTotal);
    const taxRatePct = prevSubtotal > 0 ? (prevTax / prevSubtotal) * 100 : UK_VAT_PCT;

    const subtotal = round2(rebuilt.reduce((s, l) => s + l.line_amount, 0));
    const taxTotal = round2((subtotal * taxRatePct) / 100);
    const total = round2(subtotal + taxTotal);

    p.lines = rebuilt;
    p.subtotal = subtotal;
    p.taxTotal = taxTotal;
    p.total = total;
    await this.proposals.save(p);

    await this.audit.record({
      actor: AuditActor.HUMAN,
      action: 'proposal.lines_edited',
      summary: `Edited lines on proposal ${p.reference ?? p.id}: new total ${total} ${p.currency}`,
      subjectType: 'proposal',
      subjectId: p.id,
      inputs: { lineCount: rebuilt.length, subtotal, taxTotal, total },
    });

    return {
      id: p.id,
      state: p.state,
      xeroWritten: false,
      xeroInvoiceId: p.xeroInvoiceId ?? null,
      xeroInvoiceNumber: p.xeroInvoiceNumber ?? null,
      xeroDeepLink: p.xeroDeepLink ?? null,
      xeroError: null,
      emailedAt: p.emailedAt ? new Date(p.emailedAt).toISOString() : null,
      subtotal,
      taxTotal,
      total,
      message: 'Lines updated and totals recomputed.',
    };
  }

  // ---- Helpers -------------------------------------------------------------

  private toSummary(p: InvoiceProposal, clientName: string): ProposalSummaryDto {
    return {
      id: p.id,
      clientId: p.clientId,
      clientName,
      source: p.meetingId ? 'meeting' : 'detection',
      meetingId: p.meetingId,
      detectionId: p.detectionId,
      currency: p.currency ?? 'GBP',
      subtotal: Number(p.subtotal),
      taxTotal: Number(p.taxTotal),
      total: Number(p.total),
      state: p.state,
      policyResult: {
        auto: p.policyResult?.auto ?? false,
        reasons: p.policyResult?.reasons ?? [],
      },
      lineCount: (p.lines ?? []).length,
      autoSent: p.autoSent,
      emailedAt: p.emailedAt ? new Date(p.emailedAt).toISOString() : null,
      reference: p.reference,
      xeroInvoiceId: p.xeroInvoiceId,
      xeroInvoiceNumber: p.xeroInvoiceNumber,
      xeroDeepLink: p.xeroDeepLink,
      createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
    };
  }

  private buildDecisionNote(
    p: InvoiceProposal,
    client: Client | null,
    authorise: boolean,
  ): string {
    const lineParts = (p.lines ?? []).map((l) => {
      const labels = (l.provenance ?? []).map((pr) => pr.label).filter(Boolean).join(', ');
      return labels ? `${l.description} [${labels}]` : l.description;
    });
    const reasons = (p.policyResult?.reasons ?? []).join('; ');
    const tail = authorise
      ? `Autonomy ${client?.autonomyEnabled ? 'ON → auto-sent' : 'OFF → human approved'}.`
      : 'Saved as a draft for human review.';
    return [
      `Robyn invoice ${p.reference ?? p.id} for ${client?.name ?? 'client'}.`,
      lineParts.length ? `Lines: ${lineParts.join('; ')}.` : '',
      reasons ? `Policy: ${reasons}.` : '',
      tail,
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 2400);
  }

  private async buildEvidence(
    p: InvoiceProposal,
    contract: Contract | null,
  ): Promise<WriteInvoiceEvidence[]> {
    const evidence: WriteInvoiceEvidence[] = [];

    // Transcript excerpt (calendar-sourced proposals).
    if (p.meetingId) {
      const meeting = await this.meetings.findOne({ where: { id: p.meetingId } });
      const transcript = meeting?.transcriptId
        ? await this.transcripts.findOne({ where: { id: meeting.transcriptId } })
        : await this.transcripts.findOne({ where: { meetingId: p.meetingId } });
      if (transcript) {
        const quotes = (transcript.parsed?.scope_items ?? [])
          .filter((s) => s.billable)
          .map((s) => `- ${s.description}: "${s.evidence_quote}"`)
          .join('\n');
        const body = [
          transcript.parsed?.summary ? `Summary: ${transcript.parsed.summary}` : '',
          quotes ? `Billable scope:\n${quotes}` : '',
          `Excerpt:\n${(transcript.rawText ?? '').slice(0, 1200)}`,
        ]
          .filter(Boolean)
          .join('\n\n');
        evidence.push({ filename: 'robyn-transcript-excerpt.txt', text: body });
      }
    }

    // Contract clause (the rate citation).
    if (contract) {
      const clauses = (contract.parsed?.clauses ?? [])
        .map((c) => `${c.ref}: ${c.text}`)
        .join('\n');
      const body = [
        contract.title ? `Contract: ${contract.title}` : '',
        clauses || (contract.rawText ?? '').slice(0, 1200),
      ]
        .filter(Boolean)
        .join('\n\n');
      if (body.trim()) {
        evidence.push({ filename: 'robyn-contract-clause.txt', text: body });
      }
    }

    return evidence;
  }

  private async defaultAccountCode(): Promise<string> {
    try {
      return await this.xero.defaultSalesAccountCode();
    } catch {
      return '200';
    }
  }

  private async resolveReviewTask(proposalId: string, resolution: string): Promise<void> {
    const task = await this.tasks.findOne({
      where: {
        type: TaskType.REVIEW_INVOICE,
        refId: proposalId,
        state: TaskState.OPEN,
      },
    });
    if (!task) return;
    task.state = TaskState.RESOLVED;
    task.resolvedAt = new Date();
    task.resolution = resolution;
    await this.tasks.save(task);
  }

  private async raiseReviewTaskIfMissing(p: InvoiceProposal, clientName: string): Promise<void> {
    const dedupeKey = `${TaskType.REVIEW_INVOICE}:${p.id}`;
    // dedupeKey is globally unique — reuse (and reopen) any existing row.
    const existing = await this.tasks.findOne({ where: { dedupeKey } });
    if (existing) {
      if (existing.state !== TaskState.OPEN) {
        existing.state = TaskState.OPEN;
        existing.resolvedAt = null;
        existing.resolution = null;
        await this.tasks.save(existing);
      }
      return;
    }
    const task = this.tasks.create({
      type: TaskType.REVIEW_INVOICE,
      refType: TaskRefType.PROPOSAL,
      refId: p.id,
      state: TaskState.OPEN,
      title: `Review invoice for ${clientName}`,
      summary: `Proposal ${p.reference ?? p.id} needs review (£${Number(p.total)}).`,
      context: {
        proposalId: p.id,
        clientName,
        total: Number(p.total),
        currency: p.currency,
      },
      dedupeKey,
    });
    await this.tasks.save(task);
  }

  private async markMeetingSent(meetingId: string | null): Promise<void> {
    if (!meetingId) return;
    const meeting = await this.meetings.findOne({ where: { id: meetingId } });
    if (!meeting) return;
    meeting.state = MeetingState.SENT;
    await this.meetings.save(meeting);
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** YYYY-MM-DD (UTC) a number of days from today — contract payment terms. */
function isoDateInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
