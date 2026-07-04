---
name: xero-auth
description: Xero Custom Connection (client_credentials) auth for THIS repo — exact token endpoint, the four project scopes and what each unlocks, in-memory token caching with proactive expiry and retry-on-401, why there is no XERO_TENANT_ID, and the Gate G0 verify script. Use when writing or debugging any code that obtains or uses a Xero access token, when a Xero call returns 401/403/unauthorized_client/invalid_client/invalid_scope, or before the first Xero call in a fresh environment. Read this BEFORE writing token code; there is exactly ONE token path in this repo (api/src/modules/xero/) — do not hand-roll a second.
---

# Xero auth: Custom Connection, client_credentials, ONE org

This project uses a **Custom Connection** app: client_credentials grant, bound to a **single Xero organisation**. No consent screen, no redirect URI, no refresh token, no tenant juggling. If you find yourself writing OAuth callback or PKCE code, stop — wrong flow.

## ⚠️ Pre-flight — do this FIRST (skipping it costs hours)

1. **Assert `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` non-empty at boot, with named errors.** Empty/missing secrets that reach Xero surface as a misleading OAuth error that points away from the real cause — verified empirically 2026-07-04: an empty client id in the Basic header gets 400 `{"error":"invalid_request"}` from the token endpoint (in code flow the same mistake surfaces as `unauthorized_client`). `.env` at repo root only; never committed, never logged. When logging, log lengths (`client_id_len`), never values.
2. **Confirm the app is a Custom Connection and has been authorised.** A non-Custom-Connection app (client_credentials grant not enabled) answers 400 `unauthorized_client` at the token endpoint — the most common real cause of that error. App creation includes selecting scopes and "who will authorise the connection" — an org admin must complete that authorisation before tokens are useful. (Exact failure mode of an unauthorised app: UNVERIFIED — check before relying. `verify-auth.ts` treats "token OK but zero connections" as this case.) Custom Connections only exist for AU/NZ/UK/US orgs and are free against the Demo Company.
3. **Portal scopes must cover what the token request asks for.** Scopes are configured at BOTH ends: selected on the app in the developer portal, AND sent space-separated in the token request body (unlike code/PKCE, where scopes ride the URL).
4. **Run Gate G0** before wiring anything else:

```bash
npx tsx .claude/skills/xero-auth/scripts/verify-auth.ts
```

Expected output ends with `G0 PASS` after printing org name, invoice count, and rate-limit headers. Any failure prints a named error — look it up in the table at the bottom.

## Token endpoint — the facts

| Fact | Value |
| --- | --- |
| Endpoint | `POST https://identity.xero.com/connect/token` |
| Auth | `Authorization: Basic base64(client_id + ":" + client_secret)` — header, NOT body params |
| Content-Type | `application/x-www-form-urlencoded` — form-encoded body, NEVER JSON |
| Body | `grant_type=client_credentials&scope=<url-encoded space-separated scopes>` |
| Response fields | `access_token` (a JWT), `expires_in` (seconds), `token_type: Bearer`, `scope` |
| Lifetime | up to 30 minutes (`expires_in` ~1800) |
| Refresh token | **None.** The response has no `refresh_token` field. "Refresh" = request a new token. `offline_access` is a code-flow concern — do not request it. |

Minimal request (this exact shape lives in `scripts/token-cache.ts`):

```ts
const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
const res = await fetch("https://identity.xero.com/connect/token", {
  method: "POST",
  headers: {
    Authorization: `Basic ${basic}`,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  },
  body: `grant_type=client_credentials&scope=${encodeURIComponent(scopes)}`,
});
```

## Scopes: exactly four, and why nothing more

Request the minimum. Env vars needed: `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` — that is all. There is deliberately **no `XERO_TENANT_ID`** (see next section).

| Scope | Unlocks | Why this project needs it |
| --- | --- | --- |
| `accounting.transactions` | Broad scope = union of `accounting.invoices` (Invoices, CreditNotes, Quotes, **PurchaseOrders**, RepeatingInvoices, LinkedTransactions, Items), `accounting.payments` (Payments, BatchPayments, Overpayments, Prepayments), `accounting.banktransactions`, `accounting.manualjournals` | Bills (ACCPAY invoices), Purchase Orders, and payments are the match engine's subjects — read and write |
| `accounting.contacts` | Contacts, ContactGroups | Supplier resolution and dedup (contacts are NOT auto-deduplicated by email) |
| `accounting.attachments` | Attachments across most resources | Evidence documents attached to bills/POs via the raw Accounting API (no MCP tool exists — see `xero-accounting-api` skill) |
| `accounting.reports.read` | Broad scope = the eight `accounting.reports.*.read` reports (aged, balancesheet, banksummary, budgetsummary, executivesummary, profitandloss, trialbalance, taxreports) | Aged payables and financial context reads — read-only on purpose |

