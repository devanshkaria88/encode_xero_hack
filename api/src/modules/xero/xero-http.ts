// Low-level Xero transport for a Custom Connection (client_credentials, one org).
// Framework-agnostic on purpose: the NestJS providers wrap it AND the seed
// scripts import it directly under tsx. There is exactly ONE token path in this
// repo and this is it (see .claude/skills/xero-auth).
//
// Adds over the skill's reference helper: broad->granular scope fallback,
// tenant-id resolution via GET /connections (cached), retry-on-401 (re-mint),
// and 429 Retry-After handling.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const ACCOUNTING_BASE = 'https://api.xero.com/api.xro/2.0';
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const CONNECTIONS_URL = 'https://api.xero.com/connections';

// Project scopes (broad). A custom connection created after 29 Apr 2026 may be
// granular-only and reject these with 400 invalid_scope — we fall back.
const BROAD_SCOPES =
  'accounting.transactions accounting.contacts accounting.attachments accounting.settings accounting.reports.read';
const GRANULAR_SCOPES = [
  'accounting.invoices',
  'accounting.contacts',
  'accounting.attachments',
  'accounting.settings.read',
  'accounting.payments',
  // A granular-only Custom Connection has the specific report scopes, NOT the
  // broad accounting.reports.read. Request the ones this project reads.
  'accounting.reports.aged.read',
  'accounting.reports.profitandloss.read',
  'accounting.reports.balancesheet.read',
].join(' ');

let dotEnvLoaded = false;

/** Self-load api/.env once for standalone (tsx) runs. Never overrides set vars. */
export function loadDotEnv(): void {
  if (dotEnvLoaded) return;
  dotEnvLoaded = true;
  // Look for api/.env walking up from cwd; also try ./api/.env from repo root.
  const candidates: string[] = [];
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    candidates.push(join(dir, '.env'));
    candidates.push(join(dir, 'api', '.env'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const found = candidates.find((p) => existsSync(p));
  if (!found) return;
  for (const line of readFileSync(found, 'utf8').split('\n')) {
    const m = /^(?:export\s+)?([A-Za-z_][\w.]*)\s*=\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1] as string;
    let value = (m[2] ?? '').trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function requireEnv(name: string): string {
  loadDotEnv();
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `MissingEnv: ${name} is empty — set it in api/.env. An empty Xero client ` +
        `id/secret surfaces from the token endpoint as 400 invalid_request.`,
    );
  }
  return v.trim();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

let cachedToken: { token: string; expiresAtMs: number } | null = null;
let workingScopeString: string | null = null;
let tenant: { id: string; name: string } | null = null;
let tenantResolved = false;

export class XeroAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XeroAuthError';
  }
}

async function requestToken(scope: string): Promise<Response> {
  const clientId = requireEnv('XERO_CLIENT_ID');
  const clientSecret = requireEnv('XERO_CLIENT_SECRET');
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  return fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
  });
}

/** Mint a token, discovering the scope string the app actually grants. */
async function mintToken(): Promise<string> {
  const override = process.env.XERO_SCOPES?.trim();
  const chain =
    workingScopeString !== null
      ? [workingScopeString] // reuse the scope string we already know works ('' is valid)
      : override
        ? [override]
        : // Broad first; granular for post-Apr-2026 CCs; finally an empty scope,
          // which makes Xero grant exactly the scopes the app has (works for any
          // real Custom Connection).
          [BROAD_SCOPES, GRANULAR_SCOPES, ''];

  let lastBody = '';
  for (const scope of chain) {
    const res = await requestToken(scope);
    if (res.ok) {
      const json = (await res.json()) as TokenResponse;
      workingScopeString = scope;
      cachedToken = {
        token: json.access_token,
        expiresAtMs: Date.now() + json.expires_in * 1000,
      };
      return json.access_token;
    }
    lastBody = await res.text();
    // Only fall through the chain on invalid_scope; other errors are terminal.
    if (!lastBody.includes('invalid_scope')) break;
  }
  throw new XeroAuthError(
    `XeroTokenError: could not obtain an accounting-scoped token. Last response: ` +
      `${lastBody.slice(0, 400)}. If this says invalid_scope, the api/.env creds are ` +
      `not a Custom Connection with accounting scopes — see HANDOFF.md.`,
  );
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) {
    return cachedToken.token;
  }
  return mintToken();
}

export function invalidateToken(): void {
  cachedToken = null;
}

/** Resolve the single-org tenant id (cached). Null for a clean CC that 400s. */
export async function resolveTenant(): Promise<{ id: string; name: string } | null> {
  if (tenantResolved) return tenant;
  tenantResolved = true;
  try {
    const token = await getAccessToken();
    const res = await fetch(CONNECTIONS_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ tenantId: string; tenantName: string }>;
    if (Array.isArray(arr) && arr.length > 0) {
      tenant = { id: arr[0].tenantId, name: arr[0].tenantName };
    }
  } catch {
    tenant = null;
  }
  return tenant;
}

// ---------------------------------------------------------------------------
// Error envelope parsing
// ---------------------------------------------------------------------------

