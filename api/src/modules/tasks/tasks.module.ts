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

// The Tasks inbox — the home screen. Lists every OPEN task as a resolvable
// card and routes each resolution to the right service. The tasks agent
// implements the controller/service.
@Module({
  imports: [
    TypeOrmModule.forFeature([Task, Meeting, InvoiceProposal, PotentialClient, Client, Contract]),
  ],
  providers: [],
  controllers: [],
  exports: [TypeOrmModule],
})
export class TasksModule {}
