import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import {
  Client,
  Detection,
  DetectionState,
  InvoiceProposal,
  InvoiceProposalState,
  Meeting,
  MeetingState,
  Task,
  TaskState,
} from '../../entities';
import { AuditService } from '../audit/audit.service';
import { XeroService } from '../xero/xero.service';
import { XeroInvoice, XeroPayment } from '../xero/xero-api';
import {
  bucketInvoicesOwed,
  bucketProposalsOwed,
  groupPaymentsByMonth,
  groupProposalCashInByMonth,
  lastNMonthKeys,
  round2,
} from './charts.util';
import {
  AuditEventDto,
  CalendarColorKey,
  CalendarEventDto,
  CashInDto,
  ChartsSource,
  DashboardChartsDto,
  DashboardSummaryDto,
  InvoicesOwedBucketDto,
  LeakStripDto,
  MoneyFoundBucketDto,
} from './dto/dashboard.dto';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// Meeting states whose work is still recoverable (not yet SENT / SKIPPED) and
// that do NOT already carry a proposal (INVOICE_PROPOSED is counted in the
// in-review bucket instead, so it is excluded here to avoid double counting).
const UNBILLED_MEETING_STATES: MeetingState[] = [
  MeetingState.DETECTED,
  MeetingState.AWAITING_TRANSCRIPT,
  MeetingState.TRANSCRIPT_ATTACHED,
  MeetingState.CLIENT_MATCHED,
];

// All detection states, in the order the chart legend reads them.
const MONEY_FOUND_STATE_ORDER: DetectionState[] = [
  DetectionState.OPEN,
  DetectionState.PROPOSED,
  DetectionState.RESOLVED,
  DetectionState.DISMISSED,
];

// Rate-limit discipline: /dashboard/charts costs up to ~6 Xero reads, so the
// computed payload is cached for 60s — dashboard refreshes never burn the
// 60/min budget.
const CHARTS_CACHE_TTL_MS = 60_000;

// Pagination guard: at most 3 pages (of 100) per Xero resource per rebuild.
const CHARTS_MAX_PAGES = 3;
const CHARTS_PAGE_SIZE = 100;

@Injectable()
export class DashboardService {
  private readonly log = new Logger('DashboardService');

  private chartsCache: { payload: DashboardChartsDto; atMs: number } | null =
    null;

  constructor(
    @InjectRepository(Meeting)
    private readonly meetings: Repository<Meeting>,
    @InjectRepository(Client)
    private readonly clients: Repository<Client>,
    @InjectRepository(InvoiceProposal)
    private readonly proposals: Repository<InvoiceProposal>,
    @InjectRepository(Detection)
    private readonly detections: Repository<Detection>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    private readonly audit: AuditService,
    private readonly xero: XeroService,
  ) {}

  private static round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // Colour token for the calendar view, derived purely from meeting state.
  private colorKeyFor(m: Meeting): CalendarColorKey {
    if (m.isPersonal) return 'gray';
    switch (m.state) {
      case MeetingState.SENT:
        return 'teal'; // billed
      case MeetingState.INVOICE_PROPOSED:
        return 'amber'; // proposal in review
      case MeetingState.UNKNOWN_ATTENDEE:
        return 'purple'; // unknown attendee
      case MeetingState.SKIPPED:
        return 'gray'; // skipped
      default:
        return 'amber-outline'; // awaiting (detected / awaiting transcript / attached / matched)
    }
  }

  // Best-effort £ estimate of a single unbilled meeting from its client's rate.
  private estimateMeetingValue(m: Meeting, client?: Client): number {
    const bp = client?.billingProfile;
    if (!bp || bp.rate == null) return 0;
    const rate = Number(bp.rate);
    const hours = Number(m.durationHours);
    if (!Number.isFinite(rate) || !Number.isFinite(hours)) return 0;
    if (bp.rate_unit === 'HOUR') return rate * hours;
    if (bp.rate_unit === 'DAY') return rate * (hours / 8); // ~8h working day
    return 0; // FIXED / unknown — not estimable per meeting
  }

