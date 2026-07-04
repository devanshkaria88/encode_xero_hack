import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { TaskType, TaskState, TaskRefType } from './enums';

@Entity('tasks')
export class Task extends BaseEntity {
  @Index()
  @Column({ type: 'enum', enum: TaskType })
  type!: TaskType;

  @Column({ type: 'enum', enum: TaskRefType })
  refType!: TaskRefType;

  @Index()
  @Column({ type: 'uuid' })
  refId!: string;

  @Index()
  @Column({ type: 'enum', enum: TaskState, default: TaskState.OPEN })
  state!: TaskState;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  // Free-form context the card needs to render (client name, quote, amount...).
  @Column({ type: 'jsonb', nullable: true })
  context!: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  resolution!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  // Idempotency: at most one OPEN task per (type, refId).
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  dedupeKey!: string;
}
