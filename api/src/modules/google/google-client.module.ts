import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectionState } from '../../entities';
import { GoogleConnection } from '../../entities/google-connection.entity';
import { GoogleClientService } from './google-client.service';

// Low-level Google access: the single GoogleConnection row, OAuth token
// exchange/refresh (5-min-early), calendar/gmail fetch helpers and provider
// ConnectionState flips. Deliberately free of feature-module dependencies so
// both MeetingsModule and GoogleModule import it without a cycle.
@Module({
  imports: [TypeOrmModule.forFeature([GoogleConnection, ConnectionState])],
  providers: [GoogleClientService],
  exports: [GoogleClientService],
})
export class GoogleClientModule {}
