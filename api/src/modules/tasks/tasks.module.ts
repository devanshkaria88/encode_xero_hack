import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Task,
  Meeting,
  InvoiceProposal,
  PotentialClient,
  Client,
  Contract,
} from '../../entities';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

// The Tasks inbox — the home screen. READ-ONLY: lists every OPEN task as a card
// with enriched render context; resolution is routed to the owning module's
// endpoint (surfaced via context.action), never performed here.
@Module({
  imports: [
    TypeOrmModule.forFeature([Task, Meeting, InvoiceProposal, PotentialClient, Client, Contract]),
  ],
  providers: [TasksService],
  controllers: [TasksController],
  exports: [TypeOrmModule],
})
export class TasksModule {}