export interface XeroValidationError {
  Message?: string;
  Description?: string;
}
export interface XeroErrorElement {
  ValidationErrors?: XeroValidationError[];
  [k: string]: unknown;
}
export interface XeroApiException {
  ErrorNumber?: number;
  Type?: string;
  Message?: string;
  Elements?: XeroErrorElement[];
}

export function flattenValidationErrors(env: XeroApiException): string[] {
  const out: string[] = [];
  for (const el of env.Elements ?? []) {
    for (const e of el.ValidationErrors ?? []) {
      const t = e.Message ?? e.Description;
      if (t) out.push(t);
    }
  }
  return out;
}

export class XeroHttpError extends Error {
  constructor(
    readonly status: number,
    readonly envelope: XeroApiException | null,
    readonly rawBody: string,
  ) {
    const details = envelope ? flattenValidationErrors(envelope) : [];
    super(
      `XeroHttpError ${status}: ${envelope?.Message ?? rawBody.slice(0, 300)}` +
        (details.length ? ` | ${details.join('; ')}` : ''),
    );
    this.name = 'XeroHttpError';
  }
}

export interface StatusAttributed {
  StatusAttributeString?: 'OK' | 'WARNING' | 'ERROR';
  ValidationErrors?: XeroValidationError[];
}

export function assertElementOk<T extends StatusAttributed>(el: T, ctx: string): T {
  if (el.StatusAttributeString === 'ERROR') {
    const msg = (el.ValidationErrors ?? [])
      .map((e) => e.Message ?? e.Description ?? 'unknown')
      .join('; ');
    throw new Error(`XeroValidationError: ${ctx}: ${msg}`);
  }
  return el;
}

export interface Pagination {
  page: number;
  pageSize: number;
  pageCount: number;
  itemCount: number;
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

export interface XeroRequestInit {
  method?: 'GET' | 'PUT' | 'POST';
  json?: unknown;
  body?: Uint8Array;
  contentType?: string;
  query?: Record<string, string | number | boolean | undefined>;
  idempotencyKey?: string;
  ifModifiedSince?: Date;
  accept?: string;
  /** Absolute base override (e.g. reports live under the same base). */
  baseUrl?: string;
}

const MAX_RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function xeroRequest(path: string, init: XeroRequestInit = {}): Promise<Response> {
  const base = init.baseUrl ?? ACCOUNTING_BASE;
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = { Accept: init.accept ?? 'application/json' };
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  if (init.body !== undefined) {
    if (!init.contentType) throw new Error('MissingContentType: raw uploads need a MIME type');
    headers['Content-Type'] = init.contentType;
  }
  if (init.idempotencyKey !== undefined) {
    if (init.idempotencyKey.length > 128) {
      throw new Error(`IdempotencyKeyTooLong: ${init.idempotencyKey.length} > 128`);
    }
    headers['Idempotency-Key'] = init.idempotencyKey;
  }
  if (init.ifModifiedSince !== undefined) {
    headers['If-Modified-Since'] = init.ifModifiedSince.toUTCString();
  }

  // A resolved tenant id is safe to send on a CC and required if the token is
  // ever standard-app shaped. Omitted when unresolved (clean CC works without).
  const t = await resolveTenant();
  if (t) headers['Xero-Tenant-Id'] = t.id;

  let body: string | ArrayBuffer | undefined;
  if (init.json !== undefined) body = JSON.stringify(init.json);
  else if (init.body !== undefined) {
    const buf = new ArrayBuffer(init.body.byteLength);
    new Uint8Array(buf).set(init.body);
    body = buf;
  }

  for (let attempt = 0; ; attempt++) {
    headers.Authorization = `Bearer ${await getAccessToken()}`;
    const res = await fetch(url, { method: init.method ?? 'GET', headers, body });

    if (res.status === 401 && attempt < MAX_RETRIES) {
      invalidateToken();
      continue;
    }
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '0');
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1000;
      // eslint-disable-next-line no-console
      console.warn(`[xero] 429 (${res.headers.get('x-rate-limit-problem') ?? '?'}) retry ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      const raw = await res.text();
      let env: XeroApiException | null = null;
      try {
        env = JSON.parse(raw) as XeroApiException;
      } catch {
        env = null;
      }
      throw new XeroHttpError(res.status, env, raw);
    }
    return res;
  }
}

export async function xeroFetch<T>(path: string, init: XeroRequestInit = {}): Promise<T> {
  const res = await xeroRequest(path, init);
  return (await res.json()) as T;
}

/** True if we can currently obtain an accounting-capable token + tenant. */
export async function xeroHealthCheck(): Promise<{
  ok: boolean;
  orgName: string | null;
  scope: string | null;
  reason: string | null;
}> {
  try {
    await getAccessToken();
    const t = await resolveTenant();
    // A working CC either resolves a tenant OR serves accounting without one.
    // Probe a cheap read to be sure.
    await xeroFetch('/Organisation', {});
    return { ok: true, orgName: t?.name ?? 'Xero organisation', scope: workingScopeString, reason: null };
  } catch (e) {
    const t = tenant;
    // If /Organisation 403s but we have a tenant + token, accounting reads still work.
    if (e instanceof XeroHttpError && e.status === 403 && t) {
      return { ok: true, orgName: t.name, scope: workingScopeString, reason: null };
    }
    return {
      ok: false,
      orgName: null,
      scope: workingScopeString,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
