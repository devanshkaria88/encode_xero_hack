# Robyn BUILD SPEC — the coordination contract

This pins the API surface, module ownership, and the decoupling rules so each
module can be built in isolation against a FIXED kernel. Read this + `context.md`
+ `architecture.md` before writing code. The invariant: every agent behaviour is a
state transition that writes to Xero or raises a Task. The LLM parses/proposes at
the edges (zod-validated); it never decides billed/unbilled and never sends.

Product is **ACCREC** (Robyn invoices the freelancer's CLIENTS). Xero `Type: "ACCREC"`.

## FIXED KERNEL — use, never edit

- `src/entities/*` — the domain model + `shapes.ts` (jsonb payload types) + `enums.ts`. Import types from `@app/entities` (barrel `src/entities/index.ts`).
- `src/modules/engine/*` — `EngineService` (global): `classify()`, `buildProposal()`, `policy()`, `step()`. Pure + unit-tested. This is Loop 1's brain.
- `src/modules/xero/xero.service.ts` — `XeroService` (global). All Xero I/O. Key methods:
  - `ensureContact(name,email?)`, `writeInvoice(WriteInvoiceInput)=>WriteInvoiceResult` (the money moment: contact+invoice+history+attachment, idempotent), `authoriseInvoice`, `getInvoice`, `findInvoiceByReference`, `listInvoices`, `listPayments`, `listQuotes`, `agedReceivablesByContact`, `defaultSalesAccountCode`, `addHistoryNote`, `uploadAttachment`, `getHistory`, `health()=>{ok,orgName,scope,reason}`, `orgName()`.
  - Xero may NOT be live yet (creds pending). Every Xero call can throw `XeroHttpError`/`XeroAuthError`. Wrap writes in try/catch: on failure, keep the local state, set a clear error message on the entity, and record an AuditEvent — never crash a request.
- `src/modules/llm/llm.service.ts` — `LlmService` (global): `parseTranscript(raw)`, `parseContract(raw)`, `classifyAgreement(from,subject,body)`, `proposeClientMatches(attendees,clients)`. All zod-validated, may throw on invalid output → caller raises a Task, never guesses.
- `src/modules/audit/audit.service.ts` — `AuditService` (global): `record({actor,action,summary,subjectType?,subjectId?,inputs?})`, `list()`, `listForSubject(id)`. Call it on EVERY state change / Xero write / policy decision / poll.
- `src/config/env.ts` — `loadConfig()`.
- `src/common/bootstrap-flag.ts` — `isServing()`. Gate @Cron side effects: `if (!isServing()) return;` at the top of every scheduled method so the OpenAPI export doesn't fire jobs.

## DECOUPLING RULES (so modules build in parallel with zero cross-imports)

1. **No feature module imports another feature module's service.** Only the global kernel (Engine/Xero/Llm/Audit) + your own repos (already registered in your module via `TypeOrmModule.forFeature`).
2. **Each module owns its own Tasks** (create + resolve) via the `Task` repo. Task idempotency: `dedupeKey = \`${type}:${refId}\``; before creating, check for an OPEN task with that key. Resolve = set state RESOLVED, resolvedAt, resolution.
3. **Task resolution lives in the OWNING module's endpoint**, not in Tasks. The Tasks inbox is READ-ONLY (list/get); each card calls the owning endpoint (below). When the owning action completes, it resolves its task.
4. **Each long-running job is a `@Cron` in its own module + a POST "run now" endpoint.** After running, update your `ConnectionState` row (upsert by `kind`). ConnectionsModule only READS all rows + Xero health.
5. **Shared invoice writes go through `XeroService.writeInvoice`** — never hand-roll a second write path.
6. Reference (idempotency) format for proposals: `reference = \`ROBYN-${meetingId or detectionId sliced}\`` — stable, unique, stored on `InvoiceProposal.reference`.

## CONVENTIONS

- Every controller method: `@ApiOperation`, `@ApiResponse` (or `@ApiOkResponse`), `@ApiTags`. Every DTO field: `@ApiProperty`/`@ApiPropertyOptional` + `class-validator` decorators. DTOs in `src/modules/<m>/dto/`.
- Global prefix is `api` (set in main.ts) — so declare controllers with plain paths (`@Controller('meetings')` → served at `/api/meetings`).
- Response DTOs must be explicit classes with `@ApiProperty` (so `openapi.json` is complete and `web` types are generated). Return plain objects shaped like the DTO.
- Money: numbers with 2dp. Dates: ISO strings in JSON. Numeric TypeORM columns come back as strings — coerce with `Number()` when computing.
- Never log secrets. Never edit `app.module.ts`, the kernel, or another module's files.

## MODULES & ENDPOINTS

### ClientsModule  (`@Controller` paths: clients, potential-clients)  tag: clients
Repos: Client, Contract, PotentialClient, Task. Uses Llm (parseContract), Xero (ensureContact), Audit.
- `GET /clients` → list clients with billingProfile, autonomyEnabled, unbilledExposureGbp, contract summary (rate/terms/source), invoice history count.
- `GET /clients/:id` → client detail + full parsed contract (clauses[]) + invoice history (from InvoiceProposal where clientId) + unbilled exposure.
- `PATCH /clients/:id/autonomy` body `{enabled:boolean}` → flip autonomyEnabled, Audit. (Powers the toggle.)
- `POST /clients/:id/contract` body `{title, rawText}` → parse via Llm.parseContract, store Contract.parsed + rawText, set client.billingProfile from parsed (source=CONTRACT, provenance=clause), Audit. Resolves any ATTACH_CONTRACT task for this client. (Also usable to (re)parse.)
- `GET /clients/:id/contract` → the Contract with parsed clauses (clause viewer).
- `GET /potential-clients` → the queue: displayName, emails, state, evidence quote (if any), lastPolledAt.
- `POST /potential-clients/:id/confirm` → promote: `Xero.ensureContact` → create Client (xeroContactId, name, emails), set PotentialClient.state=PROMOTED + promotedClientId, raise ATTACH_CONTRACT task for the new client, resolve the CONFIRM_AGREEMENT task, Audit. (This is the Loop-2 finish; Email module only detects.)
- `POST /potential-clients/:id/dismiss` → state=DISMISSED, resolve task, Audit.

### MeetingsModule  (paths: meetings)  tag: meetings   [Loop 1]
Repos: Meeting, Transcript, Client, Contract, PotentialClient, Task, InvoiceProposal, ConnectionState. Uses Engine, Llm, Xero, Audit.
- `GET /meetings` → all meetings with state, client (name), duration, attendees, hasTranscript, proposalId (if any). Supports `?state=`.
- `GET /meetings/:id` → detail + transcript.parsed + matchProposals + linked proposal + evidence chain.
- `POST /meetings/sync` (check-now) → calendar ingest (see Calendar below). Then for each new/updated meeting run the Loop-1 step. Returns counts. Updates CALENDAR ConnectionState.
- `POST /meetings/import-ics` (multipart or `{icsText}`) → parse .ics, upsert meetings, run Loop-1 step. Fallback path when Google OAuth absent.
- `POST /meetings/:id/transcript` body `{rawText, source?}` → save Transcript, `Llm.parseTranscript`, set meeting.transcriptId + state TRANSCRIPT_ATTACHED, resolve PROVIDE_TRANSCRIPT task, then run the Loop-1 continuation (classify → if MATCHED build proposal + policy → auto-send via Xero.writeInvoice OR raise REVIEW_INVOICE; if AMBIGUOUS raise CONFIRM_CLIENT_MATCH), Audit each transition. Returns the resulting meeting + proposal.
- `POST /meetings/:id/confirm-client` body `{clientId}` → set meeting.clientId, resolve CONFIRM_CLIENT_MATCH, run the proposal-building continuation, Audit.
- `POST /meetings/:id/skip` body `{reason}` → state SKIPPED, resolve any task, Audit.

**Loop-1 continuation algorithm (MeetingsService.runLoop1(meeting))** — deterministic, uses Engine:
1. Build `EngineClient[]` from all clients (emails, autonomyEnabled, hasContractOnFile = has a Contract row). Owner emails from a constant (`me@robyn.dev` + configurable).
2. `classify(attendees, clients, ownerEmails)`. Persist `matchProposals` from `Llm.proposeClientMatches` ONLY when kind is UNKNOWN/AMBIGUOUS (to help the human). Never let the LLM set clientId.
3. `step({isPersonal, hasTranscript, matchKind, policyAuto:null})` for the pre-proposal decision. If it says raiseTask/queuePotentialClient/skip → do that (create PotentialClient QUEUED for unknown attendees), Audit, done.
4. If matched + transcript: load client billingProfile + contract clause; map transcript.parsed.scope_items → engine ScopeItemInput; `buildProposal({block,billing,scopeItems,taxRatePct:20,accountCode})`. Persist an InvoiceProposal (state DRAFT, reference, lines, totals). Run `policy({autonomyEnabled, hasContractOnFile, matchKind:'MATCHED', amount:total, contractTermsMaxAmount, hasUnreviewedScope: built.hasTranscriptScope})`. Store policyResult.
5. `step({...,policyAuto: policyResult.auto})`. If autoSend → `Xero.writeInvoice({authorise:true, decisionNote: policy reasons + citations, evidence:[transcript excerpt, contract clause]})`; on success set proposal.state SENT, xeroInvoiceId, deepLink, autoSent=true, meeting.state SENT; Audit. On Xero failure: keep proposal IN_REVIEW, raise REVIEW_INVOICE, Audit the failure. If not auto → proposal.state IN_REVIEW, raise REVIEW_INVOICE task, meeting.state INVOICE_PROPOSED.
- `@Cron('0 */15 * * * *')` calendarSync → same as POST /meetings/sync (guard `isServing()`).

**Calendar ingest**: if `config.google.configured` → Google Calendar read-only (googleapis) [may be stubbed to .ics if OAuth not completable]; else use the seeded `.ics` fixture at `seed/data/calendar.ics` (read file, parse with `node-ical`). Either path yields the same Meeting upsert. Always set CALENDAR ConnectionState (LIVE if google, FALLBACK if ics).

### ProposalsModule  (paths: proposals)  tag: proposals
Repos: InvoiceProposal, Meeting, Detection, Client, Contract, Task, Transcript. Uses Xero, Audit.
- `GET /proposals` → list with client name, source (meeting/detection), total, currency, state, policyResult, xero link. `?state=`.
- `GET /proposals/:id` → full lines with provenance chips[], policyResult reasons[], source evidence (meeting/transcript/detection), xero status.
- `POST /proposals/:id/approve` → `Xero.writeInvoice({authorise:true, decisionNote, evidence})`; set state SENT, xeroInvoiceId, number, deepLink; resolve REVIEW_INVOICE; set meeting.state SENT if from a meeting; Audit. On Xero failure return 502-style body with the error and keep IN_REVIEW (do not crash).
- `POST /proposals/:id/save-draft` → `Xero.writeInvoice({authorise:false})` → creates a DRAFT in Xero, keep proposal IN_REVIEW but record xeroInvoiceId + deepLink.
- `POST /proposals/:id/reject` body `{reason}` → state REJECTED, resolve task, Audit.
- `PATCH /proposals/:id/lines` body `{lines}` → edit lines before approval, recompute totals, Audit.

Decision note text (writeInvoice.decisionNote): join policyResult.reasons + each line's provenance labels, e.g. "Robyn: 1.5h @ £150/h (Clause 3.1) from calendar block Tue 3 Jun; +2h extra scope from transcript ('…quote…'). Autonomy OFF → human approved."

### EmailModule  (paths: email)  tag: connections   [Loop 2 detect]
Repos: PotentialClient, Task, Client, ConnectionState. Uses Llm (classifyAgreement), Audit.
- `POST /email/poll` (check-now) → for each PotentialClient in QUEUED/WATCHING, fetch NEW messages FROM its addresses ONLY. If `config.imap.configured` → IMAP (imapflow) reading the mailbox filtered to those senders; else read the fixture at `seed/data/mailbox/*.json` (array of {from,subject,body,date,messageId}) filtered to queued senders. For each message: `Llm.classifyAgreement`; if agreement → set PotentialClient.state AGREEMENT_DETECTED + evidence{email_msg_id,quote,from,subject,received_at}, raise CONFIRM_AGREEMENT task (context: displayName + quote), Audit. Update lastPolledAt + EMAIL ConnectionState (LIVE if imap else FALLBACK, set nextPollAt = now+30m).
- `@Cron('0 */30 * * * *')` poll → same (guard isServing()).
- NEVER read messages from non-queued addresses. That scope widening is a bug.

### DetectionsModule  (paths: detections)  tag: detections   [Loop 3]
Repos: Detection, Client, InvoiceProposal, Task. Uses Xero (listQuotes, listPayments, listInvoices, agedReceivables), Engine (optional), Audit.
- `POST /detections/run` (check-now) → run the three detectors idempotently (dedupeKey), create Detection rows (OPEN), Audit. Detectors:
  - QUOTE_NOT_INVOICED: accepted Xero quote with no ACCREC invoice referencing it → value = quote total.
  - RETAINER_STOPPED: a client whose historical monthly payment cadence has a gap this month (from listPayments / invoice history) → value = expected retainer.
  - EXPENSE_NOT_RECHARGED: a seeded billable expense not on any invoice → value = expense amount.
  - If Xero not live, run against LOCAL seed data (the seed writes detate source rows locally too) so the loop demos; mark evidence.source accordingly.
- `GET /detections` → list with type, client, valueGbp, evidence, state.
- `POST /detections/:id/propose` → build an InvoiceProposal from the detection (single line, provenance LEDGER), state IN_REVIEW, raise REVIEW_INVOICE, Audit.
- `POST /detections/:id/dismiss` → state DISMISSED, Audit.

### TasksModule  (paths: tasks)  tag: tasks   [READ-ONLY]
Repos: Task (+ read others for context). 
- `GET /tasks` → OPEN tasks, newest first, each with: id, type, title, summary, refType, refId, context (jsonb — enough to render the card AND know the action endpoint), createdAt. Zero-state handled by the frontend.
- `GET /tasks/all` → include RESOLVED (for the audit-ish view). `?state=`.
- `GET /tasks/counts` → counts by type (inbox badges).
- Do NOT implement resolution here — cards call the owning module endpoints (see each module). Resolution flips the task in the owning service.

### ConnectionsModule  (paths: connections)  tag: connections
Repos: ConnectionState. Uses Xero (health, orgName), config.
- `GET /connections` → three rows (XERO, CALENDAR, EMAIL): status (LIVE/FALLBACK/DOWN), label, detail, lastSyncAt, nextPollAt. XERO computed live from `Xero.health()` (LIVE if ok, DOWN if not — detail carries the reason, e.g. "creds pending: not a Custom Connection"). CALENDAR/EMAIL read from their ConnectionState rows (upserted by their modules; default FALLBACK if calendar via ics / email via fixtures, DOWN if never run).
- `POST /connections/xero/recheck` → force `Xero.health()` refresh, upsert XERO row, return it. (The Connections "check now" for Xero.)
- The Calendar/Email "check now" buttons call `POST /meetings/sync` and `POST /email/poll` respectively (frontend wires this).

### DashboardModule  (paths: dashboard)  tag: dashboard
Repos: Meeting, Client, InvoiceProposal, Detection, Task, AuditEvent. 
- `GET /dashboard/calendar?from=&to=` → calendar-view feed: events with {id, title, start, end, state, colorKey (billed=teal, proposal=amber, awaiting=amber-outline, unknown=purple, skipped=gray), clientName, proposalId}. colorKey derived from meeting.state.
- `GET /dashboard/leak-strip` → {monthLabel, recoverableGbp, breakdown[{source, gbp, count}]} from OPEN detections + IN_REVIEW proposals + unbilled meetings. This is the "£2,880 was walking away" strip.
- `GET /dashboard/audit?limit=` → AuditEvent list for the audit trail screen.
- `GET /dashboard/summary` → headline stats (open tasks, unbilled £, invoices sent this month, clients).

## SEED  (`seed/` — owned by Claude, standalone tsx; imports `api/src/modules/xero/xero-api` for Xero, and a pg client for local)
Two phases. `seed/index.ts` runs both; prints a summary.
- `seedLocal()` (ALWAYS, no Xero needed): populate Postgres so the dashboard is demo-rich on first boot:
  - 3 Clients: "Fenwick Interiors" (autonomy OFF, hourly £150, contract on file), "Halcyon Retail Ltd" (autonomy ON, monthly retainer £1,200, contract on file — the auto-send + lapsed-retainer client), "Marsh & Co" (autonomy OFF, day rate £900). Give each realistic emails/domains.
  - 2 Contracts (Fenwick, Halcyon) with rawText (a believable clause 3 rate) + parsed billingProfile.
  - ~6 months of past InvoiceProposal rows (state SENT, autoSent where retainer) per client = invoice history + billed calendar blocks.
  - June calendar meetings (also written to `seed/data/calendar.ics`): (a) a billable Fenwick meeting WITH no transcript → will raise PROVIDE_TRANSCRIPT (the demo beat 2 opener); (b) an unknown-attendee meeting (a prospect on gmail) → PotentialClient QUEUED (beat 3); (c) a couple already-billed meetings; (d) Halcyon retainer context.
  - 1 PotentialClient QUEUED ("Priya Nair", gmail) tied to the unknown meeting; a fixture email at `seed/data/mailbox/priya-agreement.json` containing "let's go ahead" (beat 3 — pre-received so the live poll finds it).
  - Seed the three ConnectionState rows (XERO recompute at runtime; CALENDAR=FALLBACK ics; EMAIL=FALLBACK fixture).
  - One in-review InvoiceProposal (a prior meeting already proposed) so the Tasks inbox cold-opens with 3 tasks (PROVIDE_TRANSCRIPT, CONFIRM_AGREEMENT after first poll, REVIEW_INVOICE). Raise the corresponding Task rows.
  - Loop-3 seed rows so detectors have something local: 1 accepted-quote-not-invoiced (£X), 1 lapsed retainer (Halcyon gap), 1 unrecharged expense.
- `seedXero()` (ONLY if `Xero.health()` ok): create the 3 Contacts in Xero, ~6 months of historical AUTHORISED ACCREC invoices, 1 ACCEPTED quote (unlinked), payment history establishing Halcyon's monthly cadence with a gap, then backfill `client.xeroContactId` + past-proposal `xeroInvoiceId`. Idempotent (check-by-reference / ensureContact). If Xero not live, print exactly what will run once creds land.
- `seed/reset.ts` → truncate local tables (never touches Xero).

## FRONTEND  (`web/` — Next.js App Router, TS, Tailwind + shadcn/ui)  — see FRONTEND_SPEC section in the frontend agent's brief.
Talks to `http://localhost:4000/api/*`. Types generated from `api/openapi.json` into `web/lib/api-types.ts` (never hand-edited). Five surfaces: Tasks inbox (home), Calendar view, Clients, Invoices, Connections + a persistent leak strip. impeccable + ui-ux-pro-max skills mandatory; frontend-design prohibited. Every control: cursor-pointer, hover, disabled-in-flight. Every view: loading/empty/error states.

## FALLBACKS (missing-credential protocol)
- Xero creds pending → all Xero paths coded to the Custom Connection contract; writes catch + surface, dashboard stays rich from local seed. Flip to live the moment `verify:xero` passes.
- IMAP empty → fixture mailbox `seed/data/mailbox/*.json` behind the same poll interface; EMAIL ConnectionState = FALLBACK.
- Google OAuth empty → `.ics` upload / `seed/data/calendar.ics`; CALENDAR ConnectionState = FALLBACK.
