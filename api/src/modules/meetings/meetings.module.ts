import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Meeting,
  Transcript,
  Client,
  Contract,
  PotentialClient,
  Task,
  InvoiceProposal,
  ConnectionState,
} from '../../entities';
import { GoogleClientModule } from '../google/google-client.module';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

// Loop 1: calendar sync (Google OAuth read-only + .ics fallback), transcript
// gate, attendee->client matching, and proposal building. The engine decides
// billed/unbilled; the LLM only parses transcripts and proposes fuzzy matches.
// GoogleClientModule is the low-level token/fetch layer (no cycle: it has no
// feature deps); the Google feature module reuses MeetingsService.sync().
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Meeting,
      Transcript,
      Client,
      Contract,
      PotentialClient,
      Task,
      InvoiceProposal,
      ConnectionState,
    ]),
    GoogleClientModule,
  ],
  providers: [MeetingsService],
  controllers: [MeetingsController],
  exports: [TypeOrmModule, MeetingsService],
})
export class MeetingsModule {}
