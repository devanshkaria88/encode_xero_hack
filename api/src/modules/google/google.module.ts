import { Module } from '@nestjs/common';
import { GoogleClientModule } from './google-client.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { EmailModule } from '../email/email.module';
import { GoogleService } from './google.service';
import { GoogleController } from './google.controller';

// Google OAuth + sync surface: auth-url / callback / status / sync /
// disconnect and the 15-minute cron (offset from the meetings cron). Calendar
// events flow through the EXISTING meetings pipeline (MeetingsService.sync);
// Gmail messages flow through the EXISTING email classify path
// (EmailService.processInboundMessages) — queued potential-client senders
// ONLY. Each scope degrades independently: no gmail grant leaves the EMAIL
// fixture fallback untouched.
@Module({
  imports: [GoogleClientModule, MeetingsModule, EmailModule],
  providers: [GoogleService],
  controllers: [GoogleController],
})
export class GoogleModule {}
