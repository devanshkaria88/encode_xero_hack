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
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// Aggregate read surfaces: the calendar-view feed (events colour-coded by
// state), the leak strip (recoverable £ this month), the audit trail and the
// headline summary. Read-only — every mutation lives in its owning module.
@Module({
  imports: [
    TypeOrmModule.forFeature([Meeting, Client, InvoiceProposal, Detection, Task, AuditEvent]),
  ],
  providers: [DashboardService],
  controllers: [DashboardController],
  exports: [TypeOrmModule],
})
export class DashboardModule {}
