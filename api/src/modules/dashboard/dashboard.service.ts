import { Injectable } from '@nestjs/common';
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
import {
  AuditEventDto,
  CalendarColorKey,
  CalendarEventDto,
  DashboardSummaryDto,
  LeakStripDto,
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

@Injectable()
export class DashboardService {
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
}
