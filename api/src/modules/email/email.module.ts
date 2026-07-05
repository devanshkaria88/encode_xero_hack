import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PotentialClient, Task, Client, ConnectionState } from '../../entities';
import { ClientsModule } from '../clients/clients.module';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';

// Loop 2: IMAP poll of the demo mailbox (reads ONLY queued potential-client
// addresses), fixture-mailbox fallback when IMAP creds are empty, and LLM
// agreement classification. Promotion logic still lives in ClientsModule —
// the agreement-PDF auto-onboard calls the SAME ClientsService promotion and
// contract-upsert paths the human confirm endpoints use.
@Module({
  imports: [
    TypeOrmModule.forFeature([PotentialClient, Task, Client, ConnectionState]),
    ClientsModule,
  ],
  providers: [EmailService],
  controllers: [EmailController],
  // EmailService is exported for the Google module's Gmail sync, which feeds
  // messages through the same classify path (queued senders only).
  exports: [TypeOrmModule, EmailService],
})
export class EmailModule {}
