import { ApiProperty } from '@nestjs/swagger';
import { TaskType } from '../../../entities';

// One badge count. Every TaskType is always present (0 when none) so the
// frontend can render stable badges without null checks.
export class TaskTypeCountDto {
  @ApiProperty({ enum: TaskType })
  type!: TaskType;

  @ApiProperty({ description: 'Number of OPEN tasks of this type.' })
  count!: number;
}

export class TaskCountsDto {
  @ApiProperty({ description: 'Total OPEN tasks.' })
  total!: number;

  @ApiProperty({ type: [TaskTypeCountDto] })
  byType!: TaskTypeCountDto[];
}
