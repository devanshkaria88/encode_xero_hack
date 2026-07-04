import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Cron } from '@nestjs/schedule';

import { isServing } from '../../common/bootstrap-flag';
import { EmailService } from './email.service';
import { EmailPollResultDto } from './dto/email-poll.dto';

// Loop 2 DETECT surface. The "check now" button and the 30-minute cron both
// run exactly the same poll. Tagged `connections` so it groups with the
// Connections panel (Calendar/Email check-now buttons live there).
@ApiTags('connections')
@Controller('email')
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Post('poll')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Poll the mailbox for client agreements (check now)',
    description:
      'Reads NEW messages FROM queued/watching potential-client addresses ONLY ' +
      '(IMAP when configured, else the seeded fixture mailbox), classifies each ' +
      'for agreement, and on agreement flips the PotentialClient to ' +
      'AGREEMENT_DETECTED and raises a CONFIRM_AGREEMENT task. Never reads a ' +
      'non-queued sender; never promotes a client (that is ClientsModule).',
  })
  @ApiOkResponse({ type: EmailPollResultDto })
  async poll(): Promise<EmailPollResultDto> {
    return this.email.poll();
  }

  // Same poll every 30 minutes. Guarded so the OpenAPI export never fires it.
  @Cron('0 */30 * * * *')
  async scheduledPoll(): Promise<void> {
    if (!isServing()) return;
    await this.email.poll();
  }
}
