import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  PotentialClient,
  PotentialClientState,
  ConnectionKind,
  ConnectionStatus,
  AuditActor,
} from '../../entities';
import { GoogleConnection, GoogleSyncStatus } from '../../entities/google-connection.entity';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { MeetingsService } from '../meetings/meetings.service';
import { GoogleClientService } from './google-client.service';
import {
  GoogleAuthUrlDto,
  GoogleCallbackResultDto,
  GoogleCalendarSyncDto,
  GoogleDisconnectResultDto,
  GoogleGmailSyncDto,
  GoogleStatusDto,
  GoogleSyncResultDto,
} from './dto/google-response.dto';

// Orchestrates the Google surface. Calendar events flow through the EXISTING
// meetings pipeline (MeetingsService.sync — same upsert, same Loop-1, same
// CALENDAR connection row). Gmail messages flow through the EXISTING email
// classify path (EmailService.processInboundMessages) and only ever for
// queued potential-client senders. Each scope degrades independently.
@Injectable()
export class GoogleService {
  private readonly log = new Logger('GoogleService');

  constructor(
    private readonly googleClient: GoogleClientService,
    private readonly meetings: MeetingsService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    @InjectRepository(PotentialClient)
    private readonly pcRepo: Repository<PotentialClient>,
  ) {}

  // --- Endpoints ---------------------------------------------------------------

  async authUrl(): Promise<GoogleAuthUrlDto> {
    return { url: await this.googleClient.generateAuthUrl() };
  }

  /**
   * Code exchange + persist + immediate first sync. Idempotent: re-hitting
   * with a used code or an unknown/stale state while a connection exists
   * returns the current connection as success, never an error.
   */
  async handleCallback(code?: string, state?: string, error?: string): Promise<GoogleCallbackResultDto> {
    const existing = await this.googleClient.getConnection();
    const stateKnown = this.googleClient.consumeState(state);

    if (error || !code) {
      if (existing) return this.callbackDto(existing);
      throw new BadRequestException(
        `Google consent did not complete (${error ?? 'no code returned'}). Restart from GET /google/auth-url.`,
      );
    }
    if (!stateKnown && existing) return this.callbackDto(existing);

    let tokens: Record<string, unknown>;
    try {
      tokens = await this.googleClient.exchangeCode(code);
    } catch (e) {
      // A used code on a double-hit of the callback — if we are already
      // connected, that is a success, not an error.
      if (existing) return this.callbackDto(existing);
      throw new BadRequestException(
        `Google code exchange failed: ${String((e as Error)?.message ?? e).slice(0, 200)}. ` +
          'Restart from GET /google/auth-url.',
      );
    }

    const accountEmail = await this.googleClient.fetchAccountEmail(tokens);
    const conn = await this.googleClient.saveConnection(tokens, accountEmail);
    await this.audit.record({
      actor: AuditActor.HUMAN,
      action: 'google.connected',
      summary:
        `Google account ${conn.accountEmail ?? '(email unknown)'} connected. ` +
        `Granted: ${this.shortScopes(conn).join(', ') || 'no scopes'}.`,
      subjectType: 'connection',
      subjectId: conn.id,
      inputs: { grantedScopes: this.scopeList(conn) }, // scope names only — never tokens
    });

    // First sync now, in the background — the browser redirect returns fast
    // and GET /google/status reports SYNCING until it lands.
    this.syncNow().catch((e) =>
      this.log.warn(`Post-connect sync failed: ${String(e).slice(0, 200)}`),
    );

    return this.callbackDto(conn);
  }

  async status(): Promise<GoogleStatusDto> {
    const conn = await this.googleClient.getConnection();
    if (!conn) {
      return {
        connected: false,
        accountEmail: null,
        grantedScopes: [],
        lastSyncAt: null,
        syncStatus: null,
        syncError: null,
        calendar: { granted: false },
        gmail: { granted: false },
      };
    }
    return {
      connected: true,
      accountEmail: conn.accountEmail,
      grantedScopes: this.scopeList(conn),
      lastSyncAt: conn.lastSyncAt ? new Date(conn.lastSyncAt).toISOString() : null,
      syncStatus: conn.syncStatus,
      syncError: conn.syncError,
      calendar: { granted: this.googleClient.isCalendarGranted(conn) },
      gmail: { granted: this.googleClient.isGmailGranted(conn) },
    };
  }

