import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ConnectionKind, ConnectionStatus } from './enums';

// Integration health, surfaced truthfully on the Connections panel. One row
// per integration kind. Never faked — LIVE vs FALLBACK is the honest state.
@Entity('connection_states')
export class ConnectionState extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'enum', enum: ConnectionKind })
  kind!: ConnectionKind;

  @Column({ type: 'enum', enum: ConnectionStatus, default: ConnectionStatus.DOWN })
  status!: ConnectionStatus;

  @Column({ type: 'varchar', nullable: true })
  label!: string | null; // org name / mailbox / calendar id

  @Column({ type: 'text', nullable: true })
  detail!: string | null; // human explanation of the current status

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  nextPollAt!: Date | null;
}
