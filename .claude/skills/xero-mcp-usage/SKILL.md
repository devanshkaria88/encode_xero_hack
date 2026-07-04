---
name: xero-mcp-usage
description: Decide whether a Xero call in THIS project goes through the Xero MCP server (@xeroapi/xero-mcp-server) or the raw Accounting API. Use when wiring any Xero read or write, when launching the MCP server against our Custom Connection env (XERO_CLIENT_ID / XERO_CLIENT_SECRET), or when an MCP tool seems to be missing. Covers the exact registered tool names and params for the ~10 tools this project uses, their hard limitations (list-invoices cannot filter by status, update-invoice cannot flip status, no idempotency on writes), and the confirmed MCP gaps — Purchase Orders, Attachments, and History have NO MCP tools and route to the xero-accounting-api skill. Read this BEFORE assuming an MCP tool exists.
---

# Xero MCP server vs raw Accounting API — routing for this project

The MCP server (`@xeroapi/xero-mcp-server`, facts verified against **v0.0.16**) covers invoices, contacts, payments, and reports. It does NOT cover Purchase Orders, Attachments, or History — those go through the raw Accounting API (`.claude/skills/xero-accounting-api`). This skill is the routing table plus the exact capabilities and limits of the MCP tools we use. Tool inventory in any version newer than 0.0.16: UNVERIFIED — check before relying.

## ⚠️ Pre-flight — do this FIRST (skipping it costs hours)

1. **Assert `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` are set and non-empty.** An empty client id surfaces from the token endpoint as HTTP 400 `invalid_request`; wrong credentials as 400 `invalid_client` (verified empirically 2026-07-04). The MCP server boot-asserts this itself (`xero-client.ts:19-21`, throws unless `bearer_token || (client_id && client_secret)`), but assert in our code first — the message is better.
2. **There is no tenant-id env var, on purpose.** In client_credentials (Custom Connection) mode the MCP server fetches a token from `identity.xero.com/connect/token`, then calls `GET https://api.xero.com/connections` and silently uses `connections[0].tenantId`. No selection mechanism exists. Per the official docs a Custom Connection accesses data from a **single Xero organisation**, so a multi-entry `/connections` response is not expected — the smoke test still warns if it ever sees more than one (belt-and-braces against wrong-books writes).
3. **Set `XERO_SCOPES` explicitly in `.env`** to the scopes assigned to the Custom Connection app. `.env.example` at repo root ships the `XERO_SCOPES=` line with the four project scopes (`accounting.transactions accounting.contacts accounting.attachments accounting.reports.read`) — copy it verbatim. If unset, the MCP server requests its own hardcoded legacy V1 set (including `payroll.*`) and only falls back to a granular V2 set on an `invalid_scope` HTTP 400. Whether a scope request that is only partially assigned to a custom connection fails with `invalid_scope` or returns a narrower token: UNVERIFIED — check before relying. Setting `XERO_SCOPES` verbatim to the app's assigned scopes sidesteps the question.
4. **Do not set `XERO_CLIENT_BEARER_TOKEN`** unless you mean it — it takes precedence over client id/secret and switches the server to bearer mode.
5. **Run the smoke test before wiring anything to the MCP server:**

```sh
npx tsx .claude/skills/xero-mcp-usage/scripts/check-mcp-env.ts
```

It performs the exact same token grant + `/connections` call the MCP server does on every tool invocation, prints the tenant the server will silently pick, and fails with a named error (`MissingEnv`, `TokenGrantFailed`, `ConnectionsFailed`, `NoConnections`) instead of the misleading upstream one.

## The routing table (from `context/architecture.md` — verbatim, the pitch anchor)

| Call | Via | Purpose |
|---|---|---|
| list/get invoices (ACCPAY) | MCP tool | ingest bills already in Xero |
| create invoice (ACCPAY) | MCP tool | bills arriving by email that aren't in Xero yet |
| Purchase Orders CRUD | raw Accounting API | MCP gap — read POs, mark billed |
| Attachments | raw Accounting API | archive evidence PDF/photo onto the bill |
| approve bill (status update) | MCP tool | flip AUTHORISED on green |
| create Payment | MCP/Payments API | the money moment on approval |
| aged payables by contact | MCP tool | dashboard context strip |
| History/Notes endpoint | raw API | write the agent's decision note onto the bill in Xero |

