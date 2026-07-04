import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MeetingState,
  InvoiceProposalState,
  TranscriptSource,
  ProvenanceKind,
  ConnectionStatus,
  AuditActor,
} from '../../../entities';

// Every response DTO is an explicit class so openapi.json is complete and the
// frontend's generated types cover the whole meetings surface.

export class AttendeeDto {
  @ApiProperty({ example: 'jane@fenwick.co.uk' })
  email!: string;

  @ApiPropertyOptional({ example: 'Jane Fenwick' })
  name?: string;

  @ApiPropertyOptional({ example: false })
  organizer?: boolean;
}

export class LineProvenanceDto {
  @ApiProperty({ enum: ProvenanceKind, enumName: 'ProvenanceKind' })
  kind!: ProvenanceKind;

  @ApiProperty({ example: 'Clause 3.1' })
  label!: string;

  @ApiProperty({ example: 'The Consultant shall be paid £150 per hour.' })
  detail!: string;

  @ApiPropertyOptional({ description: 'Source id (meeting/contract/quote).' })
  source_ref?: string;
}

export class ProposalLineDto {
  @ApiProperty()
  description!: string;

  @ApiProperty({ example: 1.5 })
  quantity!: number;

  @ApiProperty({ example: 150 })
  unit_amount!: number;

  @ApiProperty({ example: 225 })
  line_amount!: number;

  @ApiPropertyOptional({ example: '200' })
  account_code?: string;

  @ApiPropertyOptional({ example: 'OUTPUT2' })
  tax_type?: string;

  @ApiProperty({ type: [LineProvenanceDto] })
  provenance!: LineProvenanceDto[];
}

export class PolicyResultDto {
  @ApiProperty({ description: 'Whether Robyn may send without asking.' })
  auto!: boolean;

  @ApiProperty({ type: [String], description: 'Every reason the gate passed/failed.' })
  reasons!: string[];
}

export class MeetingProposalDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: InvoiceProposalState, enumName: 'InvoiceProposalState' })
  state!: InvoiceProposalState;

  @ApiPropertyOptional({ example: 'ROBYN-1a2b3c4d' })
  reference!: string | null;

  @ApiProperty({ example: 'GBP' })
  currency!: string;

  @ApiProperty({ example: 225 })
  subtotal!: number;

  @ApiProperty({ example: 45 })
  taxTotal!: number;

  @ApiProperty({ example: 270 })
  total!: number;

  @ApiProperty({ description: 'True if Robyn auto-sent it (autonomy ON).' })
  autoSent!: boolean;

  @ApiPropertyOptional({ nullable: true })
  xeroInvoiceId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  xeroInvoiceNumber!: string | null;

  @ApiPropertyOptional({ nullable: true })
  xeroDeepLink!: string | null;

  @ApiProperty({ type: PolicyResultDto })
  policyResult!: PolicyResultDto;

  @ApiProperty({ type: [ProposalLineDto] })
  lines!: ProposalLineDto[];
}

export class ScopeItemDto {
  @ApiProperty()
  description!: string;

  @ApiProperty({ example: 2 })
  est_hours!: number;

  @ApiProperty({ description: 'Verbatim transcript line evidencing the work.' })
  evidence_quote!: string;

  @ApiProperty()
  billable!: boolean;
}

export class TranscriptParsedDto {
  @ApiPropertyOptional({ nullable: true })
  summary!: string | null;

  @ApiProperty({ type: [String] })
  action_points!: string[];

  @ApiProperty({ type: [ScopeItemDto] })
  scope_items!: ScopeItemDto[];
}

export class TranscriptDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: TranscriptSource, enumName: 'TranscriptSource' })
  source!: TranscriptSource;

  @ApiProperty()
  rawText!: string;

  @ApiPropertyOptional({ type: TranscriptParsedDto, nullable: true })
  parsed!: TranscriptParsedDto | null;
}

export class MatchProposalDto {
  @ApiProperty()
  client_id!: string;

  @ApiProperty()
  client_name!: string;

  @ApiProperty({ example: 0.82, description: '0..1 confidence — a proposal, never a decision.' })
  confidence!: number;

  @ApiProperty()
  reason!: string;
}

export class AuditEventDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: AuditActor, enumName: 'AuditActor' })
  actor!: AuditActor;

  @ApiProperty({ example: 'meeting.invoice_proposed' })
  action!: string;

  @ApiProperty()
  summary!: string;

  @ApiPropertyOptional({ nullable: true })
  subjectType!: string | null;

  @ApiPropertyOptional({ nullable: true })
  subjectId!: string | null;

  @ApiProperty({ description: 'ISO timestamp.' })
  createdAt!: string;
}

export class MeetingListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  gcalEventId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ description: 'ISO timestamp.' })
  start!: string;

  @ApiProperty({ description: 'ISO timestamp.' })
  end!: string;

  @ApiProperty({ example: 1.5 })
  durationHours!: number;

  @ApiProperty({ enum: MeetingState, enumName: 'MeetingState' })
  state!: MeetingState;

  @ApiPropertyOptional({ nullable: true })
  clientId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  clientName!: string | null;

  @ApiProperty({ type: [AttendeeDto] })
  attendees!: AttendeeDto[];

  @ApiProperty({ description: 'No external attendees — auto-skipped.' })
  isPersonal!: boolean;

  @ApiProperty()
  hasTranscript!: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Linked InvoiceProposal id, if any.' })
  proposalId!: string | null;

  @ApiProperty({ example: 'ics', description: "'google' | 'ics'" })
  source!: string;
}

export class MeetingDetailDto extends MeetingListItemDto {
  @ApiPropertyOptional({ nullable: true, description: 'Reason the meeting was skipped.' })
  skipReason!: string | null;

  @ApiPropertyOptional({ type: TranscriptDto, nullable: true })
  transcript!: TranscriptDto | null;

  @ApiPropertyOptional({
    type: [MatchProposalDto],
    nullable: true,
    description: 'LLM fuzzy match proposals (only when unknown/ambiguous).',
  })
  matchProposals!: MatchProposalDto[] | null;

  @ApiPropertyOptional({ type: MeetingProposalDto, nullable: true })
  proposal!: MeetingProposalDto | null;

  @ApiProperty({ type: [AuditEventDto], description: 'The evidence/decision chain, newest first.' })
  auditTrail!: AuditEventDto[];
}

export class MeetingActionResultDto {
  @ApiProperty({ type: MeetingDetailDto })
  meeting!: MeetingDetailDto;

  @ApiPropertyOptional({ type: MeetingProposalDto, nullable: true })
  proposal!: MeetingProposalDto | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Populated when an attempted Xero write failed (state kept locally).',
  })
  xeroError!: string | null;
}

export class SyncResultDto {
  @ApiProperty({ example: 'ics', description: "'google' | 'ics'" })
  source!: string;

  @ApiProperty({ enum: ConnectionStatus, enumName: 'ConnectionStatus' })
  status!: ConnectionStatus;

  @ApiPropertyOptional({ nullable: true })
  label!: string | null;

  @ApiPropertyOptional({ nullable: true })
  detail!: string | null;

  @ApiProperty({ description: 'New meetings created this run.' })
  imported!: number;

  @ApiProperty({ description: 'Existing meetings refreshed this run.' })
  updated!: number;

  @ApiProperty({ description: 'Meetings the Loop-1 step ran on this run.' })
  processed!: number;

  @ApiProperty({ description: 'ISO timestamp of this sync.' })
  lastSyncAt!: string;
}
