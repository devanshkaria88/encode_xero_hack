import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { ProposalLineDto } from './proposal-line.dto';

// PATCH /proposals/:id/lines — replace the line set; totals are recomputed.
export class PatchLinesDto {
  @ApiProperty({ type: [ProposalLineDto], description: 'The full edited line set' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProposalLineDto)
  lines!: ProposalLineDto[];
}
