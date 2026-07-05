import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'node:crypto';

import {
  ConnectionState,
  ConnectionKind,
  ConnectionStatus,
  AuditActor,
} from '../../entities';
import { GoogleConnection, GoogleSyncStatus } from '../../entities/google-connection.entity';
import { AuditService } from '../audit/audit.service';
import { loadConfig } from '../../config/env';

// The three scopes we request. Users can untick any of them on the consent
// screen — features gate on what was actually granted, never on this list.
export const GOOGLE_SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar.readonly';
export const GOOGLE_SCOPE_GMAIL = 'https://www.googleapis.com/auth/gmail.readonly';
export const GOOGLE_SCOPE_USERINFO = 'https://www.googleapis.com/auth/userinfo.email';

const STATE_TTL_MS = 10 * 60 * 1000; // consent flows older than 10 min are stale
const TOKEN_EARLY_REFRESH_MS = 5 * 60 * 1000; // refresh 5 min before expiry
const CALENDAR_WINDOW_PAST_DAYS = 14;
const CALENDAR_WINDOW_FUTURE_DAYS = 30;
const MAX_LIST_PAGES = 8; // hard cap so a runaway pagination loop cannot spin

// Hard outbound timeouts: identity operations (token exchange/refresh/revoke,
// userinfo) get 10s, data reads (calendar, gmail) 15s. Every googleapis call
// is raced against these so a hung upstream request fails fast through the
// existing error paths (sync marks syncStatus=ERROR, connection rows go DOWN)
// instead of wedging the caller forever.
const GOOGLE_IDENTITY_TIMEOUT_MS = 10_000;
const GOOGLE_API_TIMEOUT_MS = 15_000;

/** A Google endpoint did not answer within its budget. */
export class GoogleTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`GoogleTimeout: ${what} did not respond within ${Math.round(ms / 1000)}s.`);
    this.name = 'GoogleTimeoutError';
  }
}

/** Race a googleapis promise against a hard deadline. The SDK call may keep
 *  its socket open in the background, but the caller is guaranteed to unblock
 *  with a named error the existing catch paths already handle. */
async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new GoogleTimeoutError(what, ms)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// Same shape as the meetings pipeline's NormalizedEvent — structural typing
// lets MeetingsService consume these directly.
export interface GoogleCalendarEvent {
  gcalEventId: string;
  title: string;
  start: Date;
  end: Date;
  attendees: { email: string; name?: string; organizer?: boolean }[];
}

export interface GoogleCalendarFetch {
  events: GoogleCalendarEvent[];
  cancelledIds: string[]; // gcalEventIds whose status === 'cancelled'
  mode: 'full' | 'incremental';
  accountEmail: string | null;
}

// Same shape as the email module's InboundMessage — Gmail messages flow into
// the identical classify path the fixture mailbox and IMAP use.
export interface GmailInboundMessage {
  from: string;
  subject: string;
  body: string;
  date: string | null;
  messageId: string;
}

// Low-level Google access: the single GoogleConnection row, the OAuth dance,
// 5-min-early token refresh, calendar events fetch (syncToken incremental with
// 410 fallback) and Gmail INBOX reads scoped to explicit sender addresses.
// No feature-module dependencies — MeetingsModule and GoogleModule both import
// this without cycles. Token values are never logged and never audited.
@Injectable()
export class GoogleClientService {
  private readonly log = new Logger('GoogleClientService');

  // Pending OAuth state nonces (CSRF-only — single-user demo, no identity in
  // state). In-memory is fine for one process; the callback is idempotent when
  // a nonce is lost to a restart.
  private readonly pendingStates = new Map<string, number>();

  // googleapis is loaded dynamically so the build (and the OpenAPI export)
  // stays green when the package is absent — same pattern as the previous
  // env-token calendar path.
  private googleModule: unknown | null = null;

  constructor(
    @InjectRepository(GoogleConnection)
    private readonly repo: Repository<GoogleConnection>,
    @InjectRepository(ConnectionState)
    private readonly connRepo: Repository<ConnectionState>,
    private readonly audit: AuditService,
  ) {}

  // --- Connection row --------------------------------------------------------

  async getConnection(): Promise<GoogleConnection | null> {
    const rows = await this.repo.find({ order: { createdAt: 'ASC' }, take: 1 });
    return rows[0] ?? null;
  }

  async saveRow(conn: GoogleConnection): Promise<GoogleConnection> {
    return this.repo.save(conn);
  }

