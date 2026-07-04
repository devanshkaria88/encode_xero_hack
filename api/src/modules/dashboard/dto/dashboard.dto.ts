import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { MeetingState, AuditActor } from '../../../entities';

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
