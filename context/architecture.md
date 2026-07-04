# Payables Control Agent — ARCHITECTURE

Read `context.md` first. This file is the build truth.

## Stack (locked)

- **Frontend:** Next.js (App Router), TypeScript, Tailwind + shadcn/ui. Built by Cursor against the OpenAPI contract. `impeccable` + `ui-ux-pro-max` skills mandatory. `frontend-design` skill prohibited.
- **Backend:** NestJS + PostgreSQL + TypeORM. Owns ALL Xero calls, matching, decisions, WhatsApp, audit.
- **LLM:** Claude API. Document parsing only (invoice PDFs, delivery-note photos, messy email bodies → strict JSON, zod-validated, clamped). Never in the match/approve decision path.
- **Connectors:** Make.com scenario (Gmail watch → attachment + body → POST our webhook). Direct IMAP poll on the demo mailbox as stage fallback, toggled by env flag.
- **WhatsApp:** Twilio sandbox. Interactive buttons if templates behave, numbered replies as the guaranteed path.
- **Xero:** Custom Connection (client_credentials — no OAuth redirect dance, one org, perfect for demo). MCP server tools where they exist; raw Accounting API for Purchase Orders and Attachments (not in MCP). Payments API for the approve action.

## System shape

```
  Gmail/Outlook ──▶ Make scenario ──▶ POST /webhooks/email ─┐
  (IMAP poll fallback, env-flagged) ─────────────────────────┤
                                                             ▼
                        ┌───────────────────────────────────────────┐
   Google Sheet         │  NestJS                                    │
   (goods receipts) ──▶ │  ingest → parse (Claude, zod, clamp)       │
                        │  → MATCH ENGINE (pure TS, deterministic)   │
   Xero (bills, POs) ─▶ │  → decision + audit row                    │
                        │  → green: approve bill, create Payment,    │
                        │           attach evidence (Xero APIs)      │
                        │  → amber: WhatsApp exception (Twilio)      │
                        └───────────────┬───────────────────────────┘
                                        │ OpenAPI (generated types)
                                        ▼
                        Next.js dashboard: bill list, match evidence
                        drill-down (the case file), audit trail
```

## Match engine (the deterministic core — no LLM inside)

Entities: `Bill`, `PurchaseOrder`, `GoodsReceipt`, `MatchResult`, `AuditEvent`, `ExceptionAction`.

Match logic, in order:
1. **PO link:** supplier fuzzy-normalised (LLM normalises names at ingest, engine compares normalised strings) + amount within tolerance (default ±2% or £5, whichever greater) + PO date ≤ invoice date. Line-level qty×price check when lines exist on both.
2. **Receipt link:** goods receipt referencing the PO (sheet row or parsed delivery note) with received qty ≥ invoiced qty per line, or total-level if lines absent.
3. **Verdict:** `MATCHED` → auto-path. `MISSING_PO` / `MISSING_RECEIPT` / `AMOUNT_MISMATCH` / `QTY_MISMATCH` → exception path with the gap named and the evidence found so far attached.

Every verdict writes an `AuditEvent` (input refs, rule hits, tolerances applied, actor=agent|human, timestamp). The audit trail IS the 20% architecture story — surface it in the UI.

## Xero API usage map (the 30% story — name these in the pitch)

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

Rate limits: 60 calls/min/tenant, 5,000/day — batch reads, cache org data in Postgres, never poll Xero in a loop.

## API contract (frontend ↔ backend)

NestJS decorators → Swagger at `/api/docs` → `openapi.json` committed → frontend runs `openapi-typescript` to generate `web/lib/api-types.ts`. The generated file is the ONLY source of request/response types in the frontend. Contract change = regenerate + commit together. No hand-typed fetch shapes, ever.

## Repo layout

```
encode-xero-hack/
  context/            # this suite — both agents read before writing
  api/                # NestJS (Claude Code owns)
    src/modules/{ingest,match,xero,whatsapp,audit}/
    openapi.json      # committed contract
  web/                # Next.js (Cursor owns)
    lib/api-types.ts  # generated, never hand-edited
  seed/               # demo-org seeding scripts + sheet fixtures
  .claude/skills/     # Xero skills generated via context/prompt.md
```

## Build order (gates, not suggestions)

| Gate | Definition of done |
|---|---|
| G0 | Custom Connection auth proven: one script lists invoices from the demo org. Skills generated (prompt.md). Demo org seeded (~15 bills, POs in Xero, receipts sheet, 2 deliberate gaps). |
| G1 | Match engine passing unit tests against seeded data: greens green, ambers amber, correct gap names. **Highest-risk-first: this is the project.** |
| G2 | Xero write path: approve + create Payment + attach evidence + history note, verified inside Xero UI. |
| G3 | Email ingest live (Make webhook + IMAP fallback), Claude parse → engine → verdict end to end. |
| G4 | Dashboard: bill list + evidence drill-down (the case file view) + audit trail. Contract-generated types only. |
| G5 | WhatsApp exception loop (Twilio sandbox): buzz, tap/reply, chase email out, reply-photo closes match. LAST. |
| G6 | Three full live rehearsals. Pitch ×2 out loud. Hotspot configured. |

Behind at any gate: cut from the bottom. WhatsApp buttons → numbered replies → if desperate, exception actions from the dashboard instead of WhatsApp. The match engine, Xero writes, and evidence UI are untouchable.

## Live-demo rules

1. Live data only. The demo mailbox, sheet, and Xero org are real; the arriving email and the delivery-note photo are sent live on stage.
2. Streaming/optimistic UI so latency reads as the agent thinking.
3. Every failure has a rehearsed fallback path that is also live (IMAP instead of Make, numbered replies instead of buttons).
4. Demoable at every commit. Never broken at the top of any hour.

## Two-agent protocol

Claude Code owns `api/`, `seed/`, skills. Cursor owns `web/`. Both read `context/last_update.md` before any write (hook-managed). Conflicts resolve in favour of the latest entry holder. The OpenAPI contract is the only interface — neither agent reaches into the other's tree.
