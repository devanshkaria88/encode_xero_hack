import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaRequestMCPServerURLDefinition,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { loadConfig } from '../../config/env';
import { AuditActor } from '../../entities';
import { AgentSettings } from '../../entities/agent-settings.entity';
import { AuditService } from '../audit/audit.service';
import { AgentSettingsService } from './agent-settings.service';
import { ChatToolsService } from './chat-tools.service';
import { ChatRequestDto, ChatSseEvent } from './dto/chat.dto';

// The agentic chat loop. The model PROPOSES tool calls; this service executes
// strictly read-only tools and streams the conversation to the client as SSE.
// No Xero writes, no state transitions, no task resolution — ever.

const MAX_ROUNDS = 8;
const TURN_TIMEOUT_MS = 90_000;
const MAX_TOKENS_PER_ROUND = 2048;

// Non-negotiable suffix appended AFTER the user-editable prompt and skills so
// a custom prompt can't talk Robyn out of the read-only/citation rules.
function hardRules(todayIso: string): string {
  return [
    '## Operating rules (non-negotiable)',
    '- You are a READ-ONLY advisor. You cannot send invoices, resolve tasks, change settings or write to Xero. When the user wants an action taken, point them at the Robyn screen that does it (Tasks inbox, Invoices, Settings).',
    '- Cite numbers ONLY from tool results in this conversation. If you have not fetched a figure, say you have not checked it — never estimate or invent one.',
    '- Money is GBP. Format as £1,234.56, or £1,234 for whole pounds.',
    `- Today's date is ${todayIso}.`,
    '- Keep answers tight: lead with the answer or number, then at most a few supporting lines. Use tools before answering any question about the business.',
  ].join('\n');
}

function sanitizeMcpName(name: string, taken: Set<string>): string {
  let base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'server';
  let candidate = base;
  let i = 2;
  while (taken.has(candidate)) candidate = `${base}-${i++}`;
  taken.add(candidate);
  return candidate;
}

@Injectable()
export class ChatService {
  private readonly log = new Logger('ChatService');
  private readonly client: Anthropic;

  constructor(
    private readonly settingsService: AgentSettingsService,
    private readonly tools: ChatToolsService,
    private readonly audit: AuditService,
  ) {
    // Same client-construction pattern as LlmService; one retry so a slow
    // round can't eat the whole 90s turn budget.
    this.client = new Anthropic({ apiKey: loadConfig().anthropicApiKey, maxRetries: 1 });
  }

  async starters(): Promise<string[]> {
    return this.tools.starters();
  }

  private buildSystemPrompt(settings: AgentSettings): string {
    const parts = [settings.systemPrompt.trim()];
    for (const skill of settings.skills ?? []) {
      if (skill.enabled && skill.instructions?.trim()) {
        parts.push(`## Skill: ${skill.name}\n${skill.instructions.trim()}`);
      }
    }
    parts.push(hardRules(new Date().toISOString().slice(0, 10)));
    return parts.join('\n\n');
  }