  async setSyncStatus(
    conn: GoogleConnection,
    status: GoogleSyncStatus,
    error: string | null,
  ): Promise<GoogleConnection> {
    conn.syncStatus = status;
    conn.syncError = error;
    return this.repo.save(conn);
  }

  isCalendarGranted(conn: GoogleConnection): boolean {
    return (conn.grantedScopes ?? '').includes('/auth/calendar.readonly');
  }

  isGmailGranted(conn: GoogleConnection): boolean {
    return (conn.grantedScopes ?? '').includes('/auth/gmail.readonly');
  }

  /** True when a connection exists AND the calendar scope was granted. */
  async hasCalendarConnection(): Promise<boolean> {
    const conn = await this.getConnection();
    return !!conn && this.isCalendarGranted(conn);
  }

  // --- OAuth dance ------------------------------------------------------------

  async generateAuthUrl(): Promise<string> {
    const oauth2 = await this.newOAuthClient(true);
    const state = crypto.randomBytes(16).toString('hex');
    this.prunePendingStates();
    this.pendingStates.set(state, Date.now() + STATE_TTL_MS);
    return oauth2.generateAuthUrl({
      access_type: 'offline', // required for a refresh_token
      prompt: 'consent', // forces refresh_token on re-consent
      include_granted_scopes: true,
      scope: [GOOGLE_SCOPE_CALENDAR, GOOGLE_SCOPE_GMAIL, GOOGLE_SCOPE_USERINFO],
      state,
    }) as string;
  }

  /** Returns true and consumes the nonce when the state was issued by us. */
  consumeState(state?: string): boolean {
    if (!state) return false;
    this.prunePendingStates();
    if (!this.pendingStates.has(state)) return false;
    this.pendingStates.delete(state);
    return true;
  }

  /** Auth codes are single-use — never call this twice with the same code. */
  async exchangeCode(code: string): Promise<Record<string, unknown>> {
    const oauth2 = await this.newOAuthClient(true);
    const { tokens } = await withTimeout<any>(
      oauth2.getToken(code),
      GOOGLE_IDENTITY_TIMEOUT_MS,
      'Google token exchange',
    );
    return tokens as Record<string, unknown>;
  }

  /** Account email from the userinfo endpoint, falling back to the id_token. */
  async fetchAccountEmail(tokens: Record<string, unknown>): Promise<string | null> {
    try {
      const google = await this.loadGoogle();
      const oauth2 = await this.newOAuthClient(true);
      oauth2.setCredentials(tokens);
      const userinfo = google.oauth2({ version: 'v2', auth: oauth2 });
      const res = await withTimeout<any>(
        userinfo.userinfo.get(),
        GOOGLE_IDENTITY_TIMEOUT_MS,
        'Google userinfo lookup',
      );
      const email = res?.data?.email;
      if (typeof email === 'string' && email.length > 0) return email;
    } catch (e) {
      this.log.warn(`Google userinfo lookup failed: ${String(e).slice(0, 160)}`);
    }
    return this.emailFromIdToken(tokens?.id_token as string | undefined);
  }

  /** Decode the id_token JWT payload locally — no network, no verification
   *  needed (we only display the email; nothing authorizes against it). */
  private emailFromIdToken(idToken?: string): string | null {
    if (!idToken) return null;
    try {
      const payload = idToken.split('.')[1] ?? '';
      const json = JSON.parse(
        Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
      ) as { email?: unknown };
      return typeof json.email === 'string' && json.email.length > 0 ? json.email : null;
    } catch {
      return null;
    }
  }

  /**
   * Upsert the single connection row from a token response. Resets the
   * calendar syncToken (a reconnect always starts with a clean full sync) and
   * keeps a previously stored refresh token when Google omits a new one.
   */
  async saveConnection(
    tokens: Record<string, unknown>,
    accountEmail: string | null,
  ): Promise<GoogleConnection> {
    let conn = await this.getConnection();
    if (!conn) conn = this.repo.create({ grantedScopes: '' });
    if (accountEmail) conn.accountEmail = accountEmail;
    if (typeof tokens.access_token === 'string') conn.accessToken = tokens.access_token;
    if (typeof tokens.refresh_token === 'string' && tokens.refresh_token.length > 0) {
      conn.refreshToken = tokens.refresh_token;
    }
    conn.tokenExpiresAt =
      typeof tokens.expiry_date === 'number' ? new Date(tokens.expiry_date) : null;
    if (typeof tokens.scope === 'string' && tokens.scope.length > 0) {
      conn.grantedScopes = tokens.scope;
    }
    conn.calendarSyncToken = null;
    conn.syncStatus = GoogleSyncStatus.PENDING;
    conn.syncError = null;
    return this.repo.save(conn);
  }