> ⚠️ **One row of this table is wrong and will burn you: "approve bill (status update) | MCP tool".** Verified against the MCP source: `update-invoice` has **no `status` parameter** and its handler hard-blocks anything that is not a draft — `if (invoiceStatus !== Invoice.StatusEnum.DRAFT) { return { isError: true, error: "Cannot update invoice because it is not a draft. Current status: ..." } }` (`update-xero-invoice.handler.ts:77-84`). The `Invoice` object it sends contains only lineItems/reference/dueDate/date/contact — no status field. **The MCP server cannot move an invoice to AUTHORISED (or any status).** Build the approve path on the raw Accounting API: `POST /Invoices` with `"Status": "AUTHORISED"` — see `.claude/skills/xero-accounting-api`. Keep the table verbatim for the pitch; route the code correctly.

## Confirmed ABSENT from the MCP server — do not go looking

Verified by grep over `xero-mcp-server/src/` (all 51 registered tools inventoried):

- **NO Purchase Order tools.** No tool name contains "purchase". The only hits are item `purchaseDetails` fields and the phrase "purchase invoices" in the create-invoice description.
- **NO Attachment tools.** Only read-only `hasAttachments` display flags. No upload/download/list.
- **NO History/Notes tools.** No `getInvoiceHistory` / `createHistoryRecord` anywhere.
- Also absent: get-invoice-by-id, delete/void invoice, email-invoice, batch payments.

All of those route to the raw Accounting API → `.claude/skills/xero-accounting-api`. If an MCP tool for them appears to exist, you are hallucinating it.

## Running the MCP server locally (Custom Connection)

- **Command:** `npx -y @xeroapi/xero-mcp-server@latest` (or a local build: `node dist/index.js`). Transport is **stdio only** — no port, no HTTP; the MCP client spawns it as a child process.
- **Env consumed** (`src/clients/xero-client.ts:14-16`): `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, optional `XERO_CLIENT_BEARER_TOKEN` (takes precedence), optional `XERO_SCOPES` (space-separated). The server calls `dotenv.config()` at boot, so launching it with cwd = repo root picks up our `.env` directly:

```sh
# from repo root — .env supplies XERO_CLIENT_ID / XERO_CLIENT_SECRET / XERO_SCOPES
npx -y @xeroapi/xero-mcp-server@latest
```

If the spawning MCP client controls cwd, pass the three vars through its `env` block instead — values injected from the environment, never literals in a committed config file.

- **Auth per call, not per boot:** every tool handler starts with `authenticate()`, which requests a **brand-new** client_credentials token plus a fresh `GET /connections` on every single tool call — 2 extra HTTP round-trips per call, no caching, no expiry check. Budget for the latency; never loop tool calls.
- **Token grant shape** (what the smoke-test script reproduces): `POST https://identity.xero.com/connect/token`, HTTP **Basic** auth `base64(clientId:clientSecret)` — not body params — with form-encoded body `grant_type=client_credentials&scope=<urlencoded>`.

## The 10 tools this project uses

Exact registered names, key params, handler files (paths under `xero-mcp-server/src/handlers/`).

