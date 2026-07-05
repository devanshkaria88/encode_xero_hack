import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceProposalState } from '../../../entities';
import { ProposalLineDto } from './proposal-line.dto';

// The engine's send-or-ask verdict, rendered on the card.
export class PolicyResultDto {
  @ApiProperty({ description: 'May Robyn send without asking?' })
  auto!: boolean;

  @ApiProperty({ type: [String], description: 'Every reason the gate passed / failed' })
  reasons!: string[];
}

// Shared summary shape for a proposal (list rows + the head of the detail view).
export class ProposalSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  clientId!: string;

  @ApiProperty({ description: 'Resolved client display name' })
  clientName!: string;

  @ApiProperty({ enum: ['meeting', 'detection'], description: 'What this proposal was built from' })
  source!: 'meeting' | 'detection';

  @ApiPropertyOptional({ nullable: true, description: 'Source meeting id, if any' })
  meetingId!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Source detection id, if any' })
  detectionId!: string | null;

  @ApiProperty({ example: 'GBP' })
  currency!: string;

  @ApiProperty({ example: 225 })
  subtotal!: number;

  @ApiProperty({ example: 45 })
  taxTotal!: number;

  @ApiProperty({ example: 270 })
  total!: number;

  @ApiProperty({ enum: InvoiceProposalState })
  state!: InvoiceProposalState;

  @ApiProperty({ type: PolicyResultDto })
  policyResult!: PolicyResultDto;

  @ApiProperty({ description: 'Number of invoice lines' })
  lineCount!: number;

  @ApiProperty({ description: 'Whether Robyn auto-sent this (autonomy ON)' })
  autoSent!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ISO timestamp when Xero emailed the invoice to the client; null if not emailed',
  })
  emailedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Idempotency reference used in Xero' })
  reference!: string | null;

  @ApiPropertyOptional({ nullable: true })
  xeroInvoiceId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  xeroInvoiceNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Deep link into the Xero UI' })
  xeroDeepLink!: string | null;

  @ApiProperty({ description: 'ISO created timestamp' })
  createdAt!: string;
}

// Evidence chain surfaced on the detail card — the source that justifies the money.
export class ProposalEvidenceMeetingDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ description: 'ISO start' })
  start!: string;

  @ApiProperty({ description: 'ISO end' })
  end!: string;

  @ApiProperty()
  durationHours!: number;

  @ApiProperty()
  state!: string;

  @ApiProperty({ type: [String], description: 'Attendee emails' })
  attendees!: string[];
}

export class ProposalEvidenceTranscriptDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ nullable: true })
  summary!: string | null;

  @ApiProperty({ type: [String], description: 'Verbatim billable-scope quotes' })
  scopeQuotes!: string[];

  @ApiProperty({ description: 'Short raw excerpt for the drill-down' })
  excerpt!: string;
}

export class ProposalEvidenceDetectionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  valueGbp!: number;

  @ApiProperty({ description: 'Detector evidence summary' })
  summary!: string;
}

export class ProposalEvidenceContractDto {
  @ApiProperty()
  contractId!: string;

  @ApiPropertyOptional({ nullable: true })
  clauseLabel!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Verbatim clause text' })
  clauseText!: string | null;
}

export class ProposalEvidenceDto {
  @ApiPropertyOptional({ type: ProposalEvidenceMeetingDto, nullable: true })
  meeting!: ProposalEvidenceMeetingDto | null;

  @ApiPropertyOptional({ type: ProposalEvidenceTranscriptDto, nullable: true })
  transcript!: ProposalEvidenceTranscriptDto | null;

  @ApiPropertyOptional({ type: ProposalEvidenceDetectionDto, nullable: true })
  detection!: ProposalEvidenceDetectionDto | null;

  @ApiPropertyOptional({ type: ProposalEvidenceContractDto, nullable: true })
  contract!: ProposalEvidenceContractDto | null;
}

// Full detail: summary + lines (with provenance chips) + evidence + xero status.
export class ProposalDetailDto extends ProposalSummaryDto {
  @ApiProperty({ type: [ProposalLineDto] })
  lines!: ProposalLineDto[];

  @ApiProperty({ type: ProposalEvidenceDto })
  evidence!: ProposalEvidenceDto;

  @ApiPropertyOptional({ nullable: true, description: 'Live Xero status (DRAFT/AUTHORISED/...) if written' })
  xeroStatus!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Last Xero write error, if the write failed' })
  xeroError!: string | null;
}

// Result of approve / save-draft / reject / patch — enough to update the card in place.
export class ProposalActionResultDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: InvoiceProposalState })
  state!: InvoiceProposalState;

  @ApiProperty({ description: 'Did the Xero write succeed?' })
  xeroWritten!: boolean;

  @ApiPropertyOptional({ nullable: true })
  xeroInvoiceId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  xeroInvoiceNumber!: string | null;

  @ApiPropertyOptional({ nullable: true })
  xeroDeepLink!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Xero error message when the write failed' })
  xeroError!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ISO timestamp when Xero emailed the invoice to the client; null if not emailed',
  })
  emailedAt!: string | null;

  @ApiProperty({ example: 225 })
  subtotal!: number;

  @ApiProperty({ example: 45 })
  taxTotal!: number;

  @ApiProperty({ example: 270 })
  total!: number;

  @ApiProperty({ description: 'Human sentence describing what happened' })
  message!: string;
}
