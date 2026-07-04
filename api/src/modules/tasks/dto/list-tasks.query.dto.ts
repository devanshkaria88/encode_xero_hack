import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { TaskState } from '../../../entities';

// Query for GET /tasks/all — optionally filter by state.
export class ListTasksQueryDto {
  @ApiPropertyOptional({ enum: TaskState, description: 'Filter by task state. Omit for all states.' })
  @IsOptional()
  @IsEnum(TaskState)
  state?: TaskState;
}
