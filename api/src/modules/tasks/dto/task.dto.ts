import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskType, TaskState, TaskRefType } from '../../../entities';

// Read-only view of a Task for the inbox and the audit-ish "all tasks" view.
// `context` is the jsonb payload the card needs to render AND (via `context.action`)
// the endpoint to call to resolve it. Resolution itself lives in the owning module.
export class TaskDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: TaskType })
  type!: TaskType;

  @ApiProperty({ enum: TaskRefType })
  refType!: TaskRefType;

  @ApiProperty({ format: 'uuid', description: 'Id of the referenced subject (meeting, proposal, ...)' })
  refId!: string;

  @ApiProperty({ enum: TaskState })
  state!: TaskState;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  summary!: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'Free-form card context (client name, amount, quote, ...). Includes an `action` { method, path } hint when derivable.',
  })
  context!: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, description: 'Set once resolved by the owning module.' })
  resolution!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  resolvedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
