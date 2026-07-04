import { ApiProperty } from '@nestjs/swagger';
import { ConnectionKind, ConnectionStatus } from '../../../entities';

// One row on the Connections panel. Honest integration health — LIVE vs
// FALLBACK vs DOWN is never faked. XERO is computed live from XeroService.health();
// CALENDAR/EMAIL are read from the ConnectionState rows their own modules upsert.
export class ConnectionRowDto {
  @ApiProperty({
    enum: ConnectionKind,
    description: 'Which integration this row describes.',
    example: ConnectionKind.XERO,
  })
  kind!: ConnectionKind;

  @ApiProperty({
    enum: ConnectionStatus,
    description:
      'LIVE (real credentials working), FALLBACK (running on seed/fixtures), or DOWN (not connected / never run).',
    example: ConnectionStatus.LIVE,
  })
  status!: ConnectionStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Short label: org name, mailbox address, or calendar id.',
    example: 'Robyn Demo Co',
  })
  label!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Human explanation of the current status (e.g. the reason a connection is DOWN).',
    example: 'Connected via Custom Connection.',
  })
  detail!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'ISO timestamp of the last successful sync/probe for this integration.',
    example: '2026-07-04T10:15:00.000Z',
  })
  lastSyncAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'ISO timestamp of the next scheduled poll (EMAIL cron), if any.',
    example: '2026-07-04T10:45:00.000Z',
  })
  nextPollAt!: string | null;
}
