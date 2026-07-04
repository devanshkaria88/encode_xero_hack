import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DetectionState, DetectionType } from '../../../entities';

// A single ledger detection, shaped for the list + the run result. The evidence
// blob is flexible per detector type (it always carries a human `summary` and a
// `source` of "xero" or "local" noting which path produced it).
export class DetectionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: DetectionType })
  type!: DetectionType;

  @ApiPropertyOptional({ nullable: true, description: 'Matched client id, if resolved' })
  clientId!: string | null;

  @ApiProperty({ description: 'Resolved client display name' })
  clientName!: string;

  @ApiProperty({ example: 4200, description: 'Recoverable value in GBP' })
  valueGbp!: number;

  @ApiProperty({ description: 'Human explanation of the leak (from evidence.summary)' })
  summary!: string;

  @ApiProperty({ enum: ['xero', 'local'], description: 'Which data path produced this detection' })
  source!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Flexible per-detector evidence blob (always includes summary + source)',
  })
  evidence!: Record<string, unknown>;

  @ApiProperty({ enum: DetectionState })
  state!: DetectionState;

  @ApiPropertyOptional({ nullable: true, description: 'Proposal built from this detection, if any' })
  proposalId!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Xero invoice id once invoiced' })
  xeroInvoiceId!: string | null;

  @ApiProperty({ description: 'ISO created timestamp' })
  createdAt!: string;
}

// Created-count breakdown by detector type.
export class DetectionTypeCountsDto {
  @ApiProperty({ example: 1 })
  QUOTE_NOT_INVOICED!: number;

  @ApiProperty({ example: 1 })
  RETAINER_STOPPED!: number;

  @ApiProperty({ example: 1 })
  EXPENSE_NOT_RECHARGED!: number;
}

// Result of POST /detections/run — counts plus the newly created rows.
export class RunDetectorsResultDto {
  @ApiProperty({ enum: ['xero', 'local', 'mixed'], description: 'Primary data path used this run' })
  source!: string;

  @ApiProperty({ description: 'Number of NEW detections created this run' })
  created!: number;

  @ApiProperty({ description: 'Candidates skipped because a detection already existed (idempotent)' })
  skipped!: number;

  @ApiProperty({ type: DetectionTypeCountsDto, description: 'Newly created, by detector type' })
  counts!: DetectionTypeCountsDto;

  @ApiProperty({ type: [DetectionDto], description: 'The detections created this run' })
  detections!: DetectionDto[];

  @ApiProperty({ description: 'ISO timestamp of this run' })
  ranAt!: string;

  @ApiProperty({ description: 'Human sentence describing what happened' })
  message!: string;
}

// Result of POST /detections/:id/propose.
export class DetectionProposeResultDto {
  @ApiProperty()
  detectionId!: string;

  @ApiProperty({ enum: DetectionState })
  detectionState!: DetectionState;

  @ApiProperty({ description: 'The invoice proposal built from this detection' })
  proposalId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Idempotency reference used in Xero' })
  proposalReference!: string | null;

  @ApiProperty({ example: 4200 })
  subtotal!: number;

  @ApiProperty({ example: 840 })
  taxTotal!: number;

  @ApiProperty({ example: 5040 })
  total!: number;

  @ApiPropertyOptional({ nullable: true, description: 'The REVIEW_INVOICE task raised for the human' })
  taskId!: string | null;

  @ApiProperty({ description: 'Human sentence describing what happened' })
  message!: string;
}

// Result of POST /detections/:id/dismiss.
export class DetectionActionResultDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: DetectionState })
  state!: DetectionState;

  @ApiProperty({ description: 'Human sentence describing what happened' })
  message!: string;
}
