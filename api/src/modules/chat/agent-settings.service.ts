import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  AgentSettings,
  DEFAULT_CHAT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
} from '../../entities/agent-settings.entity';
import { AuditActor } from '../../entities';
import { AuditService } from '../audit/audit.service';
import {
  AgentSettingsDto,
  McpTestResponseDto,
  UpdateAgentSettingsDto,
} from './dto/agent-settings.dto';
import { probeMcpServer } from './mcp-probe';

// Single-row settings for the chat agent. Seeded with sane defaults on first
// read. Every update writes an AuditEvent naming which fields changed —
// never the values, so tokens can't leak into the audit trail.
@Injectable()
export class AgentSettingsService {
  constructor(
    @InjectRepository(AgentSettings)
    private readonly repo: Repository<AgentSettings>,
    private readonly audit: AuditService,
  ) {}

  async getOrCreate(): Promise<AgentSettings> {
    const rows = await this.repo.find({ order: { createdAt: 'ASC' }, take: 1 });
    if (rows.length > 0) return rows[0];
    const seeded = this.repo.create({
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      model: DEFAULT_CHAT_MODEL,
      webSearchEnabled: true,
      mcpServers: [],
      skills: [],
    });
    return this.repo.save(seeded);
  }

  toDto(s: AgentSettings): AgentSettingsDto {
    return {
      id: s.id,
      systemPrompt: s.systemPrompt,
      model: s.model,
      webSearchEnabled: s.webSearchEnabled,
      // Mask secrets: token becomes a boolean, never the value.
      mcpServers: (s.mcpServers ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        url: m.url,
        authConfigured: Boolean(m.authToken),
        enabled: m.enabled,
      })),
      skills: (s.skills ?? []).map((sk) => ({
        id: sk.id,
        name: sk.name,
        instructions: sk.instructions,
        enabled: sk.enabled,
      })),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  async get(): Promise<AgentSettingsDto> {
    return this.toDto(await this.getOrCreate());
  }

  async update(dto: UpdateAgentSettingsDto): Promise<AgentSettingsDto> {
    const s = await this.getOrCreate();
    const changed: string[] = [];

    if (dto.systemPrompt !== undefined && dto.systemPrompt !== s.systemPrompt) {
      s.systemPrompt = dto.systemPrompt;
      changed.push('systemPrompt');
    }
    if (dto.model !== undefined && dto.model !== s.model) {
      s.model = dto.model;
      changed.push('model');
    }
    if (dto.webSearchEnabled !== undefined && dto.webSearchEnabled !== s.webSearchEnabled) {
      s.webSearchEnabled = dto.webSearchEnabled;
      changed.push('webSearchEnabled');
    }

    if (dto.mcpServers !== undefined) {
      // Wholesale replacement, but stored tokens survive when the incoming
      // server keeps its id and sends no new token ("leave blank to keep").
      const prevById = new Map((s.mcpServers ?? []).map((m) => [m.id, m]));
      s.mcpServers = dto.mcpServers.map((m) => {
        const prev = m.id ? prevById.get(m.id) : undefined;
        let authToken: string | null;
        if (m.authToken === null) authToken = null; // explicit clear
        else if (m.authToken !== undefined && m.authToken !== '') authToken = m.authToken;
        else authToken = prev?.authToken ?? null; // keep stored
        return {
          id: m.id ?? randomUUID(),
          name: m.name.trim(),
          url: m.url.trim(),
          authToken,
          enabled: m.enabled,
        };
      });
      changed.push('mcpServers');
    }

    if (dto.skills !== undefined) {
      s.skills = dto.skills.map((sk) => ({
        id: sk.id ?? randomUUID(),
        name: sk.name.trim(),
        instructions: sk.instructions,
        enabled: sk.enabled,
      }));
      changed.push('skills');
    }

    if (changed.length > 0) {
      await this.repo.save(s);
      await this.audit.record({
        actor: AuditActor.HUMAN,
        action: 'chat.settings_updated',
        summary: `Agent settings updated: ${changed.join(', ')}.`,
        subjectType: 'agent_settings',
        subjectId: s.id,
        // Field names and counts only — never values, never tokens.
        inputs: {
          fields: changed,
          mcpServerCount: (s.mcpServers ?? []).length,
          skillCount: (s.skills ?? []).length,
        },
      });
    }

    return this.toDto(s);
  }

  // Probe an MCP endpoint without persisting anything. Plain fetch, 5s budget.
  async testMcpServer(url: string, authToken?: string): Promise<McpTestResponseDto> {
    const result = await probeMcpServer(url, authToken);
    return { ok: result.ok, tools: result.tools, error: result.error };
  }
}