  private async clientsById(ids: string[]): Promise<Map<string, Client>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const rows = await this.clients.find({ where: { id: In(unique) } });
    return new Map(rows.map((c) => [c.id, c]));
  }

  // GET /dashboard/calendar — colour-coded events with client + proposal links.
  async calendar(from?: string, to?: string): Promise<CalendarEventDto[]> {
    const where: FindOptionsWhere<Meeting> = {};
    if (from && to) {
      where.start = Between(new Date(from), new Date(to));
    } else if (from) {
      where.start = MoreThanOrEqual(new Date(from));
    } else if (to) {
      where.start = LessThanOrEqual(new Date(to));
    }

    const meetings = await this.meetings.find({
      where,
      order: { start: 'ASC' },
    });
    if (meetings.length === 0) return [];

    const clientMap = await this.clientsById(
      meetings.map((m) => m.clientId ?? '').filter(Boolean),
    );

    // Map each meeting to its most recent proposal (prefer non-rejected).
    const meetingIds = meetings.map((m) => m.id);
    const proposalRows = await this.proposals.find({
      where: { meetingId: In(meetingIds) },
      order: { createdAt: 'DESC' },
    });
    const proposalByMeeting = new Map<string, string>();
    for (const p of proposalRows) {
      if (!p.meetingId) continue;
      const existing = proposalByMeeting.get(p.meetingId);
      if (!existing) {
        proposalByMeeting.set(p.meetingId, p.id);
      } else if (p.state !== InvoiceProposalState.REJECTED) {
        // A newer non-rejected proposal wins over an older rejected one.
        proposalByMeeting.set(p.meetingId, p.id);
      }
    }

    return meetings.map((m) => ({
      id: m.id,
      title: m.title,
      start: m.start.toISOString(),
      end: m.end.toISOString(),
      state: m.state,
      colorKey: this.colorKeyFor(m),
      clientName: m.clientId ? (clientMap.get(m.clientId)?.name ?? null) : null,
      proposalId: proposalByMeeting.get(m.id) ?? null,
    }));
  }

  // GET /dashboard/leak-strip — "£2,880 was walking away" this month.
  async leakStrip(): Promise<LeakStripDto> {
    const [openDetections, inReviewProposals, unbilledMeetings] =
      await Promise.all([
        this.detections.find({ where: { state: DetectionState.OPEN } }),
        this.proposals.find({
          where: { state: InvoiceProposalState.IN_REVIEW },
        }),
        this.meetings.find({
          where: {
            state: In(UNBILLED_MEETING_STATES),
            isPersonal: false,
          },
        }),
      ]);

    const detectionGbp = openDetections.reduce(
      (sum, d) => sum + Number(d.valueGbp),
      0,
    );
    const reviewGbp = inReviewProposals.reduce(
      (sum, p) => sum + Number(p.total),
      0,
    );

    const meetingClientMap = await this.clientsById(
      unbilledMeetings.map((m) => m.clientId ?? '').filter(Boolean),
    );
    const meetingGbp = unbilledMeetings.reduce(
      (sum, m) =>
        sum +
        this.estimateMeetingValue(
          m,
          m.clientId ? meetingClientMap.get(m.clientId) : undefined,
        ),
      0,
    );

    const breakdown = [
      {
        source: 'Ledger detections',
        gbp: DashboardService.round2(detectionGbp),
        count: openDetections.length,
      },
      {
        source: 'Invoices in review',
        gbp: DashboardService.round2(reviewGbp),
        count: inReviewProposals.length,
      },
      {
        source: 'Unbilled meetings',
        gbp: DashboardService.round2(meetingGbp),
        count: unbilledMeetings.length,
      },
    ];

    // Label the strip with the month of the most recent unbilled meeting so
    // the demo reads "June 2026"; fall back to the current month.
    let labelDate = new Date();
    if (unbilledMeetings.length > 0) {
      labelDate = unbilledMeetings.reduce(
        (latest, m) => (m.start > latest ? m.start : latest),
        unbilledMeetings[0].start,
      );
    }
    const monthLabel = `${MONTH_NAMES[labelDate.getMonth()]} ${labelDate.getFullYear()}`;

    return {
      monthLabel,
      recoverableGbp: DashboardService.round2(
        detectionGbp + reviewGbp + meetingGbp,
      ),
      breakdown,
    };
  }

  // GET /dashboard/audit — the audit trail feed (newest first).
  async auditTrail(limit = 100): Promise<AuditEventDto[]> {
    const events = await this.audit.list(limit);
    return events.map((e) => ({
      id: e.id,
      actor: e.actor,
      action: e.action,
      summary: e.summary,
      subjectType: e.subjectType,
      subjectId: e.subjectId,
      inputs: e.inputs,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  // GET /dashboard/summary — the headline stats row.
  async summary(): Promise<DashboardSummaryDto> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [openTasks, clientRows, invoicesSentThisMonth, clientsCount] =
      await Promise.all([
        this.tasks.count({ where: { state: TaskState.OPEN } }),
        this.clients.find(),
        this.proposals.count({
          where: {
            state: InvoiceProposalState.SENT,
            updatedAt: Between(monthStart, monthEnd),
          },
        }),
        this.clients.count(),
      ]);

    const unbilledGbp = clientRows.reduce(
      (sum, c) => sum + Number(c.unbilledExposureGbp),
      0,
    );

    return {
      openTasks,
      unbilledGbp: DashboardService.round2(unbilledGbp),
      invoicesSentThisMonth,
      clientsCount,
    };
  }

  // GET /dashboard/charts — the whole chart board in one call, 60s-cached.
  async charts(): Promise<DashboardChartsDto> {
    if (
      this.chartsCache &&
      Date.now() - this.chartsCache.atMs < CHARTS_CACHE_TTL_MS
    ) {
      return this.chartsCache.payload;
    }
    const payload = await this.buildCharts();
    this.chartsCache = { payload, atMs: Date.now() };
    return payload;
  }

  private async buildCharts(): Promise<DashboardChartsDto> {
    const today = new Date();
    const months = lastNMonthKeys(today, 6);

    // Local pieces are always available regardless of Xero.
    const [moneyFound, leak] = await Promise.all([
      this.moneyFound(),
      this.leakStrip(),
    ]);

    let invoicesOwed: InvoicesOwedBucketDto[] | null = null;
    let cashIn: CashInDto | null = null;
    let source: ChartsSource = 'local-fallback';

    // Probe once; even when LIVE every read is still wrapped, so a mid-flight
    // failure degrades to the local path rather than 500-ing (same pattern as
    // the detectors).
    let xeroLive = false;
    try {
      xeroLive = (await this.xero.health()).ok;
    } catch (err) {
      this.log.warn(`Xero health probe failed: ${errMsg(err)}`);
    }

    if (xeroLive) {
      try {
        const [invoices, payments] = await Promise.all([
          this.fetchOwedInvoices(),
          this.fetchRecentPayments(),
        ]);
        invoicesOwed = bucketInvoicesOwed(invoices, today);
        const monthRows = groupPaymentsByMonth(payments, months);
        cashIn = {
          months: monthRows,
          total6m: round2(monthRows.reduce((s, m) => s + m.amountGbp, 0)),
        };
        source = 'xero-live';
      } catch (err) {
        this.log.warn(`Charts Xero reads failed, using local fallback: ${errMsg(err)}`);
      }
    }

    if (!invoicesOwed || !cashIn) {
      const proposalRows = await this.proposals.find();
      invoicesOwed = bucketProposalsOwed(proposalRows);
      const monthRows = groupProposalCashInByMonth(proposalRows, months);
      cashIn = {
        months: monthRows,
        total6m: round2(monthRows.reduce((s, m) => s + m.amountGbp, 0)),
      };
      source = 'local-fallback';
    }

    return {
      invoicesOwed,
      cashIn,
      moneyFound,
      // Reuse the leak-strip computation verbatim — one source of truth.
      unbilledPipeline: { items: leak.breakdown, totalGbp: leak.recoverableGbp },
      meta: { source, generatedAt: new Date().toISOString() },
    };
  }

  // Money Robyn found, by detection state. Every state is present (zero-filled)
  // so the frontend can always show recovered vs pending vs dismissed.
  private async moneyFound(): Promise<MoneyFoundBucketDto[]> {
    const rows = await this.detections.find();
    const acc = new Map<DetectionState, { count: number; amount: number }>(
      MONEY_FOUND_STATE_ORDER.map((s) => [s, { count: 0, amount: 0 }]),
    );
    for (const d of rows) {
      const bucket = acc.get(d.state);
      if (!bucket) continue;
      bucket.count += 1;
      bucket.amount += Number(d.valueGbp);
    }
    return MONEY_FOUND_STATE_ORDER.map((state) => {
      const bucket = acc.get(state)!;
      return {
        state,
        count: bucket.count,
        amountGbp: DashboardService.round2(bucket.amount),
      };
    });
  }

  // One batched ACCREC-owed read: DRAFT+SUBMITTED+AUTHORISED in a single
  // Statuses-filtered call, up to 3 pages of 100.
  private async fetchOwedInvoices(): Promise<XeroInvoice[]> {
    const out: XeroInvoice[] = [];
    for (let page = 1; page <= CHARTS_MAX_PAGES; page++) {
      const { invoices, pagination } = await this.xero.listInvoices(
        ['DRAFT', 'SUBMITTED', 'AUTHORISED'],
        page,
      );
      out.push(...invoices);
      const lastPage = pagination ? page >= pagination.pageCount : false;
      if (lastPage || invoices.length < CHARTS_PAGE_SIZE) break;
    }
    return out;
  }

  // Payments feed for the cash-in chart, up to 3 pages of 100 (the payments
  // endpoint has no pagination envelope in our helper — a short page ends it).
  private async fetchRecentPayments(): Promise<XeroPayment[]> {
    const out: XeroPayment[] = [];
    for (let page = 1; page <= CHARTS_MAX_PAGES; page++) {
      const payments = await this.xero.listPayments(page);
      out.push(...payments);
      if (payments.length < CHARTS_PAGE_SIZE) break;
    }
    return out;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
