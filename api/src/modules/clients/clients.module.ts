import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client, Contract, PotentialClient, Task, InvoiceProposal } from '../../entities';
import { ClientsController } from './clients.controller';
import { PotentialClientsController } from './potential-clients.controller';
import { ClientsService } from './clients.service';

// Clients, contracts (with parsed clause viewer), autonomy toggle, and the
// potential-client queue. Owns the ATTACH_CONTRACT + CONFIRM_AGREEMENT task
// lifecycle. InvoiceProposal is read-only here (invoice history + exposure).
@Module({
  imports: [
    TypeOrmModule.forFeature([Client, Contract, PotentialClient, Task, InvoiceProposal]),
  ],
  providers: [ClientsService],
  controllers: [ClientsController, PotentialClientsController],
  exports: [TypeOrmModule],
})
export class ClientsModule {}
