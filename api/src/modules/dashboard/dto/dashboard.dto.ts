import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { MeetingState, AuditActor, DetectionState } from '../../../entities';
import {
  INVOICES_OWED_BUCKET_KEYS,
  InvoicesOwedBucketKey,
} from '../charts.util';

// The colour token the calendar view paints an event with. Derived from
// meeting.state (see DashboardService.colorKeyFor): billed=teal,
// proposal=amber, awaiting=amber-outline, unknown=purple, skipped=gray.
export type CalendarColorKey =
  | 'teal'
  | 'amber'
  | 'amber-outline'
  | 'purple'
  | 'gray';

export const CALENDAR_COLOR_KEYS: CalendarColorKey[] = [
  'teal',
  'amber',
  'amber-outline',
  'purple',
  'gray',
];

// ---- Query DTOs -----------------------------------------------------------

export class CalendarQueryDto {
  @ApiPropertyOptional({
    description:
      'Inclusive lower bound (ISO date/datetime) on the event start. Omit for no lower bound.',
    example: '2026-06-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description:
      'Inclusive upper bound (ISO date/datetime) on the event start. Omit for no upper bound.',
    example: '2026-06-30T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class AuditQueryDto {
  @ApiPropertyOptional({
    description: 'Maximum number of audit events to return, newest first.',
    minimum: 1,
    maximum: 500,
    default: 100,
    example: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

// ---- Response DTOs --------------------------------------------------------

export class CalendarEventDto {
  @ApiProperty({ description: 'Meeting id.', format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Event title from the calendar.' })
  title!: string;

  @ApiProperty({ description: 'Event start (ISO datetime).' })
  start!: string;

  @ApiProperty({ description: 'Event end (ISO datetime).' })
  end!: string;

  @ApiProperty({
    description: 'The meeting state driving the colour.',
    enum: MeetingState,
  })
  state!: MeetingState;

  @ApiProperty({
    description:
      'Colour token for the calendar view. billed=teal, proposal=amber, awaiting=amber-outline, unknown=purple, skipped/personal=gray.',
    enum: CALENDAR_COLOR_KEYS,
  })
  colorKey!: CalendarColorKey;

  @ApiProperty({
    description: 'Matched client name, or null when unmatched/unknown.',
    nullable: true,
    type: String,
  })
  clientName!: string | null;

  @ApiProperty({
    description:
      'Linked invoice proposal id if one exists for this meeting, else null.',
    nullable: true,
    type: String,
    format: 'uuid',
  })
  proposalId!: string | null;
}

export class LeakBreakdownDto {
  @ApiProperty({
    description: 'Human label for this leak source.',
    example: 'Invoices in review',
  })
  source!: string;

  @ApiProperty({
    description: 'Recoverable amount (GBP, 2dp) attributable to this source.',
    example: 1440,
  })
  gbp!: number;

  @ApiProperty({
    description: 'Number of items contributing to this source.',
    example: 2,
  })
  count!: number;
}

export class LeakStripDto {
  @ApiProperty({
    description: 'The month this leak strip summarises, e.g. "June 2026".',
    example: 'June 2026',
  })
  monthLabel!: string;

  @ApiProperty({
    description:
      'Total recoverable amount (GBP, 2dp): OPEN detections + IN_REVIEW proposals + unbilled meetings.',
    example: 2880,
  })
  recoverableGbp!: number;

  @ApiProperty({
    description: 'Per-source breakdown that sums to recoverableGbp.',
    type: [LeakBreakdownDto],
  })
  breakdown!: LeakBreakdownDto[];
}

export class AuditEventDto {
  @ApiProperty({ description: 'Audit event id.', format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Who acted.', enum: AuditActor })
  actor!: AuditActor;

  @ApiProperty({
    description: 'Machine verb, e.g. "xero.invoice.created".',
    example: 'xero.invoice.created',
  })
  action!: string;

  @ApiProperty({ description: 'Human sentence for the audit trail.' })
  summary!: string;

  @ApiProperty({
    description: 'Subject kind, e.g. "meeting" | "proposal" | "client".',
    nullable: true,
    type: String,
  })
  subjectType!: string | null;

  @ApiProperty({
    description: 'Subject id.',
    nullable: true,
    type: String,
    format: 'uuid',
  })
  subjectId!: string | null;

  @ApiProperty({
    description: 'The decision inputs kept so an auditor can reconstruct it.',
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  inputs!: Record<string, unknown> | null;

  @ApiProperty({ description: 'When it happened (ISO datetime).' })
  createdAt!: string;
}

// ---- Charts (GET /dashboard/charts) ----------------------------------------

// Where the invoice/cash figures came from: live Xero reads, or the local
// InvoiceProposal table when Xero is unreachable (the endpoint never 500s
// because Xero is down).
export type ChartsSource = 'xero-live' | 'local-fallback';

export const CHARTS_SOURCES: ChartsSource[] = ['xero-live', 'local-fallback'];

export class InvoicesOwedBucketDto {
  @ApiProperty({
    description:
      'Bucket key. DRAFT = draft+submitted invoices, AWAITING = authorised and not yet due (or no due date), OVERDUE = authorised and past due.',
    enum: INVOICES_OWED_BUCKET_KEYS,
  })
  key!: InvoicesOwedBucketKey;

  @ApiProperty({ description: 'Number of invoices in this bucket.', example: 3 })
  count!: number;

  @ApiProperty({
    description: 'Amount still owed in this bucket (GBP, 2dp) — sum of AmountDue.',
    example: 1440,
  })
  amountGbp!: number;
}

export class CashInMonthDto {
  @ApiProperty({ description: 'Calendar month key.', example: '2026-02' })
  month!: string;

  @ApiProperty({
    description: 'Payments received against sales invoices that month (GBP, 2dp).',
    example: 960,
  })
  amountGbp!: number;
}

export class CashInDto {
  @ApiProperty({
    description:
      'Last 6 calendar months (oldest first, current month included), zero-filled so every month has a bar.',
    type: [CashInMonthDto],
  })
  months!: CashInMonthDto[];

  @ApiProperty({
    description: 'Total received across the 6 months (GBP, 2dp).',
    example: 5760,
  })
  total6m!: number;
}

export class MoneyFoundBucketDto {
  @ApiProperty({
    description: 'Detection lifecycle state this bucket counts.',
    enum: DetectionState,
  })
  state!: DetectionState;

  @ApiProperty({ description: 'Number of detections in this state.', example: 2 })
  count!: number;

  @ApiProperty({
    description: 'Total value Robyn found in this state (GBP, 2dp).',
    example: 2880,
  })
  amountGbp!: number;
}

export class UnbilledPipelineDto {
  @ApiProperty({
    description:
      'Per-source unbilled pipeline (same computation as the leak strip): open detections, invoices in review, unbilled meetings.',
    type: [LeakBreakdownDto],
  })
  items!: LeakBreakdownDto[];

  @ApiProperty({
    description: 'Total unbilled pipeline (GBP, 2dp) — sums the items.',
    example: 3555,
  })
  totalGbp!: number;
}

export class ChartsMetaDto {
  @ApiProperty({
    description:
      'Where the invoice/cash figures came from: "xero-live" for live Xero reads, "local-fallback" for the local proposal approximation when Xero is unreachable.',
    enum: CHARTS_SOURCES,
  })
  source!: ChartsSource;

  @ApiProperty({
    description: 'When this payload was computed (ISO datetime). Cached for up to 60 seconds.',
    example: '2026-07-04T12:00:00.000Z',
  })
  generatedAt!: string;
}

export class DashboardChartsDto {
  @ApiProperty({
    description:
      'Invoices owed buckets from live Xero ACCREC invoices (or local proposals on fallback). Always all three keys in DRAFT, AWAITING, OVERDUE order.',
    type: [InvoicesOwedBucketDto],
  })
  invoicesOwed!: InvoicesOwedBucketDto[];

  @ApiProperty({
    description: 'Cash received per month over the last 6 calendar months.',
    type: CashInDto,
  })
  cashIn!: CashInDto;

  @ApiProperty({
    description:
      'Money Robyn found, bucketed by detection state (all states present: OPEN, PROPOSED, RESOLVED, DISMISSED) so recovered vs pending vs dismissed can be shown.',
    type: [MoneyFoundBucketDto],
  })
  moneyFound!: MoneyFoundBucketDto[];

  @ApiProperty({
    description: 'The unbilled pipeline — the leak-strip breakdown reshaped for charting.',
    type: UnbilledPipelineDto,
  })
  unbilledPipeline!: UnbilledPipelineDto;

  @ApiProperty({ description: 'Data provenance and freshness.', type: ChartsMetaDto })
  meta!: ChartsMetaDto;
}

export class DashboardSummaryDto {
  @ApiProperty({
    description: 'Number of OPEN tasks in the inbox.',
    example: 3,
  })
  openTasks!: number;

  @ApiProperty({
    description: 'Total unbilled exposure across all clients (GBP, 2dp).',
    example: 4200,
  })
  unbilledGbp!: number;

  @ApiProperty({
    description: 'Invoice proposals sent to Xero so far this calendar month.',
    example: 1,
  })
  invoicesSentThisMonth!: number;

  @ApiProperty({ description: 'Number of clients.', example: 3 })
  clientsCount!: number;
}
