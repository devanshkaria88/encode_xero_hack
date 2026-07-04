import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client, Contract, PotentialClient, Task } from '../../entities';

// Clients, contracts (with parsed clause viewer), autonomy toggle, and the
// potential-client queue. Controller/service implemented by the clients agent.
@Module({
  imports: [TypeOrmModule.forFeature([Client, Contract, PotentialClient, Task])],
  providers: [],
  controllers: [],
  exports: [TypeOrmModule],
})
export class ClientsModule {}
