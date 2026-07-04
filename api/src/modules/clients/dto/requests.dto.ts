import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

// PATCH /clients/:id/autonomy — flip the per-client auto-send policy.
export class UpdateAutonomyDto {
  @ApiProperty({
    description:
      'When true, Robyn may auto-send invoices for this client within contract terms. Default policy is OFF.',
    example: true,
  })
  @IsBoolean()
  enabled!: boolean;
}

// POST /clients/:id/contract — paste raw contract text for Robyn to parse.
export class UpsertContractDto {
  @ApiPropertyOptional({
    description: 'Human title for the contract (used as the file reference and card heading).',
    example: 'Fenwick Interiors — Consulting Agreement 2026',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({
    description:
      'The full contract text. Robyn parses the rate, terms and clauses from this, citing each value back to its clause.',
    example:
      'Clause 3.1 The Consultant shall be paid at a rate of GBP 150 per hour. Clause 5 Payment terms are Net 14.',
  })
  @IsString()
  @IsNotEmpty()
  rawText!: string;
}

// POST /potential-clients/:id/dismiss — remove a prospect from the queue.
export class DismissPotentialClientDto {
  @ApiPropertyOptional({
    description: 'Optional reason recorded on the audit trail for dismissing this prospect.',
    example: 'Not a real lead — internal calendar invite.',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
