import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// POST /detections/:id/dismiss — the human waves the leak off. The reason is
// optional (the button works with no body) but is kept on the audit trail.
export class DismissDetectionDto {
  @ApiPropertyOptional({
    example: 'Client was billed for this separately in cash.',
    description: 'Why the detection was dismissed (kept on the audit trail)',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
