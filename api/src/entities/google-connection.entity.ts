import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

// Sync lifecycle of the Google connection. PENDING = connected but the first
// sync has not completed yet.
export enum GoogleSyncStatus {
  PENDING = 'PENDING',
  SYNCING = 'SYNCING',
  OK = 'OK',
  ERROR = 'ERROR',
}

// The one Google OAuth connection (single-user demo — at most one row).
// accessToken/refreshToken are secrets: never logged, never in audit inputs,
// never in any DTO. Everything else on the row is safe to surface.
@Entity('google_connections')
export class GoogleConnection extends BaseEntity {
  @Column({ type: 'varchar', nullable: true })
  accountEmail!: string | null;

  @Column({ type: 'text' })
  accessToken!: string;

  // Only returned by Google on a consented offline grant — nullable by design.
  @Column({ type: 'text', nullable: true })
  refreshToken!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  tokenExpiresAt!: Date | null;

  // Space-separated scopes actually granted (token response `scope` field).
  // Users can untick individual scopes on the consent screen, so calendar and
  // gmail features each gate on this — never on what we merely requested.
  @Column({ type: 'text', default: '' })
  grantedScopes!: string;

  // Google Calendar incremental sync token (null => next sync is a full one).
  @Column({ type: 'varchar', length: 512, nullable: true })
  calendarSyncToken!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncAt!: Date | null;

  @Column({ type: 'enum', enum: GoogleSyncStatus, default: GoogleSyncStatus.PENDING })
  syncStatus!: GoogleSyncStatus;

  @Column({ type: 'text', nullable: true })
  syncError!: string | null;
}
