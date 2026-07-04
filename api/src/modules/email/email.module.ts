import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PotentialClient, Task, Client, ConnectionState } from '../../entities';

// Loop 2: IMAP poll of the demo mailbox (reads ONLY queued potential-client
// addresses), fixture-mailbox fallback when IMAP creds are empty, and LLM
// agreement classification. The email agent implements the controller/service.
@Module({
  imports: [TypeOrmModule.forFeature([PotentialClient, Task, Client, ConnectionState])],
  providers: [],
  controllers: [],
  exports: [TypeOrmModule],
})
export class EmailModule {}