  /** Run calendar + gmail sync now. Each granted scope syncs independently. */
  async syncNow(): Promise<GoogleSyncResultDto> {
    let conn = await this.googleClient.getConnection();
    if (!conn) {
      throw new NotFoundException('No Google connection. Connect via GET /google/auth-url first.');
    }
    await this.googleClient.setSyncStatus(conn, GoogleSyncStatus.SYNCING, null);

    const calendar: GoogleCalendarSyncDto = { synced: false, imported: 0, updated: 0, processed: 0 };
    const gmail: GoogleGmailSyncDto = { synced: false, messagesRead: 0, agreementsDetected: 0, tasksRaised: 0 };
    const errors: string[] = [];

    if (this.googleClient.isCalendarGranted(conn)) {
      try {
        // The whole existing pipeline: Google fetch (incremental), meeting
        // upsert keyed on gcalEventId, cancellations, Loop-1, CALENDAR row.
        const res = await this.meetings.sync();
        calendar.imported = res.imported;
        calendar.updated = res.updated;
        calendar.processed = res.processed;
        calendar.synced = res.source === 'google';
        if (res.source !== 'google') {
          errors.push(`Calendar fell back to ${res.source}: ${res.detail ?? 'no detail'}`);
        }
      } catch (e) {
        errors.push(`Calendar sync failed: ${this.errMsg(e)}`);
      }
    }

    if (this.googleClient.isGmailGranted(conn)) {
      try {
        const g = await this.syncGmail(conn);
        gmail.messagesRead = g.messagesRead;
        gmail.agreementsDetected = g.agreementsDetected;
        gmail.tasksRaised = g.tasksRaised;
        gmail.synced = true;
      } catch (e) {
        errors.push(`Gmail sync failed: ${this.errMsg(e)}`);
      }
    }
    // Gmail scope not granted => the EMAIL row is left completely untouched,
    // so the fixture-mailbox fallback stays honest.

    conn = (await this.googleClient.getConnection()) ?? conn; // tokens/syncToken may have moved
    conn.lastSyncAt = new Date();
    conn.syncStatus = errors.length ? GoogleSyncStatus.ERROR : GoogleSyncStatus.OK;
    conn.syncError = errors.length ? errors.join(' | ').slice(0, 1000) : null;
    await this.googleClient.saveRow(conn);

    await this.audit.record({
      actor: AuditActor.ROBYN,
      action: errors.length ? 'google.sync_failed' : 'google.synced',
      summary: errors.length
        ? `Google sync finished with errors: ${errors.join(' | ')}`.slice(0, 900)
        : `Google sync: calendar +${calendar.imported} new / ${calendar.updated} refreshed / ` +
          `${calendar.processed} processed; gmail ${gmail.messagesRead} message(s), ` +
          `${gmail.agreementsDetected} agreement(s), ${gmail.tasksRaised} task(s).`,
      subjectType: 'connection',
      subjectId: conn.id,
      inputs: { calendar, gmail },
    });

    return {
      calendar,
      gmail,
      syncStatus: conn.syncStatus,
      syncError: conn.syncError,
      lastSyncAt: conn.lastSyncAt.toISOString(),
    };
  }

  /** Cron entry — quietly a no-op when nothing is connected. */
  async syncIfConnected(): Promise<void> {
    const conn = await this.googleClient.getConnection();
    if (!conn) return;
    try {
      await this.syncNow();
    } catch (e) {
      this.log.warn(`Scheduled Google sync failed: ${String(e).slice(0, 200)}`);
    }
  }

