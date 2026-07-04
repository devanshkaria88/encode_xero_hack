# ROBYN — ARCHITECTURE (v3)

`context.md` is the why and the three rules. This file is the build truth.

## Stack (locked)

- **Frontend:** Next.js (App Router), TS, Tailwind + shadcn/ui. Cursor owns. `impeccable` + `ui-ux-pro-max` mandatory; `frontend-design` prohibited. Command bar (⌘K).
- **Backend:** NestJS + Postgres + TypeORM. Claude Code owns. All Xero/calendar/email/LLM access lives here. One internal scheduler (NestJS @Cron) drives the 30-min email poll and calendar sync; every job also exposed as a POST /internal/run/:job for the demo's "check now".
- **LLM (Claude API), edges only:** transcript parsing (scope items + action points with verbatim evidence quotes), contract parsing (rate/terms/clauses with citations), email agreement-detection (classify ONLY messages from queued addresses; strict JSON {agreement: bool, evidence_quote}), fuzzy client-match PROPOSALS. Zod on every output. The LLM never decides billed/unbilled, never sends anything.
- **Calendar:** Google Calendar read-only OAuth (owner's account); .ics upload fallback, identical pipeline.
- **Email:** IMAP poll of the demo mailbox (app password). Reads only FROM addresses in the potential-client queue. No Gmail API, no Make.
- **Xero:** Custom Connection. MCP tools where they exist; raw Accounting API for History/Notes + Attachments. Payments read for retainer cadence.

## Dashboard surfaces (all first-class, Cursor builds in this order)

1. **Tasks inbox** — the home screen. Every open Task as a resolvable card (paste transcript, confirm match, review invoice with line-by-line provenance, confirm agreement, attach contract). Zero-state when Robyn has nothing for you: "All caught up — Robyn's watching."
2. **Calendar view** — a real week/month calendar (not a list). Every event colour-coded by state: billed (teal), proposal in review (amber), awaiting transcript (amber outline), unknown attendee (purple), skipped/personal (gray). Click any event → side panel with its full evidence chain and available actions. This view IS the pitch's mental model — "your calendar, but every block knows whether it's been paid for" — so it must be gorgeous.
3. **Clients** — card per client: contract on file (with parsed rate/terms + clause viewer), billing profile provenance, autonomy toggle, invoice history, unbilled exposure. Potential-clients queue lives here as a separate rail with watch status and the agreement-evidence quote when found.
4. **Invoices** — proposals in review / sent / paid, each line showing its provenance chip (contract clause, transcript quote, calendar block). Deep-link to the invoice in Xero.
5. **Connections** — settings panel: Google Calendar (OAuth status, last sync, .ics fallback upload), email (IMAP status, last poll, next poll countdown, "check now"), Xero (org name, connection health). Integration health is visible product surface, not buried config — judges read this as production-readiness.

## Domain model

```
Client           xero_contact_id, name, emails[], autonomy_enabled (default false),
                 billing_profile {rate, cadence, terms, source: CONTRACT|INFERRED,
                 provenance}
Contract         client_id, file_ref, parsed {rate, currency, payment_terms,
                 scope_summary, clauses[]{ref,text}} — every value keeps its citation
PotentialClient  emails[], display_name, first_seen_meeting_id,
                 state: QUEUED → WATCHING → AGREEMENT_DETECTED → PROMOTED | DISMISSED
                 evidence {email_msg_id, quote}
Meeting          gcal_event_id, start/end, duration, attendees[], client_id?,
                 state: DETECTED → AWAITING_TRANSCRIPT → TRANSCRIPT_ATTACHED
                        → CLIENT_MATCHED | UNKNOWN_ATTENDEE
                        → INVOICE_PROPOSED → SENT | SKIPPED
                 transcript_id?, skip_reason?
Transcript       raw_text, source, parsed {action_points[], scope_items[]
                 {description, est_hours, evidence_quote}}
InvoiceProposal  meeting_id | detection_id, client_id, lines[] {desc, qty, rate,
                 provenance (contract clause / transcript quote / calendar block)},
                 policy_result {auto: bool, reasons[]}, xero_invoice_id?
Detection        type: QUOTE_NOT_INVOICED | RETAINER_STOPPED | EXPENSE_NOT_RECHARGED
                 value_gbp, evidence jsonb, state, xero_invoice_id?
Task             type: PROVIDE_TRANSCRIPT | CONFIRM_CLIENT_MATCH | REVIEW_INVOICE
                       | CONFIRM_AGREEMENT | ATTACH_CONTRACT
                 ref (meeting/proposal/potential_client), state: OPEN → RESOLVED,
                 resolution, resolvable inline on the dashboard
AuditEvent       every state change, Xero write, policy decision, poll result:
                 actor, inputs, timestamp
```

Rule of the codebase: every agent behaviour is a state transition that either writes to Xero or raises a Task. No third option, no silent paths.

## Robyn's loops (deterministic core; LLM at the edges only)

**Loop 1 — calendar (rule 1):** sync events → for each work block: transcript attached? no → Task PROVIDE_TRANSCRIPT. yes → match attendees to Clients (exact email/domain; LLM fuzzy proposals go to Task CONFIRM_CLIENT_MATCH). Matched → build InvoiceProposal: duration × contract rate (clause cited) + transcript scope items (quotes attached) → policy → autonomy ON + within terms → send; else Task REVIEW_INVOICE.
**Loop 2 — pipeline (rule 2):** unknown attendee → PotentialClient QUEUED → 30-min IMAP poll of queued addresses only → LLM classifies each new message → agreement detected → Task CONFIRM_AGREEMENT (evidence quote shown) → confirm → create Xero contact, prompt ATTACH_CONTRACT, state PROMOTED → loop 1 owns them now.
**Loop 3 — ledger detectors:** accepted quotes never invoiced, retainer cadence broken (Payments data), billable expenses never recharged → Detections → same proposal/policy/task funnel.
**Policy (code, never LLM):** AUTO_SEND iff client.autonomy_enabled AND contract on file AND exact match AND amount within contract terms AND no un-reviewed transcript scope. Reasons logged and rendered on the card.

## Xero API usage map (the 30% story)

| Call | Via | Purpose |
|---|---|---|
| list/create contacts | MCP | matching, rule-2 promotion |
| list ACCREC invoices + lines | MCP | coverage checks, profile inference |
| create invoice (draft or authorised+send per policy) | MCP | the money moment |
| list quotes / payments | MCP | loop-3 detectors (Payments named in track brief) |
| aged receivables by contact | MCP | leak strip |
| History/Notes | raw API | Robyn's decision note on every invoice |
| Attachments | raw API | transcript excerpt + contract evidence on the invoice |

Rate limits 60/min: sync to Postgres, reconcile locally, write on decision only.

## API contract

Unchanged: NestJS decorators → `api/openapi.json` committed → `openapi-typescript` → `web/lib/api-types.ts`; generated types are the only frontend types; same-commit regeneration.

## Build order (gates)

| Gate | Done means |
|---|---|
| G0 | Xero auth verified. Skills generated (`prompt.md`). Seed: 3 clients (one autonomy ON), 6 months time-billed ACCREC invoices, 1 unlinked accepted quote, 1 lapsed retainer, 1 unrecharged expense, 2 contract PDFs. June calendar seeded (incl. 1 no-transcript meeting, 1 unknown-attendee meeting). Demo mailbox with the "let's go ahead" email ready to send live. |
| G1 | Loop 1 state machine green on seed: transcript gate, matching, proposal maths with citations. Unit-tested. **This is the project.** |
| G2 | Xero writes: contact create, invoice create (draft + authorised/send), history note, attachment. Verified in Xero UI. |
| G3 | Dashboard: Tasks inbox (all five task types resolvable inline), the calendar view with state colours + evidence side panel, Clients (incl. potential-client rail + autonomy toggle), Invoices with provenance chips, Connections panel with live integration health, leak strip. |
| G4 | Loop 2 end to end: queue → IMAP poll (cron + check-now) → agreement classification → confirm → contact + contract in Xero. |
| G5 | Loop 3 detectors + autonomy toggle + calendar OAuth live path with .ics fallback. Polish under skill rules. |
| G6 | 3 full rehearsals, pitch ×2 aloud, hotspot ready. |

Behind: cut bottom-up (loop-3 detectors → autonomy beat narrated → loop 2 shrinks to pre-received email). Untouchable: loop 1, Tasks inbox, invoice write with citations.

## Live-demo rules

Live data only: real calendar, transcript pasted live, the agreement email sent live from a phone, real Xero org. Every beat has a live fallback (.ics, check-now button, pre-received email in the mailbox). Demoable at every commit.

## Two-agent protocol

CC owns `api/` + `seed/` + skills; Cursor owns `web/`; sync via `context/last_update.md`; OpenAPI is the only interface.
