import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

// POST /proposals/:id/reject — the human declines this proposal.
export class RejectProposalDto {
  @ApiProperty({
    example: 'Client already paid this in cash — do not invoice.',
    description: 'Why the proposal was rejected (kept on the audit trail)',
  })
  @IsString()
  @MinLength(1)
  reason!: string;
}