  /** Best-effort revoke, delete the row, revert provider rows to FALLBACK. */
  async disconnect(): Promise<GoogleDisconnectResultDto> {
    const conn = await this.googleClient.getConnection();
    if (!conn) return { disconnected: true, revoked: false };

    const hadCalendar = this.googleClient.isCalendarGranted(conn);
    const hadGmail = this.googleClient.isGmailGranted(conn);
    const accountEmail = conn.accountEmail;

    const revoked = await this.googleClient.revokeTokens(conn);
    await this.googleClient.deleteConnection();

    // Revert only the rows Google was serving — an IMAP-owned EMAIL row (or a
    // fixture row) is not ours to rewrite.
    if (hadCalendar) {
      await this.googleClient.upsertConnectionRow(
        ConnectionKind.CALENDAR,
        ConnectionStatus.FALLBACK,
        'calendar.ics',
        'Google disconnected. The next sync reads the seeded .ics fixture.',
      );
    }
    if (hadGmail) {
      await this.googleClient.upsertConnectionRow(
        ConnectionKind.EMAIL,
        ConnectionStatus.FALLBACK,
        'fixture mailbox',
        'Google disconnected. The next poll reads the fixture mailbox. Reads only queued client senders.',
      );
    }

    await this.audit.record({
      actor: AuditActor.HUMAN,
      action: 'google.disconnected',
      summary:
        `Google account ${accountEmail ?? '(email unknown)'} disconnected` +
        `${revoked ? ' (token revoked)' : ' (revoke failed, best effort)'}. ` +
        'Calendar and email revert to their fixture fallbacks.',
      subjectType: 'connection',
      subjectId: conn.id,
    });

    return { disconnected: true, revoked };
  }

  // --- Gmail sync ---------------------------------------------------------------
  // The sacred invariant, same as the email module: ONLY senders already in
  // the potential-clients queue are ever read. The from-filter is part of the
  // Gmail query itself, so nothing else is even fetched.

  private async syncGmail(
    conn: GoogleConnection,
  ): Promise<{ messagesRead: number; agreementsDetected: number; tasksRaised: number }> {
    const queued = await this.pcRepo.find({
      where: { state: In([PotentialClientState.QUEUED, PotentialClientState.WATCHING]) },
    });
    const now = new Date();
    let messagesRead = 0;
    let agreementsDetected = 0;
    let tasksRaised = 0;
    let lastAgreementFrom: string | null = null;

    for (const pc of queued) {
      const addrs = (pc.emails ?? [])
        .map((e) => this.email.normaliseAddress(e))
        .filter((e) => e.length > 0);
      if (addrs.length === 0) {
        pc.lastPolledAt = now;
        await this.pcRepo.save(pc);
        continue;
      }

      const msgs = await this.googleClient.listInboxMessagesFrom(addrs, pc.lastPolledAt);
      messagesRead += msgs.length;
      if (msgs.length > 0) {
        const res = await this.email.processInboundMessages(pc, msgs, ConnectionStatus.LIVE);
        agreementsDetected += res.agreementsDetected;
        tasksRaised += res.tasksRaised;
        if (res.detected.length > 0) {
          lastAgreementFrom = this.email.normaliseAddress(res.detected[res.detected.length - 1].from);
        }
      }

      pc.lastPolledAt = now;
      await this.pcRepo.save(pc);
    }

    await this.googleClient.upsertConnectionRow(
      ConnectionKind.EMAIL,
      ConnectionStatus.LIVE,
      conn.accountEmail ?? 'Gmail',
      lastAgreementFrom
        ? `Live: agreement received from ${lastAgreementFrom} on this sync. ` +
            'Reads only queued client senders.'
        : `Live: Gmail INBOX for ${conn.accountEmail ?? 'the connected account'}. ` +
            'Reads only queued client senders.',
    );

    return { messagesRead, agreementsDetected, tasksRaised };
  }

  // --- helpers --------------------------------------------------------------------

  private callbackDto(conn: GoogleConnection): GoogleCallbackResultDto {
    return {
      connected: true,
      accountEmail: conn.accountEmail,
      grantedScopes: this.scopeList(conn),
    };
  }

  private scopeList(conn: GoogleConnection): string[] {
    return (conn.grantedScopes ?? '').split(' ').filter((s) => s.length > 0);
  }

  private shortScopes(conn: GoogleConnection): string[] {
    return this.scopeList(conn).map((s) => s.split('/').pop() ?? s);
  }

  private errMsg(e: unknown): string {
    return String((e as Error)?.message ?? e).slice(0, 200);
  }
}
