import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { z } from 'zod';
import {
  Client,
  Detection,
  DetectionState,
  DetectionType,
  InvoiceProposal,
  InvoiceProposalState,
  Meeting,
  MeetingState,
  Task,
  TaskState,
} from '../../entities';
import { AuditService } from '../audit/audit.service';
import { XeroService } from '../xero/xero.service';

// Robyn chat's READ-ONLY tool belt. Every tool queries existing rows or does a
// live Xero read via XeroService. No writes, no state transitions, no LLM
// calls in here — the model asks, this module fetches, the model explains.
// Every input is zod-validated before execution; failures come back as an
// {error} payload the model can recover from (never a thrown 500).

export interface ChatToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatToolOutcome {
  content: string; // compact JSON
  isError: boolean;
}

// Meeting states whose work is still recoverable and carries no proposal yet
// (mirrors the dashboard leak-strip bucketing; INVOICE_PROPOSED is counted in
// the in-review bucket to avoid double counting).
const UNBILLED_MEETING_STATES: MeetingState[] = [
  MeetingState.DETECTED,
  MeetingState.AWAITING_TRANSCRIPT,
  MeetingState.TRANSCRIPT_ATTACHED,
  MeetingState.CLIENT_MATCHED,
];

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// Xero's Accounting API serialises dates as /Date(1718150400000+0000)/.
function parseXeroDate(raw?: string): string | null {
  if (!raw) return null;
  const m = /\/Date\((\d+)/.exec(raw);
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ---- zod input schemas (validated before any tool executes) ----------------

const NoInput = z.object({}).strip();
const ListProposalsInput = z.object({ state: z.nativeEnum(InvoiceProposalState).optional() }).strip();
const GetProposalInput = z.object({ id: z.string().uuid() }).strip();
const ListDetectionsInput = z
  .object({ state: z.nativeEnum(DetectionState).optional(), type: z.nativeEnum(DetectionType).optional() })
  .strip();
const ListMeetingsInput = z
  .object({
    state: z.nativeEnum(MeetingState).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .strip();
const UtilisationInput = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM').optional() }).strip();
const ClientRevenueInput = z.object({ topN: z.number().int().min(1).max(25).optional() }).strip();
const PageInput = z.object({ page: z.number().int().min(1).max(10).optional() }).strip();
const AgedReceivablesInput = z.object({ clientId: z.string().uuid() }).strip();
const AuditTrailInput = z.object({ limit: z.number().int().min(1).max(200).optional() }).strip();

@Injectable()
export class ChatToolsService {
  constructor(
    @InjectRepository(Meeting) private readonly meetings: Repository<Meeting>,
    @InjectRepository(Client) private readonly clients: Repository<Client>,
    @InjectRepository(InvoiceProposal) private readonly proposals: Repository<InvoiceProposal>,
    @InjectRepository(Detection) private readonly detections: Repository<Detection>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    private readonly xero: XeroService,
    private readonly audit: AuditService,
  ) {}

  // Tool definitions handed to the Anthropic API. Descriptions are
  // prescriptive about WHEN to call each tool — that measurably lifts
  // should-call rates.
  definitions(): ChatToolDefinition[] {
    const noParams = { type: 'object', properties: {}, additionalProperties: false };
    return [
      {
        name: 'get_dashboard_summary',
        description:
          "Headline stats: open tasks, total unbilled £ exposure, invoices sent this month, client count. Call this first for any broad 'how is my business doing' question.",
        input_schema: noParams,
      },
      {
        name: 'get_leak_breakdown',
        description:
          'Recoverable money this month in £, split across ledger detections, invoices sitting in review, and unbilled meetings. Call when asked where money is leaking or what could still be billed.',
        input_schema: noParams,
      },
      {
        name: 'list_proposals',
        description:
          'List invoice proposals with client name, total and Xero link. Optional state filter: DRAFT, IN_REVIEW, APPROVED, SENT, REJECTED. Call for questions about drafted, pending or sent invoices.',
        input_schema: {
          type: 'object',
          properties: {
            state: { type: 'string', enum: Object.values(InvoiceProposalState), description: 'Filter by proposal state.' },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'get_proposal',
        description:
          'Full detail of one invoice proposal: line items, evidence provenance, policy reasons and Xero references. Call after list_proposals when the user asks about a specific invoice.',
        input_schema: {
          type: 'object',
          properties: { id: { type: 'string', description: 'Proposal id (uuid) from list_proposals.' } },
          required: ['id'],
          additionalProperties: false,
        },
      },
      {
        name: 'list_detections',
        description:
          'Ledger leak detections (QUOTE_NOT_INVOICED, RETAINER_STOPPED, EXPENSE_NOT_RECHARGED) with £ value and state. Call when asked what Robyn found in the ledger or about a specific leak type.',
        input_schema: {
          type: 'object',
          properties: {
            state: { type: 'string', enum: Object.values(DetectionState) },
            type: { type: 'string', enum: Object.values(DetectionType) },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'list_open_tasks',
        description:
          'Open tasks waiting on the user (provide transcript, confirm client match, review invoice, confirm agreement, attach contract). Call for what-needs-my-attention questions.',
        input_schema: noParams,
      },
      {
        name: 'list_meetings',
        description:
          'List calendar meetings with billing state, duration and client. Optional state filter and ISO from/to window on the start time. Call for questions about meetings or unbilled calendar work.',
        input_schema: {
          type: 'object',
          properties: {
            state: { type: 'string', enum: Object.values(MeetingState) },
            from: { type: 'string', description: 'ISO date/datetime lower bound on meeting start.' },
            to: { type: 'string', description: 'ISO date/datetime upper bound on meeting start.' },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'get_meeting_utilisation',
        description:
          "Hours split by billing outcome — billed, unbilled, personal, and per-state — for one month or all time. Call for 'how much of my time got billed' questions.",
        input_schema: {
          type: 'object',
          properties: { month: { type: 'string', description: "Month as YYYY-MM, e.g. '2026-06'. Omit for all time." } },
          additionalProperties: false,
        },
      },
      {
        name: 'get_client_revenue',
        description:
          "Top clients by invoiced (SENT) revenue in £, with proposal counts and unbilled exposure. Call for 'who is my best client' or revenue-mix questions.",
        input_schema: {
          type: 'object',
          properties: { topN: { type: 'integer', minimum: 1, maximum: 25, description: 'How many clients (default 10).' } },
          additionalProperties: false,
        },
      },
      {
        name: 'list_unpaid_invoices',
        description:
          'LIVE from Xero: sales invoices still awaiting payment, with due date, amount due and an overdue flag, plus outstanding totals. Call for cash-flow, unpaid-invoice or overdue questions.',
        input_schema: {
          type: 'object',
          properties: { page: { type: 'integer', minimum: 1, maximum: 10, description: 'Xero page (default 1).' } },
          additionalProperties: false,
        },
      },
      {
        name: 'list_payments',
        description:
          "LIVE from Xero: payments received, grouped by month, plus the most recent payments. Call for 'cash in', 'what got paid' or payment-cadence questions.",
        input_schema: {
          type: 'object',
          properties: { page: { type: 'integer', minimum: 1, maximum: 10, description: 'Xero page (default 1).' } },
          additionalProperties: false,
        },
      },
      {
        name: 'get_aged_receivables',
        description:
          'LIVE from Xero: the aged receivables report for one client, showing how long their invoices have been outstanding. Needs the Robyn clientId (uuid) from get_client_revenue or list_proposals.',
        input_schema: {
          type: 'object',
          properties: { clientId: { type: 'string', description: 'Robyn client id (uuid).' } },
          required: ['clientId'],
          additionalProperties: false,
        },
      },
      {
        name: 'get_audit_trail',
        description:
          "Robyn's audit trail — every decision, task, poll and Xero write, newest first. Call for 'what has Robyn done' or 'why did that happen' questions.",
        input_schema: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Max events (default 50).' } },
          additionalProperties: false,
        },
      },
    ];
  }

  // Execute one tool. Never throws: bad input or a downstream failure (e.g.
  // Xero down) returns an {error} payload with isError=true so the model can
  // degrade gracefully instead of the stream dying.
  async execute(name: string, input: unknown): Promise<ChatToolOutcome> {
    try {
      const result = await this.run(name, input);
      return { content: JSON.stringify(result), isError: false };
    } catch (e) {
      const message =
        e instanceof z.ZodError
          ? `Invalid tool input: ${e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`
          : String((e as Error)?.message ?? e).slice(0, 300);
      return { content: JSON.stringify({ error: message }), isError: true };
    }
  }

  private async run(name: string, input: unknown): Promise<unknown> {
    switch (name) {
      case 'get_dashboard_summary':
        NoInput.parse(input ?? {});
        return this.dashboardSummary();
      case 'get_leak_breakdown':
        NoInput.parse(input ?? {});
        return this.leakBreakdown();
      case 'list_proposals':
        return this.listProposals(ListProposalsInput.parse(input ?? {}));
      case 'get_proposal':
        return this.getProposal(GetProposalInput.parse(input ?? {}));
      case 'list_detections':
        return this.listDetections(ListDetectionsInput.parse(input ?? {}));
      case 'list_open_tasks':
        NoInput.parse(input ?? {});
        return this.listOpenTasks();
      case 'list_meetings':
        return this.listMeetings(ListMeetingsInput.parse(input ?? {}));
      case 'get_meeting_utilisation':
        return this.meetingUtilisation(UtilisationInput.parse(input ?? {}));
      case 'get_client_revenue':
        return this.clientRevenue(ClientRevenueInput.parse(input ?? {}));
      case 'list_unpaid_invoices':
        return this.listUnpaidInvoices(PageInput.parse(input ?? {}));
      case 'list_payments':
        return this.listPayments(PageInput.parse(input ?? {}));
      case 'get_aged_receivables':
        return this.agedReceivables(AgedReceivablesInput.parse(input ?? {}));
      case 'get_audit_trail':
        return this.auditTrail(AuditTrailInput.parse(input ?? {}));
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // ---- shared helpers -------------------------------------------------------

  private async clientNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();
    const rows = await this.clients.find({ where: { id: In(unique) } });
    return new Map(rows.map((c) => [c.id, c.name]));
  }

  private estimateMeetingValue(m: Meeting, client?: Client): number {
    const bp = client?.billingProfile;
    if (!bp || bp.rate == null) return 0;
    const rate = Number(bp.rate);
    const hours = Number(m.durationHours);
    if (!Number.isFinite(rate) || !Number.isFinite(hours)) return 0;
    if (bp.rate_unit === 'HOUR') return rate * hours;
    if (bp.rate_unit === 'DAY') return rate * (hours / 8);
    return 0;
  }

  // ---- local (Postgres) tools ------------------------------------------------

  private async dashboardSummary() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const [openTasks, clientRows, invoicesSentThisMonth] = await Promise.all([
      this.tasks.count({ where: { state: TaskState.OPEN } }),
      this.clients.find(),
      this.proposals.count({ where: { state: InvoiceProposalState.SENT, updatedAt: Between(monthStart, monthEnd) } }),
    ]);
    const unbilledGbp = round2(clientRows.reduce((sum, c) => sum + Number(c.unbilledExposureGbp), 0));
    return { openTasks, unbilledGbp, invoicesSentThisMonth, clientsCount: clientRows.length };
  }

  private async leakBreakdown() {
    const [openDetections, inReview, unbilledMeetings] = await Promise.all([
      this.detections.find({ where: { state: DetectionState.OPEN } }),
      this.proposals.find({ where: { state: InvoiceProposalState.IN_REVIEW } }),
      this.meetings.find({ where: { state: In(UNBILLED_MEETING_STATES), isPersonal: false } }),
    ]);
    const clientMap = new Map<string, Client>();
    const ids = [...new Set(unbilledMeetings.map((m) => m.clientId).filter((id): id is string => Boolean(id)))];
    if (ids.length > 0) {
      for (const c of await this.clients.find({ where: { id: In(ids) } })) clientMap.set(c.id, c);
    }
    const detectionGbp = round2(openDetections.reduce((s, d) => s + Number(d.valueGbp), 0));
    const reviewGbp = round2(inReview.reduce((s, p) => s + Number(p.total), 0));
    const meetingGbp = round2(
      unbilledMeetings.reduce(
        (s, m) => s + this.estimateMeetingValue(m, m.clientId ? clientMap.get(m.clientId) : undefined),
        0,
      ),
    );
    return {
      recoverableGbp: round2(detectionGbp + reviewGbp + meetingGbp),
      breakdown: [
        { source: 'Ledger detections', gbp: detectionGbp, count: openDetections.length },
        { source: 'Invoices in review', gbp: reviewGbp, count: inReview.length },
        { source: 'Unbilled meetings', gbp: meetingGbp, count: unbilledMeetings.length },
      ],
    };
  }

  private async listProposals(input: z.infer<typeof ListProposalsInput>) {
    const rows = await this.proposals.find({
      where: input.state ? { state: input.state } : {},
      order: { createdAt: 'DESC' },
      take: 50,
    });
    const names = await this.clientNames(rows.map((p) => p.clientId));
    return rows.map((p) => ({
      id: p.id,
      clientName: names.get(p.clientId) ?? null,
      state: p.state,
      currency: p.currency,
      total: Number(p.total),
      lineCount: (p.lines ?? []).length,
      reference: p.reference,
      autoSent: p.autoSent,
      xeroInvoiceNumber: p.xeroInvoiceNumber,
      xeroDeepLink: p.xeroDeepLink,
      createdAt: p.createdAt.toISOString().slice(0, 10),
    }));
  }

  private async getProposal(input: z.infer<typeof GetProposalInput>) {
    const p = await this.proposals.findOne({ where: { id: input.id } });
    if (!p) return { error: `No proposal with id ${input.id}` };
    const names = await this.clientNames([p.clientId]);
    return {
      id: p.id,
      clientName: names.get(p.clientId) ?? null,
      state: p.state,
      currency: p.currency,
      subtotal: Number(p.subtotal),
      taxTotal: Number(p.taxTotal),
      total: Number(p.total),
      reference: p.reference,
      autoSent: p.autoSent,
      policy: p.policyResult,
      meetingId: p.meetingId,
      detectionId: p.detectionId,
      xeroInvoiceNumber: p.xeroInvoiceNumber,
      xeroDeepLink: p.xeroDeepLink,
      lines: (p.lines ?? []).map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitAmount: l.unit_amount,
        lineAmount: l.line_amount,
        evidence: (l.provenance ?? []).map((pr) => `${pr.kind}: ${pr.label}`),
      })),
    };
  }

  private async listDetections(input: z.infer<typeof ListDetectionsInput>) {
    const where: Record<string, unknown> = {};
    if (input.state) where.state = input.state;
    if (input.type) where.type = input.type;
    const rows = await this.detections.find({ where, order: { createdAt: 'DESC' }, take: 50 });
    const names = await this.clientNames(rows.map((d) => d.clientId));
    return rows.map((d) => ({
      id: d.id,
      type: d.type,
      state: d.state,
      valueGbp: Number(d.valueGbp),
      clientName: d.clientId ? (names.get(d.clientId) ?? null) : null,
      summary: d.evidence?.summary ?? null,
      createdAt: d.createdAt.toISOString().slice(0, 10),
    }));
  }

  private async listOpenTasks() {
    const rows = await this.tasks.find({ where: { state: TaskState.OPEN }, order: { createdAt: 'DESC' }, take: 50 });
    return rows.map((t) => ({
      id: t.id,
      type: t.type,
      title: t.title,
      summary: t.summary,
      refType: t.refType,
      refId: t.refId,
      createdAt: t.createdAt.toISOString().slice(0, 10),
    }));
  }

  private async listMeetings(input: z.infer<typeof ListMeetingsInput>) {
    const where: Record<string, unknown> = {};
    if (input.state) where.state = input.state;
    const from = input.from ? new Date(input.from) : null;
    const to = input.to ? new Date(input.to) : null;
    if (from && Number.isNaN(from.getTime())) throw new Error(`Invalid 'from' date: ${input.from}`);
    if (to && Number.isNaN(to.getTime())) throw new Error(`Invalid 'to' date: ${input.to}`);
    if (from && to) where.start = Between(from, to);

    let rows = await this.meetings.find({ where, order: { start: 'DESC' }, take: 100 });
    if (from && !to) rows = rows.filter((m) => m.start >= from);
    if (to && !from) rows = rows.filter((m) => m.start <= to);

    const names = await this.clientNames(rows.map((m) => m.clientId));
    return rows.map((m) => ({
      id: m.id,
      title: m.title,
      start: m.start.toISOString(),
      durationHours: Number(m.durationHours),
      state: m.state,
      isPersonal: m.isPersonal,
      clientName: m.clientId ? (names.get(m.clientId) ?? null) : null,
    }));
  }

  private async meetingUtilisation(input: z.infer<typeof UtilisationInput>) {
    let rows: Meeting[];
    if (input.month) {
      const [y, mo] = input.month.split('-').map(Number);
      rows = await this.meetings.find({ where: { start: Between(new Date(y, mo - 1, 1), new Date(y, mo, 1)) } });
    } else {
      rows = await this.meetings.find();
    }
    let billed = 0;
    let unbilled = 0;
    let personal = 0;
    const byState = new Map<string, number>();
    for (const m of rows) {
      const h = Number(m.durationHours) || 0;
      byState.set(m.state, round2((byState.get(m.state) ?? 0) + h));
      if (m.isPersonal || m.state === MeetingState.SKIPPED) personal += h;
      else if (m.state === MeetingState.SENT) billed += h;
      else unbilled += h;
    }
    return {
      month: input.month ?? 'all-time',
      meetingCount: rows.length,
      billedHours: round2(billed),
      unbilledHours: round2(unbilled),
      personalOrSkippedHours: round2(personal),
      byState: [...byState.entries()].map(([state, hours]) => ({ state, hours })),
    };
  }

  private async clientRevenue(input: z.infer<typeof ClientRevenueInput>) {
    const topN = input.topN ?? 10;
    const [sent, clientRows] = await Promise.all([
      this.proposals.find({ where: { state: InvoiceProposalState.SENT } }),
      this.clients.find(),
    ]);
    const byClient = new Map<string, { sentGbp: number; proposalCount: number }>();
    for (const p of sent) {
      const agg = byClient.get(p.clientId) ?? { sentGbp: 0, proposalCount: 0 };
      agg.sentGbp = round2(agg.sentGbp + Number(p.total));
      agg.proposalCount += 1;
      byClient.set(p.clientId, agg);
    }
    return clientRows
      .map((c) => ({
        clientId: c.id,
        clientName: c.name,
        sentGbp: byClient.get(c.id)?.sentGbp ?? 0,
        proposalCount: byClient.get(c.id)?.proposalCount ?? 0,
        unbilledExposureGbp: round2(Number(c.unbilledExposureGbp)),
        autonomyEnabled: c.autonomyEnabled,
      }))
      .sort((a, b) => b.sentGbp - a.sentGbp || b.unbilledExposureGbp - a.unbilledExposureGbp)
      .slice(0, topN);
  }

  private async auditTrail(input: z.infer<typeof AuditTrailInput>) {
    const events = await this.audit.list(input.limit ?? 50);
    return events.map((e) => ({
      actor: e.actor,
      action: e.action,
      summary: e.summary,
      subjectType: e.subjectType,
      at: e.createdAt.toISOString(),
    }));
  }

  // ---- live Xero tools (read-only; single request each, 60/min budget) -------

  private async listUnpaidInvoices(input: z.infer<typeof PageInput>) {
    const { invoices } = await this.xero.listInvoices(['AUTHORISED', 'SUBMITTED'], input.page ?? 1);
    const today = new Date().toISOString().slice(0, 10);
    const sales = invoices.filter((inv) => inv.Type === 'ACCREC' && Number(inv.AmountDue ?? 0) > 0);
    // Totals and count cover EVERY unpaid sale on this page; only the row list
    // is capped at 50 so the payload stays model-sized. Slicing first would
    // silently shrink the totals once >50 invoices are unpaid.
    const all = sales.map((inv) => {
      const dueDate = parseXeroDate(inv.DueDate);
      return {
        invoiceNumber: inv.InvoiceNumber ?? null,
        contact: inv.Contact?.Name ?? null,
        status: inv.Status ?? null,
        dueDate,
        total: Number(inv.Total ?? 0),
        amountDue: Number(inv.AmountDue ?? 0),
        overdue: Boolean(dueDate && dueDate < today),
        reference: inv.Reference ?? null,
      };
    });
    const rows = all.slice(0, 50);
    return {
      count: all.length,
      outstandingGbp: round2(all.reduce((s, r) => s + r.amountDue, 0)),
      overdueGbp: round2(all.filter((r) => r.overdue).reduce((s, r) => s + r.amountDue, 0)),
      truncated: rows.length < all.length,
      invoices: rows,
    };
  }

  private async listPayments(input: z.infer<typeof PageInput>) {
    const payments = await this.xero.listPayments(input.page ?? 1);
    const byMonth = new Map<string, { totalGbp: number; count: number }>();
    const rows = payments
      .map((p) => ({
        date: parseXeroDate(p.Date),
        amount: Number(p.Amount ?? 0),
        reference: p.Reference ?? null,
        invoiceNumber: p.Invoice?.InvoiceNumber ?? null,
        status: p.Status ?? null,
      }))
      .filter((p) => p.status !== 'DELETED');
    for (const p of rows) {
      const month = p.date ? p.date.slice(0, 7) : 'unknown';
      const agg = byMonth.get(month) ?? { totalGbp: 0, count: 0 };
      agg.totalGbp = round2(agg.totalGbp + p.amount);
      agg.count += 1;
      byMonth.set(month, agg);
    }
    return {
      months: [...byMonth.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([month, v]) => ({ month, ...v })),
      recentPayments: rows.sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? 1 : -1)).slice(0, 20),
    };
  }

  private async agedReceivables(input: z.infer<typeof AgedReceivablesInput>) {
    const client = await this.clients.findOne({ where: { id: input.clientId } });
    if (!client) return { error: `No client with id ${input.clientId}` };
    if (!client.xeroContactId) {
      return { error: `${client.name} has no Xero contact yet, so there is no receivables history for them.` };
    }
    const report = await this.xero.agedReceivablesByContact(client.xeroContactId);
    const root = report?.Reports?.[0];
    if (!root) return { clientName: client.name, rows: [], note: 'Xero returned an empty report.' };

    const header: string[] = [];
    const rows: string[][] = [];
    const walk = (nodes: any[]) => {
      for (const node of nodes ?? []) {
        if (node?.RowType === 'Header') {
          header.push(...(node.Cells ?? []).map((c: any) => String(c?.Value ?? '')));
        } else if (node?.RowType === 'Section') {
          walk(node.Rows ?? []);
        } else if (node?.RowType === 'Row' || node?.RowType === 'SummaryRow') {
          rows.push((node.Cells ?? []).map((c: any) => String(c?.Value ?? '')));
        }
      }
    };
    walk(root.Rows ?? []);
    return {
      clientName: client.name,
      reportTitle: (root.ReportTitles ?? []).join(' - ') || 'Aged Receivables By Contact',
      header,
      rows: rows.slice(0, 40),
    };
  }

  // ---- chat starters (cheap, for the empty state) -----------------------------

  async starters(): Promise<string[]> {
    const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
    try {
      const [leak, openTasks] = await Promise.all([
        this.leakBreakdown(),
        this.tasks.count({ where: { state: TaskState.OPEN } }),
      ]);
      return [
        leak.recoverableGbp > 0
          ? `Where is the ${gbp(leak.recoverableGbp)} I could still bill this month?`
          : 'How is my cash flow looking this month?',
        'Which of my invoices are unpaid or overdue?',
        'Who are my top clients by invoiced revenue?',
        openTasks > 0
          ? `What are the ${openTasks} open task${openTasks === 1 ? '' : 's'} waiting on me?`
          : 'What has Robyn done for me this week?',
      ];
    } catch {
      return [
        'How is my cash flow looking this month?',
        'Which of my invoices are unpaid or overdue?',
        'Who are my top clients by invoiced revenue?',
        'Where am I leaking money right now?',
      ];
    }
  }
}
