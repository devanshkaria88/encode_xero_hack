import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ProvenanceKind } from '../../../entities';

// One provenance chip on an invoice line — the citation that value came from.
export class LineProvenanceDto {
  @ApiProperty({ enum: ProvenanceKind, description: 'Where this value came from' })
  @IsEnum(ProvenanceKind)
  kind!: ProvenanceKind;

  @ApiProperty({ example: 'Clause 3.1', description: 'Short chip label' })
  @IsString()
  label!: string;

  @ApiProperty({
    example: 'Consultancy is billed at £150 per hour.',
    description: 'Verbatim quote / clause text / calendar block detail',
  })
  @IsString()
  detail!: string;

  @ApiPropertyOptional({ description: 'Source id (meeting / contract / quote id)' })
  @IsOptional()
  @IsString()
  source_ref?: string;
}

// An editable invoice line. quantity * unit_amount is recomputed server-side,
// so any client-supplied line_amount is authoritative only after recompute.
export class ProposalLineDto {
  @ApiProperty({ example: 'Consulting — Tue 3 Jun (1.5h @ 150 GBP/hour)' })
  @IsString()
  description!: string;

  @ApiProperty({ example: 1.5, description: 'Hours or units' })
  @IsNumber()
  quantity!: number;

  @ApiProperty({ example: 150, description: 'Rate per unit (pre-tax)' })
  @IsNumber()
  unit_amount!: number;

  @ApiPropertyOptional({ example: '200', description: 'Xero revenue account code' })
  @IsOptional()
  @IsString()
  account_code?: string;

  @ApiPropertyOptional({ example: 'OUTPUT2', description: 'Xero tax type' })
  @IsOptional()
  @IsString()
  tax_type?: string;

  @ApiProperty({ example: 225, description: 'quantity * unit_amount (recomputed server-side)' })
  @IsNumber()
  line_amount!: number;

  @ApiProperty({ type: [LineProvenanceDto], description: 'Citations for this line' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineProvenanceDto)
  provenance!: LineProvenanceDto[];
}
