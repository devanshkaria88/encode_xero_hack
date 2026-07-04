# PROMPT — generate the Xero skills for this project

Paste everything below this line into Claude Code as the first task of the build.

---

Read `context/context.md` and `context/architecture.md` first. Then build project-local skills that encode everything this project needs to know about talking to Xero, so that neither you nor Cursor ever has to rediscover Xero facts mid-build.

## Step 1 — pull the source material

Clone shallow into `.tmp/xero-refs/` (gitignored):

- https://github.com/XeroAPI/xero-mcp-server
- https://github.com/XeroAPI/xero-agent-toolkit
- https://github.com/XeroAPI/xero-prompt-library
- https://github.com/XeroAPI/xero-command-line

Study before writing anything:
- `xero-prompt-library/*/SKILL.md` — Xero's own skill-writing style, especially the Lovable ones. Their auth guidance is Lovable/Supabase-flavoured; DO NOT copy the runtime specifics, DO copy their discipline: pre-flight checks first, exact error → real cause tables, scope minimalism, token handling rules.
- `xero-mcp-server/src/handlers/` — the definitive list of what MCP can and cannot do.

## Step 2 — write these skills into `.claude/skills/`

Each skill: a directory with `SKILL.md`, frontmatter `name` + `description` (description states WHEN to trigger), runnable snippets in our stack (NestJS/TypeScript, xero-node SDK or plain fetch — pick one and be consistent), and a "traps" section. Terse and factual, no filler. If you cannot verify a fact from the cloned repos or official docs, mark it `UNVERIFIED — check before relying`.

### `xero-auth`
Custom Connections (client_credentials): token endpoint, scopes we need (`accounting.transactions`, `accounting.contacts`, `accounting.attachments`, `accounting.reports.read`), token caching + refresh-on-401, the fact that custom connections are single-org so no `xero-tenant-id` juggling, and the pre-flight env assertions pattern (empty `client_id` surfaces as `unauthorized_client` — fail fast with a clear message, exactly like the official Lovable skill does). Include a `verify-auth.ts` snippet that lists 1 invoice and prints the org name — this is Gate G0.

### `xero-accounting-api`
The endpoints this project touches, with request/response shapes trimmed to fields we use:
- Invoices type ACCREC (sales): list with where/order/page, line items and their descriptions/dates (billing-profile inference and coverage checks read these), create DRAFT invoices with provenance in line descriptions.
- Quotes: list, statuses (SENT/ACCEPTED/INVOICED), the link (or absence of one) between an accepted quote and a subsequent invoice.
- Payments: list per contact, dates and amounts (retainer-cadence detection feeds on this).
- Billable expenses / expense claims assigned to customers, and how to tell whether they ever appeared on an ACCREC invoice.
- Attachments: upload onto an invoice (raw bytes PUT, content-type, filename rules, 25MB cap) — transcript-excerpt evidence lands here.
- History/Notes: append the agent's decision note to any document.
- Contacts: list + matching-relevant fields (Name, EmailAddress), create.
- Reports: aged receivables by contact.
Pagination (100/page), `If-Modified-Since`, `where` filter syntax and its quoting traps, validation error envelope shape (`Elements[].ValidationErrors`), and rate limits (60/min, 5,000/day per tenant; 429 handling with `Retry-After`).

### `xero-payments`
Reading Payments effectively (per-contact history, dates, amounts, linkage to invoices) for cadence detection, and creating a Payment against an AUTHORISED ACCREC invoice for the paid-tracking stretch: required fields (Invoice, Account with `EnablePaymentsToAccount` or bank account code, Date, Amount), common rejection causes. Payments data is named in the Track 3 brief — the read path is the judged moment here.

### `xero-mcp-usage`
When to use the MCP server vs raw API in THIS project (table from `architecture.md`), how to run the MCP server locally against our custom connection env vars, and the tool-name → handler mapping for the ~10 tools we actually use. Note explicitly: no PO tools, no attachment tools — those route to `xero-accounting-api`.

### `xero-demo-seed`
Seeding the demo org so the data tells a story: 3 realistic consulting clients, 6 months of time-billed ACCREC invoices (line items like "Consulting — 6 hrs @ £150" so billing-profile inference has real material), 1 accepted quote never invoiced, 1 retainer client whose monthly invoices stop 2 months ago, 1 billable expense assigned to a client but never recharged. Idempotent (check-by-reference before create). Companion doc: the June Google Calendar events to create by hand (23 client meetings, 6 deliberately uncovered), with exact titles/attendees that exercise the matcher.

## Step 3 — prove it

Run the `verify-auth.ts` snippet against the real demo org. Then delete nothing, commit `.claude/skills/` and append what you did to `context/last_update.md` per the collaboration protocol.

Hard rules while doing all of this: no business logic in skills (skills are facts + snippets, decisions live in `api/src/modules/`), no UNVERIFIED fact used in Gate-critical paths, and every snippet compiles under our tsconfig.