  /** Best-effort revoke — failure is logged, never thrown. */
  async revokeTokens(conn: GoogleConnection): Promise<boolean> {
    try {
      const oauth2 = await this.newOAuthClient(false);
      const token = conn.refreshToken ?? conn.accessToken;
      if (!token) return false;
      await withTimeout(oauth2.revokeToken(token), GOOGLE_IDENTITY_TIMEOUT_MS, 'Google token revoke');
      return true;
    } catch (e) {
      this.log.warn(`Google token revoke failed (best-effort): ${String(e).slice(0, 160)}`);
      return false;
    }
  }

  async deleteConnection(): Promise<void> {
    const conn = await this.getConnection();
    if (conn) await this.repo.remove(conn);
  }

  // --- Token refresh (5 minutes early, persisted) ------------------------------

  private async ensureFreshToken(conn: GoogleConnection): Promise<GoogleConnection> {
    const msLeft = conn.tokenExpiresAt ? conn.tokenExpiresAt.getTime() - Date.now() : -1;
    if (msLeft > TOKEN_EARLY_REFRESH_MS) return conn;
    if (!conn.refreshToken) {
      if (msLeft > 0) return conn; // still valid, just close — use it as-is
      throw new Error(
        'Google access token expired and no refresh token is stored. Reconnect via GET /google/auth-url.',
      );
    }
    try {
      const google = await this.loadGoogle();
      const cfg = loadConfig();
      const oauth2 = new google.auth.OAuth2(cfg.google.clientId, cfg.google.clientSecret);
      oauth2.setCredentials({ refresh_token: conn.refreshToken });
      const { credentials } = await withTimeout<any>(
        oauth2.refreshAccessToken(),
        GOOGLE_IDENTITY_TIMEOUT_MS,
        'Google token refresh',
      );
      if (typeof credentials.access_token === 'string') {
        conn.accessToken = credentials.access_token;
      }
      if (typeof credentials.refresh_token === 'string' && credentials.refresh_token.length > 0) {
        conn.refreshToken = credentials.refresh_token; // Google rarely rotates, but persist if it does
      }
      conn.tokenExpiresAt =
        typeof credentials.expiry_date === 'number' ? new Date(credentials.expiry_date) : null;
      return await this.repo.save(conn);
    } catch (e) {
      const reason = `Token refresh failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`;
      conn.syncStatus = GoogleSyncStatus.ERROR;
      conn.syncError = reason;
      await this.repo.save(conn);
      // The providers Google was serving go honestly DOWN with the reason.
      if (this.isCalendarGranted(conn)) {
        await this.upsertConnectionRow(ConnectionKind.CALENDAR, ConnectionStatus.DOWN, null, reason);
      }
      if (this.isGmailGranted(conn)) {
        await this.upsertConnectionRow(ConnectionKind.EMAIL, ConnectionStatus.DOWN, null, reason);
      }
      await this.audit.record({
        actor: AuditActor.SYSTEM,
        action: 'google.token_refresh_failed',
        summary: `Google token refresh failed for ${conn.accountEmail ?? 'connected account'}: ${reason}`,
        subjectType: 'connection',
        subjectId: conn.id,
      });
      throw new Error(reason);
    }
  }

  // --- Calendar fetch (incremental via syncToken, 410 falls back to full) ------

  async fetchCalendarEvents(): Promise<GoogleCalendarFetch> {
    const conn = await this.requireConnection();
    if (!this.isCalendarGranted(conn)) {
      throw new Error('Google connection has no calendar.readonly grant.');
    }
    const fresh = await this.ensureFreshToken(conn);
    const google = await this.loadGoogle();
    const auth = await this.authorizedClient(fresh, google);
    const calendar = google.calendar({ version: 'v3', auth });

    let mode: 'full' | 'incremental' = fresh.calendarSyncToken ? 'incremental' : 'full';
    let result: { items: any[]; nextSyncToken: string | null };
    try {
      result = await this.listEventPages(calendar, fresh.calendarSyncToken);
    } catch (e) {
      if (mode === 'incremental' && this.isSyncTokenExpired(e)) {
        // 410 GONE — the sync token expired. Clear it and re-run a full sync.
        fresh.calendarSyncToken = null;
        await this.repo.save(fresh);
        mode = 'full';
        result = await this.listEventPages(calendar, null);
      } else {
        throw e;
      }
    }

    fresh.calendarSyncToken = result.nextSyncToken;
    await this.repo.save(fresh);

    const events: GoogleCalendarEvent[] = [];
    const cancelledIds: string[] = [];
    for (const it of result.items) {
      if (!it?.id) continue;
      if (it.status === 'cancelled') {
        cancelledIds.push(String(it.id));
        continue;
      }
      if (!it.start) continue;
      const start = new Date(it.start.dateTime ?? it.start.date);
      const end = new Date(it.end?.dateTime ?? it.end?.date ?? start);
      const attendees: GoogleCalendarEvent['attendees'] = (it.attendees ?? []).map((a: any) => ({
        email: a.email,
        name: a.displayName,
        organizer: !!a.organizer,
      }));
      if (
        it.organizer?.email &&
        !attendees.some((x) => x.email?.toLowerCase() === it.organizer.email.toLowerCase())
      ) {
        attendees.push({ email: it.organizer.email, name: it.organizer.displayName, organizer: true });
      }
      events.push({
        gcalEventId: String(it.id),
        title: String(it.summary ?? 'Untitled meeting'),
        start,
        end,
        attendees,
      });
    }
    return { events, cancelledIds, mode, accountEmail: fresh.accountEmail };
  }

