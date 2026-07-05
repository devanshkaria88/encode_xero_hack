import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GoogleSyncStatus } from '../../../entities/google-connection.entity';

export class GoogleAuthUrlDto {
  @ApiProperty({
    description:
      'Google consent screen URL. Open it in the browser; Google redirects back to the registered callback.',
  })
  url!: string;
}

export class GoogleCallbackResultDto {
  @ApiProperty({ description: 'True once a Google connection is stored.' })
  connected!: boolean;

  @ApiPropertyOptional({ nullable: true, example: 'devansh88karia@gmail.com' })
  accountEmail!: string | null;

  @ApiProperty({
    type: [String],
    description: 'The scopes the user actually granted (they can untick any on the consent screen).',
  })
  grantedScopes!: string[];
}

export class GoogleScopeGrantDto {
  @ApiProperty({ description: 'Whether this scope was granted on the consent screen.' })
  granted!: boolean;
}

export class GoogleStatusDto {
  @ApiProperty()
  connected!: boolean;

  @ApiPropertyOptional({ nullable: true })
  accountEmail!: string | null;

  @ApiProperty({ type: [String] })
  grantedScopes!: string[];

  @ApiPropertyOptional({ nullable: true, description: 'ISO timestamp of the last finished sync.' })
  lastSyncAt!: string | null;

  @ApiPropertyOptional({ enum: GoogleSyncStatus, enumName: 'GoogleSyncStatus', nullable: true })
  syncStatus!: GoogleSyncStatus | null;

  @ApiPropertyOptional({ nullable: true, description: 'Why the last sync failed, if it did.' })
  syncError!: string | null;

  @ApiProperty({ type: GoogleScopeGrantDto })
  calendar!: GoogleScopeGrantDto;

  @ApiProperty({ type: GoogleScopeGrantDto })
  gmail!: GoogleScopeGrantDto;
}

export class GoogleCalendarSyncDto {
  @ApiProperty({ description: 'True when events came from Google this run (not a fallback).' })
  synced!: boolean;

  @ApiProperty({ description: 'New meetings created.' })
  imported!: number;

  @ApiProperty({ description: 'Existing meetings refreshed.' })
  updated!: number;

  @ApiProperty({ description: 'Meetings the Loop-1 step ran on.' })
  processed!: number;
}

export class GoogleGmailSyncDto {
  @ApiProperty({ description: 'True when the Gmail INBOX was polled this run (scope granted).' })
  synced!: boolean;

  @ApiProperty({ description: 'Messages read — queued potential-client senders only.' })
  messagesRead!: number;

  @ApiProperty({ description: 'Potential clients moved to AGREEMENT_DETECTED.' })
  agreementsDetected!: number;

  @ApiProperty({ description: 'New CONFIRM_AGREEMENT tasks raised.' })
  tasksRaised!: number;
}

export class GoogleSyncResultDto {
  @ApiProperty({ type: GoogleCalendarSyncDto })
  calendar!: GoogleCalendarSyncDto;

  @ApiProperty({ type: GoogleGmailSyncDto })
  gmail!: GoogleGmailSyncDto;

  @ApiProperty({ enum: GoogleSyncStatus, enumName: 'GoogleSyncStatus' })
  syncStatus!: GoogleSyncStatus;

  @ApiPropertyOptional({ nullable: true })
  syncError!: string | null;

  @ApiProperty({ description: 'ISO timestamp of this sync.' })
  lastSyncAt!: string;
}

export class GoogleDisconnectResultDto {
  @ApiProperty({ description: 'The connection row is gone (idempotent — true even if none existed).' })
  disconnected!: boolean;

  @ApiProperty({ description: 'Whether the best-effort Google token revoke succeeded.' })
  revoked!: boolean;
}
