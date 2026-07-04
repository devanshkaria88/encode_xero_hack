import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { PotentialClientState } from './enums';
import { AgreementEvidence } from './shapes';

@Entity('potential_clients')
export class PotentialClient extends BaseEntity {
  @Column({ type: 'jsonb', default: () => "'[]'" })
  emails!: string[];

  @Column({ type: 'varchar' })
  displayName!: string;

  @Column({ type: 'uuid', nullable: true })
  firstSeenMeetingId!: string | null;

  @Index()
  @Column({ type: 'enum', enum: PotentialClientState, default: PotentialClientState.QUEUED })
  state!: PotentialClientState;

  @Column({ type: 'jsonb', nullable: true })
  evidence!: AgreementEvidence | null;

  // Set once promoted into a real Client.
  @Column({ type: 'uuid', nullable: true })
  promotedClientId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastPolledAt!: Date | null;
}
