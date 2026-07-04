import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { InvoiceProposalState } from './enums';
import { ProposalLine, PolicyResult } from './shapes';

@Entity('invoice_proposals')
export class InvoiceProposal extends BaseEntity {
  // Source is exactly one of meetingId or detectionId.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  meetingId!: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  detectionId!: string | null;

  @Index()
  @Column({ type: 'uuid' })
  clientId!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  lines!: ProposalLine[];

  @Column({ type: 'varchar', default: 'GBP' })
  currency!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  subtotal!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  taxTotal!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total!: number;

  @Column({ type: 'jsonb' })
  policyResult!: PolicyResult;

  @Index()
  @Column({ type: 'enum', enum: InvoiceProposalState, default: InvoiceProposalState.DRAFT })
  state!: InvoiceProposalState;

  @Column({ type: 'varchar', nullable: true })
  xeroInvoiceId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  xeroInvoiceNumber!: string | null;

  // Deep-link into the Xero UI once written.
  @Column({ type: 'varchar', nullable: true })
  xeroDeepLink!: string | null;

  // The stable Reference used for idempotent check-by-reference in Xero.
  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  reference!: string | null;

  // Whether this proposal was auto-sent (autonomy ON) vs human-approved.
  @Column({ type: 'boolean', default: false })
  autoSent!: boolean;
}
