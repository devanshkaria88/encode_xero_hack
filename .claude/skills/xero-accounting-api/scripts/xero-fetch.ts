// .claude/skills/xero-accounting-api/scripts/xero-fetch.ts
//
// Thin typed HTTP helper for the Xero Accounting API over a Custom Connection
// (client_credentials grant, single organisation). Transport only: .env
// self-load, env assertion, token caching, JSON Accept header, query encoding,
// 429 retry honouring Retry-After, and error-envelope parsing. No business
// logic — match/approval decisions live in api/src/modules/.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const ACCOUNTING_BASE = "https://api.xero.com/api.xro/2.0";
const TOKEN_URL = "https://identity.xero.com/connect/token";

// Custom connections set scopes at app creation AND in each token request
// body. Override with XERO_SCOPES (space-separated); default mirrors the
// scopes named in .env.example.
const DEFAULT_SCOPES =
  "accounting.transactions accounting.contacts accounting.attachments accounting.reports.read";

let dotEnvLoaded = false;

/**
 * Self-load the repo-root .env once (tsx does not auto-load it). Walks up from
 * cwd to find .env; skips comments/blanks, tolerates a leading `export `,
 * strips MATCHING single/double quotes, never overrides existing process.env.
 */
export function loadDotEnv(): void {
  if (dotEnvLoaded) return;
  dotEnvLoaded = true;
  let dir = process.cwd();
  while (!existsSync(join(dir, ".env"))) {
    const parent = dirname(dir);
    if (parent === dir) return; // no .env — vars may already be exported
    dir = parent;
  }
  for (const line of readFileSync(join(dir, ".env"), "utf8").split("\n")) {
    const match = /^(?:export\s+)?([A-Za-z_][\w.]*)\s*=\s*(.*)$/.exec(line.trim());
    if (!match) continue; // comment, blank, or malformed line
    const key = match[1] as string;
    let value = (match[2] ?? "").trim();
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
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `MissingEnv: ${name} is empty — set it in .env at the repo root. ` +
        `An empty client id/secret surfaces from the token endpoint as ` +
        `400 invalid_request (verified 2026-07-04), which points away from the real cause.`,
    );
  }
  return value;
}

interface TokenResponse {
  access_token: string;
  expires_in: number; // seconds; access tokens live at most ~30 minutes
  token_type: string;
  scope?: string;
}

let cachedToken: { token: string; expiresAtMs: number } | null = null;

/** Client-credentials token, cached in-process until 60s before expiry. */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const clientId = requireEnv("XERO_CLIENT_ID");
  const clientSecret = requireEnv("XERO_CLIENT_SECRET");
  const scope = process.env.XERO_SCOPES?.trim() || DEFAULT_SCOPES;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }).toString(),
  });

  if (!res.ok) {
    // Body carries Xero's OAuth error code: 400 invalid_request = empty client
    // id / missing Authorization / JSON body; 400 invalid_client = wrong creds;
    // unauthorized_client = app is not a Custom Connection or the grant is not
    // enabled (verified 2026-07-04). Never log the secret itself.
    const body = await res.text();
    throw new Error(`XeroTokenError: ${res.status} ${body.slice(0, 500)}`);
  }

  const token = (await res.json()) as TokenResponse;
  cachedToken = {
    token: token.access_token,
    expiresAtMs: Date.now() + token.expires_in * 1000,
  };
  return cachedToken.token;
}

// ---------------------------------------------------------------------------
// Error envelope (HTTP 400 ApiException, and per-element validation shapes)
// ---------------------------------------------------------------------------

export interface XeroValidationError {
  /** The 400 ApiException envelope uses "Message". */
  Message?: string;
  /** The docs' summarizeErrors=false bulk example uses "Description". */
  Description?: string;
}

export interface XeroErrorElement {
  ValidationErrors?: XeroValidationError[];
  [key: string]: unknown;
}

/** HTTP 400 body shape: { ErrorNumber, Type, Message, Elements[].ValidationErrors[] } */
export interface XeroApiException {
  ErrorNumber?: number;
  Type?: string;
  Message?: string;
  Elements?: XeroErrorElement[];
}

export function flattenValidationErrors(envelope: XeroApiException): string[] {
  const out: string[] = [];
  for (const element of envelope.Elements ?? []) {
    for (const err of element.ValidationErrors ?? []) {
      const text = err.Message ?? err.Description;
      if (text) out.push(text);
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
        (details.length > 0 ? ` | ValidationErrors: ${details.join("; ")}` : ""),
    );
    this.name = "XeroHttpError";
  }
}