  private async listEventPages(
    calendar: any,
    syncToken: string | null,
  ): Promise<{ items: any[]; nextSyncToken: string | null }> {
    const now = Date.now();
    const timeMin = new Date(now - CALENDAR_WINDOW_PAST_DAYS * 86400000).toISOString();
    const timeMax = new Date(now + CALENDAR_WINDOW_FUTURE_DAYS * 86400000).toISOString();
    const items: any[] = [];
    let nextSyncToken: string | null = null;
    let pageToken: string | undefined;
    let pages = 0;
    do {
      // syncToken is mutually exclusive with timeMin/timeMax/orderBy; and
      // orderBy would suppress nextSyncToken entirely, so neither mode sorts
      // (order is irrelevant to the upsert — it keys on gcalEventId).
      const params: Record<string, unknown> = {
        calendarId: 'primary',
        singleEvents: true,
        maxResults: 250,
      };
      if (syncToken) params.syncToken = syncToken;
      else {
        params.timeMin = timeMin;
        params.timeMax = timeMax;
      }
      if (pageToken) params.pageToken = pageToken;
      const res = await withTimeout<any>(
        calendar.events.list(params),
        GOOGLE_API_TIMEOUT_MS,
        'Google Calendar events list',
      );
      items.push(...(res.data?.items ?? []));
      pageToken = res.data?.nextPageToken ?? undefined;
      if (res.data?.nextSyncToken) nextSyncToken = String(res.data.nextSyncToken);
      pages += 1;
    } while (pageToken && pages < MAX_LIST_PAGES);
    return { items, nextSyncToken };
  }

  private isSyncTokenExpired(e: unknown): boolean {
    const err = e as { code?: unknown; response?: { status?: unknown }; message?: unknown };
    const code = Number(err?.code ?? err?.response?.status ?? 0);
    if (code === 410) return true;
    return /sync\s?token/i.test(String(err?.message ?? ''));
  }

  // --- Gmail fetch (explicit sender addresses ONLY — never widen the query) ----

  /**
   * Read INBOX messages FROM the given addresses, optionally only newer than
   * `since`. The from-filter lives in the Gmail query itself, so a non-queued
   * sender is never even fetched — same invariant as the email module's IMAP
   * path. Returns [] when the gmail scope was not granted.
   */
  async listInboxMessagesFrom(addrs: string[], since: Date | null): Promise<GmailInboundMessage[]> {
    const conn = await this.requireConnection();
    if (!this.isGmailGranted(conn) || addrs.length === 0) return [];
    const fresh = await this.ensureFreshToken(conn);
    const google = await this.loadGoogle();
    const auth = await this.authorizedClient(fresh, google);
    const gmail = google.gmail({ version: 'v1', auth });

    const fromClause = addrs.length === 1 ? `from:${addrs[0]}` : `from:(${addrs.join(' OR ')})`;
    const q = since ? `${fromClause} after:${Math.floor(since.getTime() / 1000)}` : fromClause;
    const list = await withTimeout<any>(
      gmail.users.messages.list({
        userId: 'me',
        labelIds: ['INBOX'],
        q,
        maxResults: 20,
      }),
      GOOGLE_API_TIMEOUT_MS,
      'Gmail message list',
    );
    const ids: string[] = (list.data?.messages ?? [])
      .map((m: any) => String(m?.id ?? ''))
      .filter((id: string) => id.length > 0);

    const out: GmailInboundMessage[] = [];
    for (const id of ids) {
      const msg = await withTimeout<any>(
        gmail.users.messages.get({ userId: 'me', id, format: 'full' }),
        GOOGLE_API_TIMEOUT_MS,
        'Gmail message fetch',
      );
      const inbound = this.toInboundMessage(msg.data);
      if (inbound) out.push(inbound);
    }
    return out;
  }

