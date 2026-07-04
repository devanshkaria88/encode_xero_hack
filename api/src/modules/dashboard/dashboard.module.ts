import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Meeting,
  Client,
  InvoiceProposal,
  Detection,
  Task,
  AuditEvent,
} from '../../entities';

// Aggregate read surfaces: the calendar-view feed (events colour-coded by
// state), the leak strip (recoverable £ this month), and the audit trail.
// The dashboard agent implements the controller/service.
@Module({
  imports: [
    TypeOrmModule.forFeature([Meeting, Client, InvoiceProposal, Detection, Task, AuditEvent]),
  ],
  providers: [],
  controllers: [],
  exports: [TypeOrmModule],
})
export class DashboardModule {}