  // Stream one chat turn. Emits text/tool events via `emit`; the controller
  // owns the terminal done/error events and the response lifecycle.
  async streamChat(dto: ChatRequestDto, emit: (evt: ChatSseEvent) => void, signal?: AbortSignal): Promise<void> {
    const settings = await this.settingsService.getOrCreate();
    const system = this.buildSystemPrompt(settings);

    // Custom read-only tools + optionally Anthropic's server-side web search.
    // SDK 0.68 typings predate web_search_20260209 — declared as a plain
    // object; the request params are cast once below.
    const baseTools: unknown[] = [...this.tools.definitions()];
    if (settings.webSearchEnabled) {
      baseTools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 3 });
    }

    // User-added MCP servers ride the Messages API MCP connector: each server
    // needs BOTH an mcp_servers entry and a matching mcp_toolset tools entry.
    const enabledServers = (settings.mcpServers ?? []).filter((s) => s.enabled && s.url);
    const takenNames = new Set<string>();
    const mcpServers: BetaRequestMCPServerURLDefinition[] = enabledServers.map((s) => ({
      type: 'url',
      name: sanitizeMcpName(s.name, takenNames),
      url: s.url,
      ...(s.authToken ? { authorization_token: s.authToken } : {}),
    }));
    // mcp_toolset is not in SDK 0.68 typings either — plain objects, cast below.
    const mcpToolsets: unknown[] = mcpServers.map((s) => ({ type: 'mcp_toolset', mcp_server_name: s.name }));
    let mcpActive = mcpServers.length > 0;

    const history: BetaMessageParam[] = dto.messages.map((m) => ({ role: m.role, content: m.content }));
    const deadline = Date.now() + TURN_TIMEOUT_MS;
    const toolsUsed: string[] = [];
    let rounds = 0;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (Date.now() >= deadline || signal?.aborted) break;

      let message: BetaMessage;
      try {
        message = await this.runRound({
          model: settings.model,
          system,
          history,
          tools: mcpActive ? [...baseTools, ...mcpToolsets] : baseTools,
          mcpServers: mcpActive ? mcpServers : undefined,
          emit,
          signal,
          deadline,
        });
      } catch (e) {
        if (signal?.aborted) return; // client went away — stop quietly
        if (mcpActive) {
          // A user-added MCP server must never hard-fail the chat: drop MCP
          // for this turn, tell the client, and retry the same round.
          this.log.warn(`MCP round failed, retrying without MCP: ${String(e).slice(0, 200)}`);
          emit({ type: 'tool', name: 'mcp', status: 'error' });
          mcpActive = false;
          round--;
          continue;
        }
        if (Date.now() >= deadline) break; // out of budget — finish with what we have
        throw e;
      }
      rounds++;

      // Echo the assistant turn back verbatim (tool_use / server tool blocks
      // included) so the API can continue the loop.
      history.push({ role: 'assistant', content: message.content as unknown as BetaContentBlockParam[] });

      if (message.stop_reason === 'pause_turn') {
        // Server-side tool (web search) paused a long turn — re-request so the
        // server resumes. No user message is injected.
        continue;
      }

      if (message.stop_reason !== 'tool_use') break;

      const toolUses = message.content.filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use');
      if (toolUses.length === 0) break;

      // Execute every requested tool, then return ALL results in ONE user
      // message (splitting them breaks parallel tool use).
      const results: BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        emit({ type: 'tool', name: tu.name, status: 'running' });
        toolsUsed.push(tu.name);
        const outcome = await this.tools.execute(tu.name, tu.input);
        emit({ type: 'tool', name: tu.name, status: outcome.isError ? 'error' : 'done' });
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: outcome.content,
          ...(outcome.isError ? { is_error: true } : {}),
        });
      }
      history.push({ role: 'user', content: results });
    }

    // Reads are not mutations, but the turn itself is recorded so the audit
    // trail shows what the advisor consulted.
    try {
      await this.audit.record({
        actor: AuditActor.LLM,
        action: 'chat.turn',
        summary: `Robyn chat answered using ${toolsUsed.length} tool call${toolsUsed.length === 1 ? '' : 's'}.`,
        subjectType: 'agent_settings',
        subjectId: settings.id,
        inputs: {
          tools: toolsUsed,
          rounds,
          webSearch: settings.webSearchEnabled,
          mcpServers: mcpServers.map((s) => s.name),
          mcpDegraded: mcpServers.length > 0 && !mcpActive,
        },
      });
    } catch (e) {
      this.log.warn(`chat.turn audit failed: ${String(e).slice(0, 160)}`);
    }
  }

  private async runRound(opts: {
    model: string;
    system: string;
    history: BetaMessageParam[];
    tools: unknown[];
    mcpServers?: BetaRequestMCPServerURLDefinition[];
    emit: (evt: ChatSseEvent) => void;
    signal?: AbortSignal;
    deadline: number;
  }): Promise<BetaMessage> {
    // Cast once: tools may contain web_search_20260209 / mcp_toolset entries
    // that SDK 0.68 typings don't know about (runtime API accepts them).
    const params: any = {
      model: opts.model,
      max_tokens: MAX_TOKENS_PER_ROUND,
      system: opts.system,
      messages: opts.history,
      tools: opts.tools,
    };
    if (opts.mcpServers?.length) {
      params.mcp_servers = opts.mcpServers;
      params.betas = ['mcp-client-2025-11-20'];
    }

    const stream = this.client.beta.messages.stream(params, {
      signal: opts.signal,
      timeout: Math.max(10_000, opts.deadline - Date.now()),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        opts.emit({ type: 'text', delta: event.delta.text });
      } else if (event.type === 'content_block_start') {
        // Server-side tools (web search, MCP connector) run inside the stream;
        // surface them as tool activity so the UI can show "thinking".
        const block = event.content_block as { type: string; name?: string; is_error?: boolean };
        if (block.type === 'server_tool_use') {
          opts.emit({ type: 'tool', name: block.name ?? 'web_search', status: 'running' });
        } else if (block.type === 'web_search_tool_result') {
          opts.emit({ type: 'tool', name: 'web_search', status: 'done' });
        } else if (block.type === 'mcp_tool_use') {
          opts.emit({ type: 'tool', name: `mcp:${block.name ?? 'tool'}`, status: 'running' });
        } else if (block.type === 'mcp_tool_result') {
          opts.emit({ type: 'tool', name: 'mcp', status: block.is_error ? 'error' : 'done' });
        }
      }
    }

    return stream.finalMessage();
  }
}