| Tool | Key params | Handler | Project use |
|---|---|---|---|
| `list-invoices` | `page: number` **required**; `contactIds?: string[]`; `invoiceNumbers?: string[]` (supplying invoiceNumbers also returns line items) | list-xero-invoices.handler.ts | ingest ACCPAY bills already in Xero |
| `create-invoice` | `contactId: string`; `lineItems[]` (`description`, `quantity`, `unitAmount`, `accountCode`, `taxType`, `itemCode?`, `tracking?`); `type: "ACCREC" \| "ACCPAY"` — **REQUIRED, no code default; always pass `"ACCPAY"`**; `reference?` — **for ACCPAY, written to InvoiceNumber (Reference left empty)**; `date?` (YYYY-MM-DD); **no `dueDate` param** | create-xero-invoice.handler.ts | bills arriving by email; always created **DRAFT** |
| `update-invoice` | `invoiceId` required; `lineItems?`, `reference?`, `dueDate?`, `date?`, `contactId?`. **No `status` param.** | update-xero-invoice.handler.ts | fix a DRAFT bill before approval — nothing else |
| `create-payment` | `invoiceId`, `accountId`, `amount` (positive) required; `date?` (YYYY-MM-DD, defaults today), `reference?` | create-xero-payment.handler.ts | the money moment |
| `list-payments` | `page` (default 1); `invoiceNumber?`, `invoiceId?`, `paymentId?`, `reference?` | list-xero-payments.handler.ts | check-by-reference before create-payment |
| `list-aged-payables-by-contact` | `contactId` required; `reportDate?` (defaults end of current month), `invoicesFromDate?`, `invoicesToDate?` (all YYYY-MM-DD) | list-aged-payables-by-contact.handler.ts | dashboard context strip |
| `list-contacts` | `page?` — **omit it and the response is the UNPAGED full contact list (potentially huge); always pass `page`**; `searchTerm?` (case-insensitive over Name, FirstName, LastName, ContactNumber, EmailAddress) | list-xero-contacts.handler.ts | resolve supplier name → `contactId` |
| `create-contact` | `name` required; `email?` (must be valid email), `phone?` | create-xero-contact.handler.ts | new supplier arriving by email |
| `list-accounts` | none | list-xero-accounts.handler.ts | `accountCode` for invoice lines, `accountId` for payments |
| `list-organisation-details` | none | list-xero-organisation-details.handler.ts | org sanity check |

## Param limitations — know these before building

- **`list-invoices` cannot filter by status, date, or where-clause.** The handler hardcodes `where: undefined`, `statuses: undefined`, `order: "UpdatedDateUTC DESC"`, `includeArchived: false`, `summaryOnly: false`, and **`pageSize: 10`**. You cannot ask MCP for "all AUTHORISED bills" or "bills since Tuesday" — page through and filter in our code, or use the raw API.
- **`list-invoices` is also the only "get one invoice" path** (no get-by-id tool): pass `invoiceNumbers: ["INV-123"]` — that variant returns line items. It matches by invoice **number**, not InvoiceID.
- **`update-invoice` replaces the whole line set.** All line items must be re-supplied; omitted line items are **removed**. DRAFT invoices only.
- **`create-invoice` always creates DRAFT** (handler sets `Invoice.StatusEnum.DRAFT`) and returns a deep link. `type` is REQUIRED (enum ACCREC|ACCPAY, no code default — omitting it fails zod validation); always pass `"ACCPAY"` for bills. The "defaults to ACCREC" line in the tool description is LLM guidance, not schema behavior.
- **For ACCPAY, `reference` is written to InvoiceNumber and Reference is left EMPTY** (`create-xero-invoice.handler.ts:36-38`) — pass the supplier's invoice number as `reference`, and never match MCP-created bills on Reference. There is no way to set InvoiceNumber and Reference independently.
- **`create-invoice` cannot set the due date** — DueDate is hardcoded to today+30 days (handler line 33), with no `dueDate` param. Set the real due date with a follow-up `update-invoice` (3 extra HTTP round-trips), or create the bill via the raw API.
- **No MCP write is idempotent.** `idempotencyKey` is explicitly passed as `undefined` in createPayment and updateInvoice. Our CLAUDE.md rule (check-by-reference before create) is the only duplicate protection: `list-payments` with `reference`/`invoiceId` before `create-payment`; `list-invoices` with `invoiceNumbers` before `create-invoice` (this works for ACCPAY precisely because `reference` becomes InvoiceNumber).
- **`create-payment` constraints are enforced by Xero, not the tool:** invoice must be AUTHORISED and not fully paid; amount must not exceed amount due. The tool only validates `amount > 0`.
- **`list-payments` pages at 10/page** (hardcoded `pageSize: 10` in the handler). `list-contacts` passes `pageSize: undefined`; its description only implies 100/page ("If 100 contacts are returned, call this tool again with the next page number") rather than stating it. **Omitting the optional `page` param makes the handler call getContacts with page undefined, which returns the UNPAGED full contact list** — potentially huge; always pass `page`.

