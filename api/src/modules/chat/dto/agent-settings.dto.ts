import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CHAT_MODEL_OPTIONS } from '../../../entities/agent-settings.entity';

// ---- Response DTOs ---------------------------------------------------------
// Secrets never round-trip: stored MCP auth tokens are masked to the boolean
// `authConfigured` on every response.

export class McpServerDto {
  @ApiProperty({ description: 'Stable server id (assigned on create).' })
  id!: string;

  @ApiProperty({ description: 'Display name; also used as the MCP server name on the Anthropic API.' })
  name!: string;

  @ApiProperty({ description: 'Streamable-HTTP MCP endpoint URL.' })
  url!: string;

  @ApiProperty({
    description: 'True when a bearer token is stored for this server. The token itself is never returned.',
  })
  authConfigured!: boolean;

  @ApiProperty({ description: 'Whether the chat agent may use this server.' })
  enabled!: boolean;
}

export class SkillDto {
  @ApiProperty({ description: 'Stable skill id (assigned on create).' })
  id!: string;

  @ApiProperty({ description: 'Skill name, shown as a named section header in the system prompt.' })
  name!: string;

  @ApiProperty({ description: 'Instruction text appended to the system prompt when enabled.' })
  instructions!: string;

  @ApiProperty({ description: 'Whether this skill is appended to the system prompt.' })
  enabled!: boolean;
}

export class AgentSettingsDto {
  @ApiProperty({ description: 'Settings row id.', format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'The editable system prompt for Robyn chat.' })
  systemPrompt!: string;

  @ApiProperty({
    description: 'Anthropic model used for chat.',
    enum: CHAT_MODEL_OPTIONS,
    example: 'claude-sonnet-5',
  })
  model!: string;

  @ApiProperty({ description: "Whether Anthropic's server-side web search tool is enabled." })
  webSearchEnabled!: boolean;

  @ApiProperty({ type: [McpServerDto], description: 'User-added MCP servers (tokens masked).' })
  mcpServers!: McpServerDto[];

  @ApiProperty({ type: [SkillDto], description: 'Named instruction snippets for the system prompt.' })
  skills!: SkillDto[];

  @ApiProperty({ description: 'Last update time (ISO datetime).' })
  updatedAt!: string;
}

// ---- Update DTOs -----------------------------------------------------------

export class McpServerInputDto {
  @ApiPropertyOptional({
    description: 'Existing server id. Include it to update in place and keep the stored token.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @ApiProperty({ description: 'Display name.', maxLength: 80 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ description: 'Streamable-HTTP MCP endpoint URL (http/https).' })
  @IsString()
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2000)
  url!: string;

  @ApiPropertyOptional({
    description:
      'Bearer token for the server. Omit or send "" to keep the stored token; send null to clear it. Never returned in responses.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  authToken?: string | null;

  @ApiProperty({ description: 'Whether the chat agent may use this server.' })
  @IsBoolean()
  enabled!: boolean;
}

export class SkillInputDto {
  @ApiPropertyOptional({ description: 'Existing skill id. Include it to update in place.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @ApiProperty({ description: 'Skill name.', maxLength: 80 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ description: 'Instruction text appended to the system prompt when enabled.', maxLength: 8000 })
  @IsString()
  @MaxLength(8000)
  instructions!: string;

  @ApiProperty({ description: 'Whether this skill is active.' })
  @IsBoolean()
  enabled!: boolean;
}

export class UpdateAgentSettingsDto {
  @ApiPropertyOptional({ description: 'Replacement system prompt.', maxLength: 20000 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  systemPrompt?: string;

  @ApiPropertyOptional({
    description: 'Anthropic model for chat.',
    enum: CHAT_MODEL_OPTIONS,
  })
  @IsOptional()
  @IsIn(CHAT_MODEL_OPTIONS as unknown as string[])
  model?: string;

  @ApiPropertyOptional({ description: 'Toggle the server-side web search tool.' })
  @IsOptional()
  @IsBoolean()
  webSearchEnabled?: boolean;

  @ApiPropertyOptional({
    type: [McpServerInputDto],
    description:
      'Full replacement list of MCP servers. Servers that keep their id keep their stored token unless a new one is provided.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => McpServerInputDto)
  mcpServers?: McpServerInputDto[];

  @ApiPropertyOptional({
    type: [SkillInputDto],
    description: 'Full replacement list of skills.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SkillInputDto)
  skills?: SkillInputDto[];
}

// ---- MCP connection test ---------------------------------------------------

export class McpTestRequestDto {
  @ApiProperty({ description: 'Streamable-HTTP MCP endpoint URL to probe (nothing is persisted).' })
  @IsString()
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2000)
  url!: string;

  @ApiPropertyOptional({ description: 'Bearer token to probe with. Never persisted or logged.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  authToken?: string;
}

export class McpTestToolDto {
  @ApiProperty({ description: 'Tool name reported by the server.' })
  name!: string;

  @ApiProperty({ description: 'Tool description reported by the server.', nullable: true, type: String })
  description!: string | null;
}

export class McpTestResponseDto {
  @ApiProperty({ description: 'True when initialize + tools/list both succeeded.' })
  ok!: boolean;

  @ApiProperty({ type: [McpTestToolDto], description: 'Tools discovered on the server (empty on failure).' })
  tools!: McpTestToolDto[];

  @ApiProperty({ description: 'Human-readable failure reason, or null on success.', nullable: true, type: String })
  error!: string | null;
}
