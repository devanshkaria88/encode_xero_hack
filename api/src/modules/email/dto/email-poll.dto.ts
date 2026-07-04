import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConnectionStatus } from '../../../entities';

// One prospective-client agreement found on this poll. Rendered on the
// CONFIRM_AGREEMENT task card; the human confirms (ClientsModule promotes).
export class DetectedAgreementDto {
  @ApiProperty({ description: 'PotentialClient id whose sender agreed.' })
  potentialClientId!: string;

  @ApiProperty({ description: 'Display name of the prospective client.' })
  displayName!: string;

  @ApiProperty({ description: 'Sender address the agreement came from.' })
  from!: string;

  @ApiProperty({ description: 'Subject line of the agreeing email.' })
  subject!: string;

  @ApiProperty({ description: 'Verbatim sentence evidencing the agreement.' })
  quote!: string;

  @ApiPropertyOptional({
    description: 'Id of the CONFIRM_AGREEMENT task raised (absent if one was already open).',
  })
  taskId?: string;
}

// The result of an email poll (POST /email/poll or the 30m cron).
export class EmailPollResultDto {
  @ApiProperty({
    enum: ConnectionStatus,
    description: 'LIVE = IMAP mailbox, FALLBACK = fixture mailbox, DOWN = IMAP configured but unreachable.',
  })
  mode!: ConnectionStatus;

  @ApiProperty({ description: 'Human explanation of the mode/status.' })
  detail!: string;

  @ApiProperty({ description: 'Number of QUEUED/WATCHING potential clients polled.' })
  polledCount!: number;

  @ApiProperty({ description: 'Number of new messages read from queued senders only.' })
  messagesRead!: number;

  @ApiProperty({ description: 'Number of potential clients moved to AGREEMENT_DETECTED this poll.' })
  agreementsDetected!: number;

  @ApiProperty({ description: 'Number of new CONFIRM_AGREEMENT tasks raised this poll.' })
  tasksRaised!: number;

  @ApiProperty({ type: [DetectedAgreementDto], description: 'The agreements detected on this poll.' })
  detected!: DetectedAgreementDto[];

  @ApiProperty({ description: 'When this poll ran (ISO 8601).' })
  polledAt!: string;

  @ApiProperty({ description: 'When the next scheduled poll is due (ISO 8601, now + 30m).' })
  nextPollAt!: string;
}
