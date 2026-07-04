import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectionState } from '../../entities';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';

// Connections panel. Owns integration health, surfaced truthfully (XERO probed
// live from Xero.health(); CALENDAR/EMAIL read from the ConnectionState rows
// their own modules upsert). READ + refresh only — it never triggers the
// calendar/email jobs (those live behind POST /meetings/sync + POST /email/poll).
@Module({
  imports: [TypeOrmModule.forFeature([ConnectionState])],
  providers: [ConnectionsService],
  controllers: [ConnectionsController],
  exports: [TypeOrmModule],
})
export class ConnectionsModule {}