What we deliberately do NOT request:

- `openid profile email` — identity scopes for a human user; client_credentials has no user.
- `offline_access` — no refresh token exists in this grant; requesting it buys nothing.
- `accounting.settings[.read]` — grants Accounts, Organisation, TaxRates, etc. We don't read org configuration. Consequence: `GET /api.xro/2.0/Organisation` **403s** under our scopes (inferred from Xero's scope-grants table, not yet observed live — verify once creds exist); the org name comes from `GET https://api.xero.com/connections` (`tenantName`) instead, which is what `verify-auth.ts` does.
- Payroll, budgets, journals — out of scope for this product.

### Broad-scope migration (dates matter)

From 29 April 2026 all custom connections have access to granular scopes; new custom connections lose `accounting.journals.read`; existing custom connections can keep using broad scopes until **September 2027**. Whether a custom connection created today can still request the broad `accounting.transactions` / `accounting.reports.read`: UNVERIFIED — check before relying. Handle it empirically, the way Xero's own MCP server does: request broad, and on HTTP 400 `invalid_scope` retry with the granular equivalents. `verify-auth.ts` implements exactly this fallback and warns loudly when it triggers. Granular mapping for our set:

| Broad (ours) | Granular equivalent |
| --- | --- |
| `accounting.transactions` | `accounting.invoices accounting.payments accounting.banktransactions accounting.manualjournals` |
| `accounting.reports.read` | `accounting.reports.aged.read accounting.reports.balancesheet.read accounting.reports.banksummary.read accounting.reports.budgetsummary.read accounting.reports.executivesummary.read accounting.reports.profitandloss.read accounting.reports.trialbalance.read accounting.reports.taxreports.read` |
| `accounting.contacts`, `accounting.attachments` | never broad — use as-is |

Source of truth (re-check periodically — dates and assignments change): https://developer.xero.com/documentation/guides/oauth2/scopes

## Tenant id: omit the header

Custom Connections "access data from a single Xero organisation" — one org, period (multi-org needs code/PKCE flow). The documented custom-connection API call sends **exactly two headers**:

```
Authorization: Bearer <access_token>
Accept: application/json
```

No `xero-tenant-id`. (An explicit docs sentence "the header is not required" does not exist — UNVERIFIED — check before relying — but the canonical example omits it. Contrast: standard code-flow tokens REQUIRE `xero-tenant-id` on every call.) Xero's own MCP server sends a tenant id anyway, resolving it at runtime via `GET https://api.xero.com/connections` → `connections[0].tenantId`.

**Rule for this repo:** omit the header on raw custom-connection calls. If a shared code path insists on one, resolve it from `GET /connections` at runtime — never hardcode it, never put it in `.env`. That is WHY there is no `XERO_TENANT_ID` env var.

Note a docs wrinkle: the client-credentials page says Custom Connection apps "can only access tenanted endpoints and cannot access non-tenanted endpoints", yet `GET /connections` demonstrably works with a custom-connection token — Xero's MCP server depends on it for tenant resolution. Trust the working call.

## Token caching — do NOT copy Xero's MCP server

The MCP server requests a brand-new token plus a `GET /connections` on **every** tool call: two wasted round-trips of latency per call. (Whether identity.xero.com token grants and `GET /connections` count toward the tenant 60/min budget is UNVERIFIED — check before relying — the caching case stands on latency and the 5-concurrent cap alone.) Do the opposite. `scripts/token-cache.ts` is the drop-in module:

