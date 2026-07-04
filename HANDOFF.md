# Robyn — HANDOFF

Robyn turns a freelancer's calendar, contracts and transcripts into invoices in Xero.
Backend (NestJS, `api/`) + frontend (Next.js, `web/`) + demo seed (`seed/`).

---

## 🔴 DO THIS FIRST — fix the Xero credentials (blocks the money moment)

The `api/.env` credentials are **a standard OAuth2 app, not a Custom Connection**. Verified live: via `client_credentials` every accounting scope is filtered out ("no valid scopes remaining after filtering for grant type"), `GET /connections` 400s with no tenant, and `/Invoices` 403s. There is **no unattended workaround** — the app type is fixed at creation and only you can fix it in the portal.

**Fix (~5 minutes, one-time):**
1. Go to <https://developer.xero.com/> → **My Apps** → **New app** → choose **Custom Connection** (you cannot convert the existing standard app — it must be a fresh Custom Connection app).
2. Name it (e.g. "Robyn"). For the authorising user, use yourself.
3. **Scopes** — select the accounting scopes. Either the broad set (`accounting.transactions`, `accounting.contacts`, `accounting.attachments`, `accounting.settings`, `accounting.reports.read`) or, if the picker only offers granular scopes, select: `accounting.invoices`, `accounting.contacts`, `accounting.attachments`, `accounting.settings.read`, `accounting.payments`, `accounting.reports.read`. (Robyn's token module tries broad first, then falls back to granular automatically.)
4. Save. You'll get an email / an in-portal **Connect** button — click it and **connect the app to your Xero *Demo Company*** (Custom Connections are **free** against the Demo Company). Pick exactly one org.
5. Copy the app's **Client ID** and **Client Secret**.
6. Paste them into `api/.env` (replace the existing `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET`). Do not commit this file — it is gitignored and irreplaceable.
7. Verify: `cd api && npx tsx src/modules/xero/verify.ts` — expect `G0 PASS` with your org name and an invoice count.

Once `G0 PASS`, every Xero path in Robyn goes live automatically (contact create, ACCREC invoice draft/authorise, History note, Attachment, Payments read). Then run the Xero seed: `pnpm --filter robyn-api seed`.

If the picker won't grant a scope the fallback expects, set `XERO_SCOPES=` in `api/.env` to the *exact* space-separated scopes the app was granted, and re-run verify.

---

## Run it

```bash
# from repo root
make db          # or: docker compose up -d db   (Postgres on :5432)
pnpm install
pnpm --filter robyn-api seed     # populates the demo (local always; Xero when creds are live)
pnpm dev         # api on :4000 (docs /api/docs), web on :3000
```

- API alone: `pnpm dev:api`  ·  Web alone: `pnpm dev:web`
- Regenerate the API contract after a backend change: `pnpm openapi` (writes `api/openapi.json` + `web/lib/api-types.ts`).

## Credentials you must add to `api/.env`

| Var | Needed for | Without it |
|---|---|---|
| `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` | live Xero (see above) | dashboard still demos from local seed; writes surface a clear error until fixed |
| `ANTHROPIC_API_KEY` | transcript/contract/email parsing | present ✓ |
| `IMAP_HOST/PORT/USER/PASSWORD` | live email poll | **empty → fixture mailbox fallback** (`seed/data/mailbox/`); Loop 2 still demos |
| `GOOGLE_CLIENT_ID/SECRET` | live Google Calendar | **empty → `.ics` fallback** (`seed/data/calendar.ics`); Loop 1 still demos |
| `XERO_PAYMENT_ACCOUNT_CODE` | recording a Payment write | optional; Payments are read-only in the core demo |

## Fallbacks (missing-credential protocol)
- **Email**: IMAP creds empty → the poll reads a fixture mailbox behind the same interface, filtered to queued prospect addresses only. Connections panel shows EMAIL as FALLBACK truthfully.
- **Calendar**: Google creds empty → `.ics` upload / seeded `.ics`, identical pipeline. Connections shows CALENDAR as FALLBACK.
- To go live: paste the creds, restart the API, hit "check now" on the Connections panel.

## Demo runbook — _to be finalised after QA_

## Known rough edges — _to be finalised after QA_
