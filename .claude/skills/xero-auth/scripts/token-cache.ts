// .claude/skills/xero-auth/scripts/token-cache.ts
//
// In-memory client_credentials token cache for a Xero Custom Connection.
// Copy into api/src/modules/xero/ and register as a NestJS provider via
// useFactory (see SKILL.md) — this file itself has zero framework imports so
// it compiles standalone under strict / ES2022 / commonjs / types=["node"].
//
// Why this exists: Xero's own MCP server requests a brand-new token (plus a
// GET /connections) on EVERY call — two wasted round-trips of latency per
// call (whether those requests also count against the tenant rate limit is
// UNVERIFIED — check before relying). Do the opposite:
//   - cache the token in memory until expiry minus a 60s buffer
//     (pattern: xero-command-line TOKEN_BUFFER_MS = 60_000),
//   - single-flight concurrent token requests,
//   - on 401 invalidate + fetch a fresh token + retry exactly once
//     (pattern: xero-command-line withRetry).
// client_credentials issues NO refresh_token (response fields: access_token,
// expires_in, token_type, scope) — "refresh" simply means asking again.

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

/** Refresh this long before expiry, so in-flight calls never race the deadline. */
const EXPIRY_BUFFER_MS = 60_000;

export class MissingCredentialError extends Error {
  constructor(name: string) {
    super(
      `${name} is empty — if it reaches Xero the token endpoint answers a misleading ` +
        `400 invalid_request, which points away from the real cause. ` +
        `Set it in .env and fail at boot, not mid-request.`,
    );
    this.name = "MissingCredential";
  }
}

export class XeroTokenError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Xero token request failed with HTTP ${status}: ${body}`);
    this.name = "XeroTokenError";
  }
}

export interface XeroTokenCacheConfig {
  clientId: string;
  clientSecret: string;
  /** Space-separated scope list, sent in the token request body. */
  scope: string;
}

export class XeroTokenCache {
  private accessToken: string | null = null;
  private expiresAtMs = 0;
  private inflight: Promise<string> | null = null;

  constructor(private readonly config: XeroTokenCacheConfig) {
    if (config.clientId.trim() === "") throw new MissingCredentialError("XERO_CLIENT_ID");
    if (config.clientSecret.trim() === "") throw new MissingCredentialError("XERO_CLIENT_SECRET");
    if (config.scope.trim() === "") throw new MissingCredentialError("scope");
  }

  /** Returns a valid access token, reusing the cached one when fresh. */
  async getAccessToken(): Promise<string> {
    if (this.accessToken !== null && Date.now() < this.expiresAtMs - EXPIRY_BUFFER_MS) {
      return this.accessToken;
    }
    // Single-flight: concurrent callers share one token request instead of
    // each paying its own token round-trip.
    if (this.inflight === null) {
      this.inflight = this.requestToken().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** Drop the cached token (call on a 401 before retrying). */
  invalidate(): void {
    this.accessToken = null;
    this.expiresAtMs = 0;
  }

  private async requestToken(): Promise<string> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      "base64",
    );
    const res = await fetch(XERO_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        // Form-encoded, NEVER JSON — the token endpoint is not a JSON API.
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(this.config.scope)}`,
    });
    const text = await res.text();
    if (!res.ok) {
      // Body carries Xero's OAuth error (unauthorized_client, invalid_scope, ...)
      // and never contains the secret, so it is safe to surface.
      throw new XeroTokenError(res.status, text);
    }
    const parsed = JSON.parse(text) as { access_token?: unknown; expires_in?: unknown };
    if (typeof parsed.access_token !== "string" || parsed.access_token === "") {
      throw new XeroTokenError(res.status, "response body had no access_token");
    }
    const expiresInSec = typeof parsed.expires_in === "number" ? parsed.expires_in : 0;
    this.accessToken = parsed.access_token;
    this.expiresAtMs = Date.now() + expiresInSec * 1000;
    return this.accessToken;
  }
}

export interface XeroFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * fetch against the Xero API with the cached token; on 401, invalidate,
 * fetch a fresh token, and retry exactly once. 403 is NOT retried — that is
 * a missing scope, and the same token can never succeed.
 *
 * No xero-tenant-id header: a Custom Connection is bound to a single
 * organisation and the documented call sends only Authorization + Accept.
 */
export async function xeroFetch(
  cache: XeroTokenCache,
  url: string,
  init?: XeroFetchInit,
): Promise<Response> {
  const doFetch = async (): Promise<Response> => {
    const token = await cache.getAccessToken();
    return fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
      body: init?.body,
    });
  };

  const first = await doFetch();
  if (first.status !== 401) {
    return first;
  }
  cache.invalidate();
  return doFetch();
}
