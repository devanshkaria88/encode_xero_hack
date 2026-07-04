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
} from '../../entities';

// Loop 1: calendar sync (Google OAuth + .ics fallback), transcript gate,
// attendee->client matching, and proposal building. The meetings agent
// implements the controller/service using EngineService + LlmService + XeroService.
@Module({
  imports: [
    TypeOrmModule.forFeature([Meeting, Transcript, Client, Contract, PotentialClient, Task, InvoiceProposal]),
  ],
  providers: [],
  controllers: [],
  exports: [TypeOrmModule],
})
export class MeetingsModule {}
