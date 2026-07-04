import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { BillingProfile } from './shapes';

@Entity('clients')
export class Client extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  xeroContactId!: string | null; // null until created in Xero

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  emails!: string[];

  // Autonomy policy: default OFF. ON => Robyn may auto-send within terms.
  @Column({ type: 'boolean', default: false })
  autonomyEnabled!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  billingProfile!: BillingProfile | null;

  // Convenience denormalised total of unbilled exposure (recomputed by engine).
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  unbilledExposureGbp!: number;
}
