# Robyn — HANDOFF

Robyn turns a freelancer's calendar, contracts and transcripts into invoices in Xero.
Backend (NestJS, `api/`) + frontend (Next.js, `web/`) + demo seed (`seed/`).

---

## ✅ Xero is LIVE (creds fixed)

The Xero Custom Connection is connected to **Demo Company (UK)** and the whole money moment is verified live: approving a proposal wrote **INV-0068** (ACCREC, AUTHORISED, £450, Net 14) with Robyn's decision note in History and two evidence attachments (contract clause + transcript excerpt). The Connections panel shows XERO as LIVE. `pnpm --filter robyn-api verify:xero` prints `G0 PASS`.

If you ever need to re-point Xero at a different org, the original setup steps are below.

<details><summary>How the Custom Connection was set up (for reference / re-doing)</summary>

The first creds were a standard OAuth2 app (client_credentials filtered out every accounting scope, `/connections` 400'd). The fix was a **fresh Custom Connection**:
1. Go to <https://developer.xero.com/> → **My Apps** → **New app** → choose **Custom Connection** (you cannot convert the existing standard app — it must be a fresh Custom Connection app).
2. Name it (e.g. "Robyn"). For the authorising user, use yourself.
3. **Scopes** — select the accounting scopes. Either the broad set (`accounting.transactions`, `accounting.contacts`, `accounting.attachments`, `accounting.settings`, `accounting.reports.read`) or, if the picker only offers granular scopes, select: `accounting.invoices`, `accounting.contacts`, `accounting.attachments`, `accounting.settings.read`, `accounting.payments`, `accounting.reports.read`. (Robyn's token module tries broad first, then falls back to granular automatically.)
4. Save. You'll get an email / an in-portal **Connect** button — click it and **connect the app to your Xero *Demo Company*** (Custom Connections are **free** against the Demo Company). Pick exactly one org.
5. Copy the app's **Client ID** and **Client Secret**.
6. Paste them into `api/.env` (replace the existing `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET`). Do not commit this file — it is gitignored and irreplaceable.
7. Verify: `cd api && npx tsx src/modules/xero/verify.ts` — expect `G0 PASS` with your org name and an invoice count.

Once `G0 PASS`, every Xero path in Robyn goes live automatically (contact create, ACCREC invoice draft/authorise, History note, Attachment, Payments read). Then run the Xero seed: `pnpm --filter robyn-api seed`.

If the picker won't grant a scope the fallback expects, set `XERO_SCOPES=` in `api/.env` to the *exact* space-separated scopes the app was granted, and re-run verify. (This app is granular-only; the token module requests broad, then the granular set, then an empty scope which grants exactly what the app has.)

</details>

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

## Demo runbook (3 minutes, verified end to end)

Start clean: `pnpm --filter robyn-api seed` then `pnpm dev`, open <http://localhost:3000>. The cold open shows **3 tasks** and the leak strip **"£2,880 recoverable in June 2026"**.

1. **Cold open on the Tasks inbox (20s).** Three cards waiting: a meeting missing its transcript, an agreement email to confirm, an invoice in review. "This is my back office now." Point at the leak strip.
2. **Rule 1 live — transcript to invoice (70s).** On the *Provide transcript* card (Fenwick kitchen fit-out review), paste a Granola transcript that includes an extra ask (e.g. "can you also spec the utility room, that is new work"). Robyn matches the client, pulls the contract, and builds the proposal: **1.5h calendar block @ £150 cited to Clause 3.1 + the utility room 3h caught from the transcript with the verbatim quote = £810 inc. VAT**. Open *Show evidence*, then **Approve & send to Xero** → the invoice is created live in Xero (AUTHORISED) with Robyn's decision note in History and the transcript + contract-clause attachments. Follow the Xero deep link to show it in the org.
3. **Rule 2 live — email to client (50s).** The *Confirm agreement* card shows Priya Nair's verbatim "Let's go ahead." **Confirm and create client** → Robyn creates the Xero contact and onboards Priya, then asks for her contract. New client from a calendar event and an email, zero forms.
4. **Auto-send + close (40s).** Open **Clients** → Halcyon Retail has autonomy **ON**: its monthly retainer invoice goes out on its own within contract terms (the 5 auto-sent history invoices are on the card, live in the org). Leak strip: "June: £2,880 was walking away." Map to the rubric: real problem + Xero depth (50%), Accounting/Payments API (30%), production-ready architecture — the Connections panel and audit trail (20%).

Supporting surfaces to show if asked: **Calendar** (every block colour-coded by whether it's been paid for; click any event for its evidence chain), **Invoices** (every line's provenance chip + the "Money Robyn found" ledger detections), **Connections** (honest LIVE/FALLBACK/DOWN health).

## What is verified live vs via fallback

- **Live now, verified end to end against Xero (Demo Company UK):** contact create, ACCREC invoice create + authorise, History decision note, evidence Attachments, Payments (Halcyon retainer cadence with the June gap), an accepted Quote, and aged receivables. Proof: approving a proposal wrote **INV-0068** with its note + 2 attachments. The seed mirrors the whole story into the org (3 contacts, 17 invoices, quote QU-0042, 5 payments).
- **Live now:** the reconciliation engine (29 unit tests), Loop 1 transcript→invoice with the real Anthropic LLM, Loop 2 email agreement detection, Loop 3 detectors, the whole dashboard, all state transitions and the audit trail. Screenshots of every beat are in `docs/qa/`.
- **Fallback by design (no creds present):** calendar via the seeded `.ics`, email via the fixture mailbox. Both are shown honestly as FALLBACK on the Connections panel and swap to live when you add Google/IMAP creds.

## Three things to check first when you land

1. **Confirm Xero is still live** — `pnpm --filter robyn-api verify:xero` should print `G0 PASS`; the Connections panel should show XERO **LIVE / Demo Company (UK)**. (Custom Connection tokens don't expire the connection; if it ever drops, the fix steps are in the collapsed section above.)
2. **Walk the demo runbook once** against your own machine to get the timing, especially pasting your own Granola transcript in beat 2, and click through to the real invoice in Xero at the end.
3. **Skim the Connections panel** — it is the judges' production-readiness read; it tells the truth (Xero LIVE, calendar + email on demo data until you add those creds).

## Known rough edges

- Xero writes are gated on the Custom Connection fix — this is the one human step. Everything else runs unattended.
- Google Calendar OAuth is coded (read-only, `googleapis` dynamic import gated on a token) but only the `.ics` path is exercised in the demo. IMAP is coded but only the fixture mailbox is exercised.
- The LLM transcript parse is live and conservative (only work *beyond* the meeting time is billed), but output quality depends on the transcript — the human always reviews unless autonomy is ON.
- In dev mode React Strict Mode double-fires fetches; you'll see duplicate 200s in DevTools. Harmless; production build does not.
- Schema is TypeORM `synchronize` (no migrations) — fine for the demo, not for production.
