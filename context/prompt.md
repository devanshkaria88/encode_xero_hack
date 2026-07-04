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
- `xero-prompt-library/php/accounts-payable-symfony.txt` — the closest bootstrap prompt to our domain; mine it for AP entity/endpoint hints.
- `xero-mcp-server/src/handlers/` — the definitive list of what MCP can and cannot do.

## Step 2 — write these skills into `.claude/skills/`

Each skill: a directory with `SKILL.md`, frontmatter `name` + `description` (description states WHEN to trigger), runnable snippets in our stack (NestJS/TypeScript, xero-node SDK or plain fetch — pick one and be consistent), and a "traps" section. Terse and factual, no filler. If you cannot verify a fact from the cloned repos or official docs, mark it `UNVERIFIED — check before relying`.

### `xero-auth`
Custom Connections (client_credentials): token endpoint, scopes we need (`accounting.transactions`, `accounting.contacts`, `accounting.attachments`, `accounting.reports.read`), token caching + refresh-on-401, the fact that custom connections are single-org so no `xero-tenant-id` juggling, and the pre-flight env assertions pattern (empty `client_id` surfaces as `unauthorized_client` — fail fast with a clear message, exactly like the official Lovable skill does). Include a `verify-auth.ts` snippet that lists 1 invoice and prints the org name — this is Gate G0.

### `xero-accounting-api`
The endpoints this project touches, with request/response shapes trimmed to fields we use:
- Invoices type ACCPAY (bills): list with where/order/page, create, update status DRAFT→SUBMITTED→AUTHORISED, line items, `LineAmountTypes`.
- **Purchase Orders: NOT in the MCP server — raw API only.** Full CRUD shapes, status flow, marking billed.
- Attachments: upload onto an invoice (raw bytes PUT, content-type, filename rules, 25MB cap), list, the online-invoice visibility flag.
- History/Notes: append the agent's decision note to any document.
- Contacts: list + fuzzy-relevant fields (Name, EmailAddress).
- Reports: aged payables by contact.
Pagination (100/page), `If-Modified-Since`, `where` filter syntax and its quoting traps, validation error envelope shape (`Elements[].ValidationErrors`), and rate limits (60/min, 5,000/day per tenant; 429 handling with `Retry-After`).

### `xero-payments`
Creating a Payment against an AUTHORISED ACCPAY invoice: required fields (Invoice, Account with `EnablePaymentsToAccount` or bank account code, Date, Amount), partial vs full, common rejection causes (unauthorised invoice, wrong account class, currency mismatch). This is the judged "Payments API" moment — the snippet must work first try.

### `xero-mcp-usage`
When to use the MCP server vs raw API in THIS project (table from `architecture.md`), how to run the MCP server locally against our custom connection env vars, and the tool-name → handler mapping for the ~10 tools we actually use. Note explicitly: no PO tools, no attachment tools — those route to `xero-accounting-api`.

### `xero-demo-seed`
Seeding the demo org so the data tells a story: ~15 realistic UK suppliers, bills mostly matchable, 2 deliberate gaps (one missing receipt, one amount mismatch), matching POs raised in Xero, the Google Sheet receipt log schema (columns: date, po_ref, supplier, items, qty, signed_by, photo_link), and idempotency (seed script safe to re-run: check-by-reference before create).

## Step 3 — prove it

Run the `verify-auth.ts` snippet against the real demo org. Then delete nothing, commit `.claude/skills/` and append what you did to `context/last_update.md` per the collaboration protocol.

Hard rules while doing all of this: no business logic in skills (skills are facts + snippets, decisions live in `api/src/modules/`), no UNVERIFIED fact used in Gate-critical paths, and every snippet compiles under our tsconfig.
