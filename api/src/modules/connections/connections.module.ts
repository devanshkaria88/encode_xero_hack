import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectionState } from '../../entities';

// Connections panel + the scheduler. Owns integration health (LIVE vs FALLBACK,
// truthfully), the @Cron jobs (email poll, calendar sync, detectors), and the
// POST /internal/run/:job "check now" endpoints. The connections agent implements it.
@Module({
  imports: [TypeOrmModule.forFeature([ConnectionState])],
  providers: [],
  controllers: [],
  exports: [TypeOrmModule],
})
export class ConnectionsModule {}
