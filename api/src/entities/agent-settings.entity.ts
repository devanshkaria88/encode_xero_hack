import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

// Robyn's agentic-chat configuration. Single row, seeded on first read.
// Secrets note: mcpServers[].authToken is stored here but NEVER returned by
// the API — responses mask it to a boolean `authConfigured`.

export interface AgentMcpServer {
  id: string;
  name: string;
  url: string; // streamable-HTTP MCP endpoint
  authToken: string | null; // bearer token; never echoed to clients
  enabled: boolean;
}

export interface AgentSkill {
  id: string;
  name: string;
  instructions: string; // appended to the system prompt as a named section
  enabled: boolean;
}

// Models the settings UI may pick from. Sonnet 5 is the demo default
// (latency); Opus 4.8 is offered for maximum quality.
export const CHAT_MODEL_OPTIONS = [
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-haiku-4-5',
] as const;

export const DEFAULT_CHAT_MODEL = 'claude-sonnet-5';

export const DEFAULT_SYSTEM_PROMPT = [
  'You are Robyn, a sharp, plain-spoken finance copilot for a UK freelancer.',
  '',
  'You watch their calendar, contracts, meeting transcripts and Xero ledger, and you answer questions about the money side of their business: cash flow, unpaid invoices, unbilled work, and where money is leaking.',
  '',
  'How you work:',
  '- Always check the real data with your tools before answering a question about money. Never answer from memory alone.',
  '- Cite the actual numbers your tools return, in GBP.',
  '- Be concise and direct. Lead with the answer, then the two or three facts that support it.',
  '- If the data does not exist or a tool fails, say so plainly and suggest what to check instead. Never invent a figure.',
  '- You are an advisor: you read, explain and recommend. Sending invoices, approving proposals and resolving tasks happen in the Robyn app, not in chat.',
].join('\n');

@Entity('agent_settings')
export class AgentSettings extends BaseEntity {
  @Column({ type: 'text' })
  systemPrompt!: string;

  @Column({ type: 'varchar', default: DEFAULT_CHAT_MODEL })
  model!: string;

  @Column({ type: 'boolean', default: true })
  webSearchEnabled!: boolean;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  mcpServers!: AgentMcpServer[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  skills!: AgentSkill[];
}
