import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { DetectionType, DetectionState } from './enums';
import { DetectionEvidence } from './shapes';

@Entity('detections')
export class Detection extends BaseEntity {
  @Index()
  @Column({ type: 'enum', enum: DetectionType })
  type!: DetectionType;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  clientId!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  valueGbp!: number;

  @Column({ type: 'jsonb' })
  evidence!: DetectionEvidence;

  @Index()
  @Column({ type: 'enum', enum: DetectionState, default: DetectionState.OPEN })
  state!: DetectionState;

  @Column({ type: 'varchar', nullable: true })
  xeroInvoiceId!: string | null;

  // Stable dedupe key so re-running detectors is idempotent.
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  dedupeKey!: string;
}
