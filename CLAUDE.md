# Cross-agent collaboration

This project is being worked on collaboratively by **Claude Code** and **Cursor**. The two agents stay in sync via `context/last_update.md`, which is updated automatically by hooks after each turn.

**Before responding, check `context/last_update.md`** — if it contains `agent: cursor`, that's a turn the other agent did. Read it and reconcile before answering. If `agent: claude`, that was your own previous turn.

Recent git history (`git log --oneline -10`) also tells you what each agent committed.

---

# Build rules (strict — violations get reverted)

Read `context/context.md` and `context/architecture.md` before writing any code. The judging rubric in context.md drives every tradeoff: 50% real problem + Xero depth, 30% Accounting/Payments API usage, 20% production-ready architecture.

## Ownership

- Claude Code owns `api/` (NestJS), `seed/`, `.claude/skills/`.
- Cursor owns `web/` (Next.js).
- Neither agent edits the other's tree. The OpenAPI contract is the only interface.

## API contract (non-negotiable)

- Every NestJS endpoint is decorated (`@ApiOperation`, `@ApiResponse`, DTOs with `@ApiProperty`). Swagger served at `/api/docs`, spec exported to `api/openapi.json` and committed.
- Frontend types are generated: `openapi-typescript api/openapi.json -o web/lib/api-types.ts`. That file is never hand-edited and is the ONLY source of request/response types in `web/`.
- Any endpoint change ships in the same commit as the regenerated spec + types. A frontend fetch with a hand-written type is a bug even if it works.
- All DTOs validated with `class-validator` on the way in, zod on every LLM output. Nothing unvalidated crosses a boundary.

## Backend rules

- The match engine is pure TypeScript, deterministic, unit-tested, and contains zero LLM calls. Claude parses documents into strict JSON at the edges; the engine decides. If you find yourself putting a model call inside a decision, stop and restructure.
- Every verdict, approval, exception, and Xero write creates an `AuditEvent` row. No silent mutations.
- All Xero access goes through `api/src/modules/xero/`. Rate-limit aware (60/min): batch reads, cache in Postgres, never poll in a loop. Every write idempotent (check-by-reference before create).
- Purchase Orders and Attachments use the raw Accounting API (not in MCP) — see `.claude/skills/xero-accounting-api`.
- Secrets in `.env` only, asserted non-empty at boot with named errors. Never committed, never logged.

## Frontend rules

- `impeccable` and `ui-ux-pro-max` skills are mandatory for all UI work. The `frontend-design` skill is prohibited.
- Every clickable element: `cursor-pointer`, visible hover state, disabled state when action is in flight. No dead buttons anywhere on a demo path — if it renders, it works.
- Every data view has loading, empty, and error states. The demo must survive a slow network without looking broken (optimistic/streaming where the agent is "thinking").
- UI copy is plain human English. No em-dashes, no "X wasn't Y, it was Z" constructions, no marketing slop. A plumber must understand every label.
- Evidence drill-down (the case file view) and the audit trail are first-class screens, not afterthoughts — they carry the 20% architecture score on stage.

## Process rules

- Demoable at every commit. Never leave the repo broken at the top of any hour.
- Highest technical risk first: match engine correctness before ingest, ingest before dashboard polish, WhatsApp absolutely last (Twilio sandbox, numbered-reply fallback).
- Follow the gates in `architecture.md`. Behind at a gate = cut scope from the bottom of the list, never extend the gate.
- Live data only in demo paths. No fixtures, no mocked responses wired into the UI. Seeded Xero org + real mailbox + real sheet count as live.
- Commit messages state which gate they serve. Append meaningful changes to `context/last_update.md` per the collaboration protocol.
