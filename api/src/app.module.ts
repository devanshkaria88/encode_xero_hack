import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'node:path';

import { ALL_ENTITIES } from './entities';
import { AuditModule } from './modules/audit/audit.module';
import { XeroModule } from './modules/xero/xero.module';
import { LlmModule } from './modules/llm/llm.module';
import { EngineModule } from './modules/engine/engine.module';
import { ClientsModule } from './modules/clients/clients.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { EmailModule } from './modules/email/email.module';
import { ProposalsModule } from './modules/proposals/proposals.module';
import { DetectionsModule } from './modules/detections/detections.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { ConnectionsModule } from './modules/connections/connections.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, '..', '.env'),
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: ALL_ENTITIES,
      synchronize: true, // hackathon: schema auto-managed. No migrations.
      retryAttempts: 3,
      retryDelay: 1500,
    }),
    ScheduleModule.forRoot(),
    // Shared kernel
    AuditModule,
    XeroModule,
    LlmModule,
    EngineModule,
    // Feature surfaces
    ClientsModule,
    MeetingsModule,
    EmailModule,
    ProposalsModule,
    DetectionsModule,
    TasksModule,
    ConnectionsModule,
    DashboardModule,
    HealthModule,
  ],
})
export class AppModule {}