  private toInboundMessage(data: any): GmailInboundMessage | null {
    if (!data) return null;
    const headers: any[] = data.payload?.headers ?? [];
    const header = (name: string): string => {
      const h = headers.find((x) => String(x?.name ?? '').toLowerCase() === name);
      return typeof h?.value === 'string' ? h.value : '';
    };
    const from = header('from');
    if (!from) return null;
    const internalMs = Number(data.internalDate ?? NaN);
    return {
      from,
      subject: header('subject'),
      body: this.extractBody(data.payload) || String(data.snippet ?? ''),
      date: Number.isNaN(internalMs) ? null : new Date(internalMs).toISOString(),
      messageId: header('message-id') || String(data.id ?? ''),
    };
  }

  private extractBody(payload: any): string {
    if (!payload) return '';
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return this.decodeBase64Url(String(payload.body.data));
    }
    for (const part of payload.parts ?? []) {
      const text = this.extractBody(part);
      if (text) return text;
    }
    if (payload.body?.data && String(payload.mimeType ?? '').startsWith('text/')) {
      return this.decodeBase64Url(String(payload.body.data));
    }
    return '';
  }

  private decodeBase64Url(s: string): string {
    try {
      return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    } catch {
      return '';
    }
  }

  // --- Provider ConnectionState rows -------------------------------------------

  /** Upsert a CALENDAR/EMAIL row. Pass label=null to keep the existing label. */
  async upsertConnectionRow(
    kind: ConnectionKind,
    status: ConnectionStatus,
    label: string | null,
    detail: string,
  ): Promise<void> {
    let row = await this.connRepo.findOne({ where: { kind } });
    if (!row) row = this.connRepo.create({ kind });
    row.status = status;
    if (label !== null) row.label = label;
    row.detail = detail;
    row.lastSyncAt = new Date();
    await this.connRepo.save(row);
  }

  // --- Internals ----------------------------------------------------------------

  private async requireConnection(): Promise<GoogleConnection> {
    const conn = await this.getConnection();
    if (!conn) throw new Error('No Google connection. Connect via GET /google/auth-url.');
    return conn;
  }

  private async authorizedClient(conn: GoogleConnection, google: any): Promise<any> {
    const cfg = loadConfig();
    const oauth2 = new google.auth.OAuth2(cfg.google.clientId, cfg.google.clientSecret);
    oauth2.setCredentials({
      access_token: conn.accessToken,
      refresh_token: conn.refreshToken ?? undefined,
    });
    return oauth2;
  }

  private async newOAuthClient(withRedirect: boolean): Promise<any> {
    const cfg = loadConfig();
    if (!cfg.google.configured) {
      throw new Error(
        'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in api/.env.',
      );
    }
    const google = await this.loadGoogle();
    return new google.auth.OAuth2(
      cfg.google.clientId,
      cfg.google.clientSecret,
      withRedirect ? cfg.google.redirectUri : undefined,
    );
  }

  // Dynamic import so the build and the OpenAPI export stay green even when
  // googleapis is absent. The Function indirection stops TypeScript from
  // statically resolving the optional dependency (same pattern the meetings
  // module used for its old env-token path).
  private async loadGoogle(): Promise<any> {
    if (this.googleModule) return this.googleModule;
    const dynImport = new Function('m', 'return import(m)') as unknown as (
      m: string,
    ) => Promise<any>;
    let mod: any;
    try {
      mod = await dynImport('googleapis');
    } catch {
      throw new Error('googleapis is not installed. Run `pnpm add googleapis` in api/.');
    }
    const google = mod.google ?? mod.default?.google;
    if (!google) throw new Error('googleapis loaded but did not expose `google`.');
    // Socket-level request timeout for all googleapis data calls (gaxios).
    // The withTimeout races above still guarantee the caller unblocks even if
    // the SDK ignores this for a given transport.
    try {
      google.options({ timeout: GOOGLE_API_TIMEOUT_MS });
    } catch {
      // options() missing on very old googleapis builds; the races still hold
    }
    this.googleModule = google;
    return google;
  }

  private prunePendingStates(): void {
    const now = Date.now();
    for (const [state, expiresAt] of this.pendingStates) {
      if (expiresAt < now) this.pendingStates.delete(state);
    }
  }
}
