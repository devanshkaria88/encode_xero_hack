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

// Invoice proposals: review, approve, and the Xero write path (contact ensure,
// invoice create draft/authorised, history note, attachment). The proposals
// agent implements the controller/service using XeroService + AuditService.
@Module({
  imports: [
    TypeOrmModule.forFeature([InvoiceProposal, Meeting, Detection, Client, Contract, Task, Transcript]),
  ],
  providers: [],
  controllers: [],
  exports: [TypeOrmModule],
})
export class ProposalsModule {}