## Snippet

- `scripts/check-mcp-env.ts` — plain-fetch smoke test of the Custom Connection env, reproducing the MCP server's own auth path (token grant with Basic auth + `GET /connections`, first-tenant selection). Run it before wiring the MCP server; run it again whenever auth errors appear mid-build.

## Traps

- **Status flips are not an MCP capability.** See the warning under the routing table. `update-invoice` has no `status` param and hard-blocks non-DRAFT invoices. DRAFT → AUTHORISED goes through the raw Accounting API, full stop.
- **Rate limits are shared.** Every Accounting API call the MCP server makes consumes the SAME per-tenant budget as our raw-fetch calls from `api/src/modules/xero/`: 60/min per tenant, 5 concurrent; daily limit **1,000 (starter tier — the default for new apps)** or 5,000 (higher tiers) — check the app's tier and the `X-DayLimit-Remaining` response header. (`context/architecture.md:59` quotes 5,000/day; that is the higher-tier figure, tier-dependent, not a given.) The MCP server has **zero** rate-limit handling — no retry, no backoff, no `Retry-After` read; its only 429 behaviour is a cosmetic error string: `"Too many requests to Xero. Please try again in a moment."` (`format-error.ts:35-36`). Our module's budget accounting must count MCP tool calls too. Whether the `identity.xero.com` token calls and `GET /connections` also count against the Accounting API tenant budget: UNVERIFIED — check before relying.
- **Every tool call costs 2 hidden HTTP round-trips** (fresh token + `/connections`) because the server never caches auth. A 5-tool sequence is 15 HTTP calls. Batch reads on our side; never poll via MCP.
- **First-tenant selection.** The MCP server silently picks `connections[0]` with no selection mechanism. Per the docs a Custom Connection maps to a single organisation, so a multi-entry `/connections` response is not expected — but if one ever appeared, writes would land in whichever org happens to be first. The smoke-test script warns on multiple connections as a belt-and-braces check.
- **`create-payment` success text lies:** it reports "Invoice created successfully". It created a Payment. Do not string-match success messages; check for the error shape instead.
- **`update-invoice` deletes lines you forget.** Re-supply every line item on every update.
- **Unset `XERO_SCOPES` triggers scope guessing** (legacy V1 set with `payroll.*` first, granular V2 on `invalid_scope`). Set it explicitly to the app's assigned scopes.
- **`@latest` drift.** Everything here is verified against v0.0.16. Pin or re-verify the tool inventory if the version moves.

## Error → real cause

| Symptom | Real cause |
|---|---|
| MCP server throws at boot before any tool runs | Neither `XERO_CLIENT_BEARER_TOKEN` nor `XERO_CLIENT_ID`+`XERO_CLIENT_SECRET` present (boot assert, `xero-client.ts:19-21`) — check `.env` and the spawner's env block |
| HTTP 400 `invalid_request` on token grant | Empty client id, missing Authorization header, or a JSON body instead of form-encoded (verified empirically 2026-07-04) — run `scripts/check-mcp-env.ts` |
| HTTP 400 `invalid_client` on token grant | Wrong client id or secret — check the `.env` values |
| `unauthorized_client` on token grant | The app is not a Custom Connection — the client_credentials grant is not enabled for Web/PKCE apps; recreate the app as a Custom Connection |
| HTTP 400 `invalid_scope` | Requested scope not available to this Custom Connection; happens when `XERO_SCOPES` is unset and the server guesses. Set `XERO_SCOPES` to the app's assigned scopes |
| Tool calls fail though the server booted | Token grant works but no org authorised: `GET /connections` returned 0 — the org admin has not authorised the Custom Connection |
| `Cannot update invoice because it is not a draft. Current status: ...` | `update-invoice` hard-blocks non-DRAFT invoices; approve via raw Accounting API instead |
| `Too many requests to Xero. Please try again in a moment.` | 429 — shared per-tenant budget exhausted: 60/min, 5 concurrent, or the daily cap (1,000 starter / 5,000 higher tiers); our raw calls count too. MCP does no backoff, ours must |
| Writes appear in the wrong Xero org | Multiple orgs on the connection (not expected for a Custom Connection); server silently used `connections[0]` |
| "Invoice created successfully" after a payment | Mislabeled success text in `create-payment` — it is a Payment |
| Line items vanished after `update-invoice` | Omitted lines are removed; re-supply the full line set |
| Duplicate bill/payment after a retry | No idempotency key on MCP writes — check-by-reference (`list-invoices` / `list-payments`) before every create |
| An MCP tool for POs/Attachments/History "should exist" but does not | It does not. Route to `.claude/skills/xero-accounting-api` |

