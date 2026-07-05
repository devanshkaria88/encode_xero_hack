import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentSettingsService } from './agent-settings.service';
import {
  AgentSettingsDto,
  McpTestRequestDto,
  McpTestResponseDto,
  UpdateAgentSettingsDto,
} from './dto/agent-settings.dto';

@ApiTags('chat')
@Controller('agent-settings')
export class AgentSettingsController {
  constructor(private readonly settings: AgentSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get agent settings',
    description:
      'The chat agent configuration: system prompt, model, web search toggle, skills and MCP servers. Seeded with defaults on first read. MCP auth tokens are masked to the boolean authConfigured — secrets are never returned.',
  })
  @ApiOkResponse({ type: AgentSettingsDto })
  get(): Promise<AgentSettingsDto> {
    return this.settings.get();
  }

  @Patch()
  @ApiOperation({
    summary: 'Update agent settings',
    description:
      'Partial update. skills and mcpServers are replaced wholesale when provided; an MCP server that keeps its id keeps its stored token unless a new one (or null, to clear) is sent. Every change writes an AuditEvent naming the changed fields.',
  })
  @ApiBody({ type: UpdateAgentSettingsDto })
  @ApiOkResponse({ type: AgentSettingsDto })
  update(@Body() dto: UpdateAgentSettingsDto): Promise<AgentSettingsDto> {
    return this.settings.update(dto);
  }

  @Post('mcp/test')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Test an MCP server connection',
    description:
      'Attempts an MCP streamable-HTTP handshake (JSON-RPC initialize, then tools/list) against the given URL with a 5s budget. Nothing is persisted; the token is never logged or echoed. Returns the discovered tools on success.',
  })
  @ApiBody({ type: McpTestRequestDto })
  @ApiOkResponse({ type: McpTestResponseDto })
  testMcp(@Body() dto: McpTestRequestDto): Promise<McpTestResponseDto> {
    return this.settings.testMcpServer(dto.url, dto.authToken);
  }
}
