import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client, Detection, InvoiceProposal, Meeting, Task } from '../../entities';
import { AgentSettings } from '../../entities/agent-settings.entity';
import { AgentSettingsController } from './agent-settings.controller';
import { AgentSettingsService } from './agent-settings.service';
import { ChatController } from './chat.controller';
import { ChatToolsService } from './chat-tools.service';
import { ChatService } from './chat.service';

// Agentic chat: the user talks to Robyn about their business and the agent
// answers from REAL data via strictly read-only tools (Postgres rows + live
// Xero reads through the global XeroService). Settings (system prompt, model,
// web search, skills, MCP servers) live in the single-row AgentSettings
// entity. The LLM proposes; it never decides, never sends, never writes.
// XeroModule and AuditModule are @Global, so XeroService/AuditService inject
// without imports here.
@Module({
  imports: [
    TypeOrmModule.forFeature([AgentSettings, Meeting, Client, InvoiceProposal, Detection, Task]),
  ],
  providers: [AgentSettingsService, ChatToolsService, ChatService],
  controllers: [AgentSettingsController, ChatController],
})
export class ChatModule {}