/**
 * With ?summarizeErrors=false a batch write returns HTTP 200 even when an
 * element failed — each element carries StatusAttributeString OK/WARNING/ERROR.
 */
export interface StatusAttributed {
  StatusAttributeString?: "OK" | "WARNING" | "ERROR";
  ValidationErrors?: XeroValidationError[];
  Warnings?: XeroValidationError[];
}

export function assertElementOk<T extends StatusAttributed>(element: T, context: string): T {
  if (element.StatusAttributeString === "ERROR") {
    const messages = (element.ValidationErrors ?? [])
      .map((e) => e.Message ?? e.Description ?? "unknown")
      .join("; ");
    throw new Error(`XeroValidationError: ${context}: ${messages}`);
  }
  return element;
}

/** Paged responses include "pagination": {page, pageSize, pageCount, itemCount}. */
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
  method?: "GET" | "PUT" | "POST";
  /** JSON payload — serialised and sent with Content-Type: application/json. */
  json?: unknown;
  /** Raw bytes (attachment uploads). Requires contentType. */
  body?: Uint8Array;
  /** Content-Type for raw `body` uploads — must be the file's MIME type. */
  contentType?: string;
  /** Query params (where, order, page, pageSize, ...). Values are URL-encoded here. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Sent as Idempotency-Key. POST/PUT only; Xero caches 6 min; max 128 chars. */
  idempotencyKey?: string;
  /** Sent as If-Modified-Since (UTC, accurate to the second). */
  ifModifiedSince?: Date;
  /** Override Accept. Default application/json (Xero's default is XML). */
  accept?: string;
}

const MAX_RATE_LIMIT_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Low-level call: auth + headers + query encoding + 429 retry. Throws
 * XeroHttpError on any non-2xx (with the parsed ApiException when present).
 *
 * No xero-tenant-id header: a Custom Connection is bound to exactly ONE
 * organisation, so the tenant is implicit — the documented custom-connection
 * call carries only Authorization + Accept (see SKILL.md).
 */
export async function xeroRequest(path: string, init: XeroRequestInit = {}): Promise<Response> {
  const url = new URL(`${ACCOUNTING_BASE}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    Accept: init.accept ?? "application/json",
  };
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.body !== undefined) {
    if (!init.contentType) {
      throw new Error("MissingContentType: raw body uploads must set the file's MIME type");
    }
    headers["Content-Type"] = init.contentType;
  }
  if (init.idempotencyKey !== undefined) {
    if (init.idempotencyKey.length > 128) {
      throw new Error(
        `IdempotencyKeyTooLong: ${init.idempotencyKey.length} chars — Xero rejects keys over 128 with a 400`,
      );
    }
    headers["Idempotency-Key"] = init.idempotencyKey;
  }
  if (init.ifModifiedSince !== undefined) {
    headers["If-Modified-Since"] = init.ifModifiedSince.toUTCString();
  }

  let body: string | ArrayBuffer | undefined;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
  } else if (init.body !== undefined) {
    // Copy into a plain ArrayBuffer so the bytes satisfy fetch's BodyInit
    // regardless of the Uint8Array's backing buffer type.
    const buffer = new ArrayBuffer(init.body.byteLength);
    new Uint8Array(buffer).set(init.body);
    body = buffer;
  }

  for (let attempt = 0; ; attempt++) {
    // Token per attempt: a daily-limit Retry-After can exceed the ~30-min token
    // life, and the in-process cache makes a still-fresh token free to fetch.
    headers.Authorization = `Bearer ${await getAccessToken()}`;
    const res = await fetch(url, { method: init.method ?? "GET", headers, body });

    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      // Xero sends Retry-After (seconds) on minute/daily limits and
      // X-Rate-Limit-Problem naming the limit hit. Honour Retry-After.
      const retryAfterSec = Number(res.headers.get("retry-after") ?? "0");
      const waitMs = retryAfterSec > 0 ? retryAfterSec * 1000 : 1_000;
      console.warn(
        `[xero] 429 (limit: ${res.headers.get("x-rate-limit-problem") ?? "unknown"}) — retrying in ${waitMs}ms`,
      );
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const raw = await res.text();
      let envelope: XeroApiException | null = null;
      try {
        envelope = JSON.parse(raw) as XeroApiException;
      } catch {
        envelope = null;
      }
      throw new XeroHttpError(res.status, envelope, raw);
    }

    return res;
  }
}

/** JSON call — the default for everything except raw attachment content. */
export async function xeroFetch<T>(path: string, init: XeroRequestInit = {}): Promise<T> {
  const res = await xeroRequest(path, init);
  return (await res.json()) as T;
}
