import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PotentialClient, Task, Client, ConnectionState } from '../../entities';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';

// Loop 2: IMAP poll of the demo mailbox (reads ONLY queued potential-client
// addresses), fixture-mailbox fallback when IMAP creds are empty, and LLM
// agreement classification. Detect only — promotion lives in ClientsModule.
@Module({
  imports: [TypeOrmModule.forFeature([PotentialClient, Task, Client, ConnectionState])],
  providers: [EmailService],
  controllers: [EmailController],
  exports: [TypeOrmModule],
})
export class EmailModule {}