- Cache the token in memory; reuse until `expires_at - 60s` (60s buffer, same as Xero's CLI `TOKEN_BUFFER_MS`), computed from `expires_in`.
- Single-flight: concurrent callers share one in-progress token request.
- On **401**: invalidate, fetch a fresh token, retry exactly **once** (`xeroFetch` helper). On failure after retry, surface the error — no infinite loops.
- On **403**: never retry — that is a missing scope; the same token can never succeed.
- The cache holds the token in process memory only. Never persist it, never log it, never send it to the browser.

NestJS wiring (illustrative — real module lives in `api/src/modules/xero/`):

```ts
// api/src/modules/xero/xero.module.ts
{
  provide: XeroTokenCache,
  useFactory: (config: ConfigService) =>
    new XeroTokenCache({
      clientId: config.getOrThrow("XERO_CLIENT_ID"),
      clientSecret: config.getOrThrow("XERO_CLIENT_SECRET"),
      scope: "accounting.transactions accounting.contacts accounting.attachments accounting.reports.read",
    }),
  inject: [ConfigService],
}
```

The constructor throws `MissingCredential` on empty values, so a misconfigured boot dies at startup, not mid-demo.

## Rate-limit headers (read them, print them, respect them)

| Header | Meaning |
| --- | --- |
| `X-MinLimit-Remaining` | calls left this minute (limit: 60/min per tenant) |
| `X-DayLimit-Remaining` | calls left today (1,000/day on the starter tier — the new-app default; 5,000 on higher tiers. This header tells you which you have) |
| `X-AppMinLimit-Remaining` | app-wide calls left this minute (10,000/min across all tenants) |
| `X-Rate-Limit-Problem` | on a 429: which limit you hit |
| `Retry-After` | on a 429: seconds to wait before calling again — use it, the window is fixed per tenant |

Also: max 5 concurrent calls per tenant. Whether identity.xero.com token grants and `GET /connections` count toward these budgets is UNVERIFIED — check before relying.

## Scripts

| File | Purpose |
| --- | --- |
| `scripts/verify-auth.ts` | **Gate G0.** Parses repo-root `.env` itself (no dotenv), asserts env with named errors, fetches a token (with granular-scope fallback), GETs the org name via `/connections` and 1 invoice, prints org + invoice count + rate-limit headers. Run: `npx tsx .claude/skills/xero-auth/scripts/verify-auth.ts` from repo root. |
| `scripts/token-cache.ts` | In-memory token cache + `xeroFetch` retry-on-401 helper, shaped for a NestJS `useFactory` provider. Zero npm deps; compiles standalone under strict/ES2022/commonjs. |

## Traps

- **A misleading OAuth error from an empty or whitespace client id.** The cause is your env; the error points at Xero. Verified empirically 2026-07-04 against the live token endpoint: empty client id in the Basic header, or a missing Authorization header entirely → 400 `{"error":"invalid_request"}`. (The Lovable skill's `unauthorized_client` symptom for `client_id=undefined` is the code-flow authorize URL, not this endpoint.) Assert non-empty **and trimmed** at boot — a trailing newline in `.env` counts as whitespace.
- **`invalid_client` from a wrong secret or wrong Basic encoding.** Verified empirically 2026-07-04: well-formed Basic header with wrong credentials → 400 `{"error":"invalid_client"}`. Base64 the literal `client_id:client_secret` — one colon, no newline, whole string encoded together; garbled encoding produces the same `invalid_client` (a structurally broken header degrades to `invalid_request`).
- **403 vs 401 are different diseases.** `401` = the token itself is bad or expired (>30 min) → new token, retry once. `403` = the token is fine but lacks a scope → fix the scope list at BOTH ends (portal + token request), get a NEW token. Retrying a 403 with the same token can never succeed.
- **The token endpoint wants form-encoding, not JSON.** `Content-Type: application/x-www-form-urlencoded` with a `key=value&key=value` body. Verified empirically 2026-07-04: a JSON body → 400 `{"error":"invalid_request"}`, the same misleading error as a missing client id.
- **An org admin must authorise the Custom Connection before tokens work.** App setup chooses "who will authorise the connection"; until they do, the connection is dead. `verify-auth.ts` reports "token OK but zero connections" for this.
- **Broad scopes can 400 `invalid_scope` on newer apps.** Post-April-2026 granular migration — retry with the granular set (table above). `verify-auth.ts` does this automatically.
- **The granular fallback can itself 400 `invalid_scope`** when the portal app doesn't have every scope in the fallback set enabled. Escape hatch: set `XERO_SCOPES` in `.env` to exactly the scopes the portal app grants — `verify-auth.ts` uses it verbatim, skipping both built-in sets.
- **`GET /Organisation` 403s under our scopes.** It needs `accounting.settings[.read]`, which we deliberately don't request. (Inferred from Xero's scope-grants table, not yet observed live — verify once creds exist.) Get the org name from `GET /connections` (`tenantName`).
- **Scope cannot be widened on an existing token.** Cheap fix here (unlike code flow): request a new token with the wider scope — provided the portal app has that scope enabled.
- **Token-per-call is pure overhead.** The MCP-server pattern adds two wasted round-trips of latency to every call. Cache.
- **`verify-auth.ts` locates `.env` via `__dirname`,** which works today only because no root `package.json` exists (tsx treats the script as CommonJS). If a root `package.json` ever declares `"type": "module"`, `__dirname` throws under tsx and G0 breaks — switch the script to `import.meta.dirname` or another CJS-safe path first.

## Error → real cause

Rows marked "verified empirically" were probed against the live token endpoint on 2026-07-04.

| Symptom | Real cause | Fix |
| --- | --- | --- |
| Token 400 `invalid_request` (verified empirically) | Empty client id in the Basic header, missing Authorization header, or a JSON body instead of form-encoding | Boot-time `MissingEnv` assertion; check `.env` parsing/trimming; send form-encoded body |
| Token 400 `invalid_client` (verified empirically) | Wrong secret or wrong client id, incl. malformed Basic encoding (missing colon, double-encoded, newline in the base64 input) | Re-copy the secret; encode `id:secret` as one string |
| Token 400 `unauthorized_client` | The app is not a Custom Connection / the client_credentials grant is not enabled on it — the most common real cause. (The `client_id=undefined` flavour is a code-flow authorize-URL symptom only, never this endpoint.) | Check the app type in the developer portal — recreate it as a Custom Connection |
| Token 400 `invalid_scope` | Broad scope on a granular-only app, or a scope not enabled on the app in the portal | Retry with granular equivalents; enable the scope in the portal |
| API call 401 | Token expired (~30 min) or invalid | Invalidate cache, fetch new token, retry once (`xeroFetch`) |
| API call 403 | Token lacks the scope for that resource (e.g. `/Organisation` without `accounting.settings`) | Add the scope at both ends, request a NEW token; never retry with the same token |
| API call 429 + `X-Rate-Limit-Problem` | Rate limit hit (60/min per tenant, 5 concurrent, 1,000/day starter tier or 5,000/day higher tiers, 10,000/min app-wide) | Wait `Retry-After` seconds; batch reads |
| Token OK, `GET /connections` returns `[]` | Custom Connection not yet authorised by an org admin (that this is the only cause is UNVERIFIED — check before relying) | Complete the authorisation step in the developer portal |
| `MissingEnv` / `MissingCredential` at boot | `.env` missing or var empty | Create `.env` at repo root with `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` |

Related skills: `xero-mcp-usage` (MCP vs raw API routing), `xero-accounting-api` (Purchase Orders, Attachments, History — raw API only).

<!--
Sources (fact-check trail):
- .tmp/xero-refs/facts/docs-auth.md — token endpoint, Basic auth, form-encoded body, response fields, ~30 min lifetime (Token types page), single-org quote, AU/NZ/UK/US restriction, scopes-at-both-ends, granular migration dates (29 Apr 2026 / Sep 2027), two-header call example with no xero-tenant-id (explicit "not required" sentence absent = UNVERIFIED), "tenanted endpoints only" wrinkle, rate limits + X-*Limit-Remaining/X-Rate-Limit-Problem/Retry-After headers, pagination (page/pageSize min 1, pagination.itemCount). Underlying URLs: developer.xero.com/documentation/guides/oauth2/{custom-connections,client-credentials,token-types,limits}/, /documentation/api/accounting/requests-and-responses.
- .tmp/xero-refs/facts/auth-toolkit.md + .tmp/xero-refs/xero-mcp-server/src/clients/xero-client.ts:127-203 — exact token request shape, token-per-call anti-pattern, invalid_scope granular fallback, GET /connections → connections[0].tenantId, boot env assertion.
- .tmp/xero-refs/xero-command-line/src/lib/{auth.ts,oauth.ts,xero-client.ts} — TOKEN_BUFFER_MS = 60_000, refresh-on-401 retry pattern, /connections response shape incl. tenantName, Retry-After extraction.
- .tmp/xero-refs/facts/style.md + .tmp/xero-refs/xero-prompt-library/javascript/SKILL.md:116-140 — unauthorized_client ← empty client_id causal chain (code-flow only; superseded for client_credentials by the 2026-07-04 probes below), requireEnv/client_id_len discipline, scope-grants tables (accounting.invoices → PurchaseOrders etc., accounting.settings → Organisation), broad→granular migration table, 403 = missing scope, scope minimalism rules.
- Empirical probes 2026-07-04 against live https://identity.xero.com/connect/token: wrong creds → 400 {"error":"invalid_client"}; empty client id in Basic / no Authorization header / JSON body → 400 {"error":"invalid_request"}.
- UNVERIFIED items marked inline: explicit tenant-header-not-required sentence; unauthorised-app exact failure mode (and whether empty /connections has other causes); whether new post-Apr-2026 custom connections can still request broad scopes.
-->
