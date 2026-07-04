import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { MeetingState } from '../../entities';
import { isServing } from '../../common/bootstrap-flag';
import { MeetingsService } from './meetings.service';
import {
  AttachTranscriptDto,
  ConfirmClientDto,
  ImportIcsDto,
  SkipMeetingDto,
} from './dto/meeting-request.dto';
import {
  MeetingActionResultDto,
  MeetingDetailDto,
  MeetingListItemDto,
  SyncResultDto,
} from './dto/meeting-response.dto';

@ApiTags('meetings')
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  @ApiOperation({
    summary: 'List meetings',
    description: 'All meetings with state, client, duration, attendees, transcript flag and linked proposal id.',
  })
  @ApiQuery({ name: 'state', required: false, enum: MeetingState })
  @ApiOkResponse({ type: [MeetingListItemDto] })
  list(@Query('state') state?: string): Promise<MeetingListItemDto[]> {
    return this.meetings.list(state);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Meeting detail',
    description: 'Full meeting with parsed transcript, match proposals, linked proposal and the evidence/decision chain.',
  })
  @ApiParam({ name: 'id', description: 'Meeting id' })
  @ApiOkResponse({ type: MeetingDetailDto })
  detail(@Param('id') id: string): Promise<MeetingDetailDto> {
    return this.meetings.detail(id);
  }

  @Post('sync')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sync the calendar (check now)',
    description:
      'Ingests the calendar (Google read-only if configured, else the seeded .ics fallback), upserts meetings and runs the Loop-1 step on every un-progressed meeting. Updates the CALENDAR connection state.',
  })
  @ApiOkResponse({ type: SyncResultDto })
  sync(): Promise<SyncResultDto> {
    return this.meetings.sync();
  }

  @Post('import-ics')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Import an .ics calendar',
    description: 'Fallback ingest path: parse raw .ics text, upsert meetings and run the Loop-1 step.',
  })
  @ApiOkResponse({ type: SyncResultDto })
  importIcs(@Body() body: ImportIcsDto): Promise<SyncResultDto> {
    return this.meetings.importIcs(body.icsText);
  }

  @Post(':id/transcript')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Attach a transcript',
    description:
      'Saves and parses the transcript, resolves the PROVIDE_TRANSCRIPT task, then runs the Loop-1 continuation (match, price, policy, auto-send or raise REVIEW_INVOICE).',
  })
  @ApiParam({ name: 'id', description: 'Meeting id' })
  @ApiOkResponse({ type: MeetingActionResultDto })
  attachTranscript(@Param('id') id: string, @Body() body: AttachTranscriptDto): Promise<MeetingActionResultDto> {
    return this.meetings.attachTranscript(id, body.rawText, body.source);
  }

  @Post(':id/confirm-client')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirm the client for a meeting',
    description: 'Sets the client, resolves the CONFIRM_CLIENT_MATCH task and re-runs the proposal-building continuation.',
  })
  @ApiParam({ name: 'id', description: 'Meeting id' })
  @ApiOkResponse({ type: MeetingActionResultDto })
  confirmClient(@Param('id') id: string, @Body() body: ConfirmClientDto): Promise<MeetingActionResultDto> {
    return this.meetings.confirmClient(id, body.clientId);
  }

  @Post(':id/skip')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Skip a meeting',
    description: 'Marks the meeting SKIPPED (not billable) and resolves any open transcript/match task.',
  })
  @ApiParam({ name: 'id', description: 'Meeting id' })
  @ApiOkResponse({ type: MeetingDetailDto })
  skip(@Param('id') id: string, @Body() body: SkipMeetingDto): Promise<MeetingDetailDto> {
    return this.meetings.skip(id, body.reason);
  }

  // --- Scheduled calendar sync (every 15 minutes) --------------------------
  @Cron('0 */15 * * * *')
  async calendarSync(): Promise<void> {
    if (!isServing()) return; // never fire during the OpenAPI export
    await this.meetings.sync();
  }
}