<!--
Sources (load-bearing facts):
- .tmp/xero-refs/facts/mcp.md — MCP server fact sheet (v0.0.16): tool inventory + handler paths (§1), confirmed-absent tools (§2), custom-connection run/env/tenant/scope facts (§3, citing src/clients/xero-client.ts:12-21,81-106,129-131,159-190,195-231; README.md:71-76,226-230; src/index.ts:14-15), create-payment schema/no-idempotency (§4, create-payment.tool.ts:18-34, create-xero-payment.handler.ts:15-45), update-invoice no-status + DRAFT-only block (§5, update-invoice.tool.ts:36-50, update-xero-invoice.handler.ts:77-84), list-invoices hardcoded filters/pageSize 10 (§6, list-xero-invoices.handler.ts:15-31), aged-payables params (§7), no rate limiting + format-error.ts:35-36 (§8), per-call authenticate()/no token cache (§9).
- .tmp/xero-refs/facts/auth-toolkit.md — client_credentials grant shape (Basic auth, form body, identity.xero.com/connect/token; xero-client.ts:159-174), tenant from GET /connections first entry (xero-client.ts:176-190), scope selection logic (xero-client.ts:127-157), Custom Connection requirement (xero-agent-toolkit/README.md:67), no PO/attachment/history tools (§4). (Its §4 says "50 tools" — that count is wrong; 51 *.tool.ts files verified directly.)
- .tmp/xero-refs/facts/docs-auth.md — rate limits (60/min per tenant, 5 concurrent; daily 1,000 starter / 5,000 higher tiers, new apps default to starter; X-DayLimit-Remaining header), Custom Connection = single organisation, token-endpoint error canon (invalid_request / invalid_client / unauthorized_client, verified empirically 2026-07-04).
- .tmp/xero-refs/xero-mcp-server/ (repo, verified directly): src/tools/create/create-invoice.tool.ts:38 (type required — z.enum with no .optional()/.default()), create-xero-invoice.handler.ts:33-38 (DueDate hardcoded today+30; ACCPAY reference→InvoiceNumber; DRAFT status at :39, idempotencyKey undefined at :49), src/tools/list/list-contacts.tool.ts (page/searchTerm; handler pageSize undefined, unpaged when page omitted), src/tools/create/create-contact.tool.ts (name/email/phone), src/tools/list/list-accounts.tool.ts (no params), src/tools/list/list-payments.tool.ts (params; handler pageSize 10), src/tools/list/list-organisation-details.tool.ts (no params), src/tools/list/list-invoices.tool.ts:16 (page required), package.json (v0.0.16).
- context/architecture.md — routing table (reproduced verbatim), 60/min budget (its 5,000/day figure is the higher-tier number; starter default is 1,000 — see facts/docs-auth.md), skills layout.
- .tmp/xero-refs/facts/style.md — skill format discipline (pre-flight-first, error→cause mapping, verbatim-quote practice).
- Repo root .env.example — XERO_SCOPES line used as the smoke-test default.
UNVERIFIED items are marked inline. None of them appear in scripts/check-mcp-env.ts.
-->
