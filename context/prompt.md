# PROMPT — build Robyn end to end, unattended

Paste everything below into the remote agent. It runs without Devansh available: no questions, no pauses, decisions get made and logged.

---

/goal Full end-to-end Robyn: every gate in `context/architecture.md` met, every surface tested through Chrome DevTools MCP, pushed to origin. Do not stop before that. Do not wait for a human at any point.

## Ground rules

1. Read `context/context.md`, `context/architecture.md`, and `CLAUDE.md` first. They are law. The Xero skills already exist in `.claude/skills/` (G0 committed) — use them, don't regenerate them.
2. You are unattended. When something is ambiguous, make the smallest reasonable decision, record it under `## Decisions` in `context/last_update.md`, and keep moving. Never leave a TODO where a decision would do.
3. Missing credential protocol: **`api/.env` already exists in the working copy with real credentials — it is untracked, irreplaceable, and read-only to you.** Never overwrite, regenerate, move, or delete it; never print its values to logs, commits, or summaries. Work in THIS working copy (no fresh clones — a clone loses the file). When scaffolding NestJS into `api/`, scaffold around the existing files and wire config to load `api/.env` as-is. If you introduce a new env var, add it to `api/.env.example` (tracked) with an empty value and list it in `HANDOFF.md`. If a value is absent from `api/.env` (Google OAuth, IMAP), build the integration anyway, verify it through its fallback path (.ics upload for calendar, a local fixture mailbox behind the same IMAP interface for email), and add a line to `HANDOFF.md` telling Devansh exactly what to paste where. Xero creds should already be present (G0 verified auth) — if they work, every Xero path must be verified live, no exceptions.
4. Commit at every working state, message prefixed with the gate it serves. `git push origin main` at every gate boundary, not just at the end — a travelling founder must be able to pull a working repo at any moment.
5. Follow the gate order G1 → G5 from `architecture.md`. The invariant from CLAUDE.md holds everywhere: every agent behaviour is a state transition that writes to Xero or raises a Task; the LLM parses and proposes, never decides, never sends.

## Build

Everything in `architecture.md`: the three loops, the domain model, the five dashboard surfaces (Tasks inbox, Calendar view, Clients, Invoices, Connections), the autonomy policy, the OpenAPI contract regime, seed scripts. Local runtime: Postgres via docker compose, `api` on :4000, `web` on :3000, one `make dev` (or `pnpm dev` at root) that brings the whole thing up. Seed data per G0 spec so the app is demo-rich on first boot.

## Test — Chrome DevTools MCP, and only trust what you clicked

After G3 and again after G5, run the full QA pass with the Chrome DevTools MCP against the running app. Fix and re-run until the checklist is green — a failed check is a build task, not a note.

**Interaction sweep (every surface):**
- Every clickable element: `cursor-pointer`, visible hover state, disabled state while its action is in flight. Click every button, tab, card, toggle, and command-bar action. A rendered control that does nothing is a P0 bug.
- Resolve one task of each of the five types end to end from the Tasks inbox.
- Calendar view: navigate weeks/months, click events in every state, confirm the side panel shows the correct evidence chain per state.
- Clients: open every client, view a parsed contract clause, flip the autonomy toggle both ways, check the potential-clients rail.
- Invoices: open a proposal, verify every line shows its provenance chip, follow the Xero deep link.
- Connections: statuses render truthfully (live vs fallback), "check now" triggers the poll and the UI reflects it.

**Health sweep (every route):**
- Zero console errors and zero failed network requests on every route, verified via DevTools console and network panels.
- Loading, empty, and error states actually render: throttle the network in DevTools and reload each surface; kill the API and confirm error states appear instead of blank screens.
- Layout at 1440 and 1280 widths (stage laptop): no overflow, no clipped controls. Focus states visible on keyboard tab-through.

**Demo rehearsal (the real acceptance test):**
Script the four demo beats from `context.md` as an end-to-end run against live services (or documented fallbacks): tasks inbox cold open → transcript task through to invoice in Xero → potential-client promotion via the agreement email → auto-send retainer + leak strip. Save a screenshot per beat to `docs/qa/`, plus one of the resulting invoice inside Xero. If any beat cannot complete, the build is not done.

## Finish line

Done means, in order: G1–G5 checked off, both QA sweeps green with screenshots in `docs/qa/`, `HANDOFF.md` written (how to run, what credentials Devansh must add, the demo runbook step by step, known rough edges), `context/last_update.md` updated with the decision log, everything committed, `git push origin main`, and a final tag `v0-robyn-e2e`. Print a closing summary of what was built, what was verified live vs via fallback, and the three things Devansh should check first when he lands.
