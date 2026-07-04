import { Controller, Get, Post, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { ConnectionsService } from './connections.service';
import { ConnectionRowDto } from './dto/connection-row.dto';

// Served at /api/connections (global 'api' prefix applied centrally).
@ApiTags('connections')
@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get()
  @ApiOperation({
    summary: 'List integration health',
    description:
      'Three rows — XERO (probed live from Xero health), CALENDAR and EMAIL (read from their ConnectionState rows, DOWN if never run). Read-only: does not trigger any sync/poll job.',
  })
  @ApiOkResponse({ type: ConnectionRowDto, isArray: true })
  async list(): Promise<ConnectionRowDto[]> {
    return this.connections.list();
  }

  @Post('xero/recheck')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Re-probe Xero health',
    description:
      'Forces a fresh Xero health check, upserts the XERO ConnectionState row, records an audit event, and returns the refreshed row. The "check now" for Xero. Never throws when Xero is down — returns a DOWN row with the reason.',
  })
  @ApiOkResponse({ type: ConnectionRowDto })
  async recheckXero(): Promise<ConnectionRowDto> {
    return this.connections.recheckXero();
  }
}
