import { Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { isServing } from '../../common/bootstrap-flag';
import { GoogleService } from './google.service';
import { GoogleCallbackQueryDto } from './dto/google-request.dto';
import {
  GoogleAuthUrlDto,
  GoogleCallbackResultDto,
  GoogleDisconnectResultDto,
  GoogleStatusDto,
  GoogleSyncResultDto,
} from './dto/google-response.dto';

@ApiTags('google')
@Controller('google')
export class GoogleController {
  constructor(private readonly google: GoogleService) {}

  @Get('auth-url')
  @ApiOperation({
    summary: 'Start the Google OAuth flow',
    description:
      'Returns the consent screen URL (calendar.readonly + gmail.readonly + userinfo.email, ' +
      'offline access, forced consent). The state nonce is held server-side and checked on the callback.',
  })
  @ApiOkResponse({ type: GoogleAuthUrlDto })
  @ApiResponse({ status: 500, description: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured.' })
  authUrl(): Promise<GoogleAuthUrlDto> {
    return this.google.authUrl();
  }

  @Get('callback')
  @ApiOperation({
    summary: 'OAuth callback (code exchange)',
    description:
      'Exchanges the single-use code, stores tokens + granted scopes + account email, then ' +
      'immediately triggers the first sync in the background. Idempotent: re-hitting with a used ' +
      'code or unknown state while a connection exists returns success. Unguarded by design — ' +
      'Google redirects the browser here with no bearer token.',
  })
  @ApiOkResponse({ type: GoogleCallbackResultDto })
  @ApiResponse({ status: 400, description: 'Consent cancelled or code exchange failed with no existing connection.' })
  callback(@Query() query: GoogleCallbackQueryDto): Promise<GoogleCallbackResultDto> {
    return this.google.handleCallback(query.code, query.state, query.error);
  }

  @Get('status')
  @ApiOperation({
    summary: 'Google connection status',
    description:
      'Connection, account email, granted scopes and per-scope grants (calendar/gmail), last sync ' +
      'time and sync status. Safe to poll while the post-connect sync runs.',
  })
  @ApiOkResponse({ type: GoogleStatusDto })
  status(): Promise<GoogleStatusDto> {
    return this.google.status();
  }

  @Post('sync')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sync Google now',
    description:
      'Runs the calendar sync (events feed the existing meetings pipeline) and the Gmail poll ' +
      '(queued potential-client senders only) for whichever scopes were granted, and returns counts.',
  })
  @ApiOkResponse({ type: GoogleSyncResultDto })
  @ApiResponse({ status: 404, description: 'No Google connection.' })
  sync(): Promise<GoogleSyncResultDto> {
    return this.google.syncNow();
  }

  @Delete('connection')
  @ApiOperation({
    summary: 'Disconnect Google',
    description:
      'Best-effort token revoke, deletes the stored connection and reverts the CALENDAR/EMAIL ' +
      'connection rows to their honest fixture fallbacks. Idempotent.',
  })
  @ApiOkResponse({ type: GoogleDisconnectResultDto })
  disconnect(): Promise<GoogleDisconnectResultDto> {
    return this.google.disconnect();
  }

  // --- Scheduled sync (every 15 minutes, offset from the meetings cron so the
  // two never double-fetch the calendar in the same second) ------------------
  @Cron('0 5-59/15 * * * *')
  async scheduledSync(): Promise<void> {
    if (!isServing()) return; // never fire during the OpenAPI export
    await this.google.syncIfConnected();
  }
}
