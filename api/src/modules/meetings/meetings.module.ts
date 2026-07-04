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
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

// Loop 1: calendar sync (Google OAuth read-only + .ics fallback), transcript
// gate, attendee->client matching, and proposal building. The engine decides
// billed/unbilled; the LLM only parses transcripts and proposes fuzzy matches.
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
  ],
  providers: [MeetingsService],
  controllers: [MeetingsController],
  exports: [TypeOrmModule],
})
export class MeetingsModule {}
