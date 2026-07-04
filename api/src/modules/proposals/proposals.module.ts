import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  InvoiceProposal,
  Meeting,
  Detection,
  Client,
  Contract,
  Task,
  Transcript,
} from '../../entities';

import { ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';

// Invoice proposals: review, approve, and the Xero write path (contact ensure,
// invoice create draft/authorised, history note, attachment). The controller
// and service use the global XeroService + AuditService plus the repos below.
@Module({
  imports: [
    TypeOrmModule.forFeature([InvoiceProposal, Meeting, Detection, Client, Contract, Task, Transcript]),
  ],
  providers: [ProposalsService],
  controllers: [ProposalsController],
  exports: [TypeOrmModule],
})
export class ProposalsModule {}
