import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import {
  AuditEventDto,
  AuditQueryDto,
  CalendarEventDto,
  CalendarQueryDto,
  DashboardSummaryDto,
  LeakStripDto,
} from './dto/dashboard.dto';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('calendar')
  @ApiOperation({
    summary: 'Calendar-view feed',
    description:
      'Colour-coded events for the calendar view. colorKey is derived from meeting state: billed=teal, proposal=amber, awaiting=amber-outline, unknown=purple, skipped/personal=gray. Optionally window by event start with from/to.',
  })
  @ApiOkResponse({ type: [CalendarEventDto] })
  calendar(@Query() query: CalendarQueryDto): Promise<CalendarEventDto[]> {
    return this.service.calendar(query.from, query.to);
  }

  @Get('leak-strip')
  @ApiOperation({
    summary: 'Recoverable-money strip',
    description:
      'The "£X was walking away" strip: recoverable total plus a per-source breakdown across OPEN detections, IN_REVIEW proposals and unbilled meetings.',
  })
  @ApiOkResponse({ type: LeakStripDto })
  leakStrip(): Promise<LeakStripDto> {
    return this.service.leakStrip();
  }

  @Get('audit')
  @ApiOperation({
    summary: 'Audit trail feed',
    description:
      'The audit trail screen: every state change, Xero write, policy decision and poll, newest first.',
  })
  @ApiOkResponse({ type: [AuditEventDto] })
  audit(@Query() query: AuditQueryDto): Promise<AuditEventDto[]> {
    return this.service.auditTrail(query.limit);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Headline stats',
    description:
      'Open tasks, total unbilled £ across clients, invoices sent this month, and client count.',
  })
  @ApiOkResponse({ type: DashboardSummaryDto })
  summary(): Promise<DashboardSummaryDto> {
    return this.service.summary();
  }
}
