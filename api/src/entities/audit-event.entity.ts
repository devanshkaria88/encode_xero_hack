import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { AuditActor } from './enums';

// Every state change, Xero write, policy decision and poll result creates one
// of these. No silent mutations — this table is the audit trail screen.
@Entity('audit_events')
export class AuditEvent extends BaseEntity {
  @Index()
  @Column({ type: 'enum', enum: AuditActor })
  actor!: AuditActor;

  // Short machine verb, e.g. "meeting.transcript_attached", "xero.invoice.created".
  @Index()
  @Column({ type: 'varchar' })
  action!: string;

  // Human sentence for the audit screen.
  @Column({ type: 'text' })
  summary!: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  subjectType!: string | null; // 'meeting' | 'proposal' | 'client' | ...

  @Index()
  @Column({ type: 'uuid', nullable: true })
  subjectId!: string | null;

  // The inputs to the decision — kept so an auditor can reconstruct it.
  @Column({ type: 'jsonb', nullable: true })
  inputs!: Record<string, unknown> | null;
}
