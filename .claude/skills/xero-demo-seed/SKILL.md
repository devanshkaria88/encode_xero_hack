---
name: xero-demo-seed
description: SPEC for seeding the demo Xero org so the data tells a story — the 15-supplier UK trade cast (contacts, AUTHORISED purchase orders, ACCPAY bills £80–£8,000 net with 20% UK VAT via LineAmountTypes Exclusive), EXACTLY two deliberate match gaps (Thameside Timber's £4,200 bill with NO goods receipt, and one bill £148 over its PO — outside the ±2%/£5 tolerance), the Google Sheet receipt-log schema, idempotent check-by-reference lookups with the exact where-filters, and the contacts → POs → bills → sheet ordering. Use when writing or reviewing ANYTHING in seed/, or when the demo org needs re-seeding or resetting. Read this BEFORE creating any contact, PO, or bill in the org. Facts and shapes only — the runnable seeding code lives in seed/, match/approval decisions live in api/src/modules/. For endpoint mechanics see xero-accounting-api; for MCP-vs-raw routing see xero-mcp-usage (POs have NO MCP tools — raw API only).
---

# Seeding the demo Xero org (the data must tell a story)

One seeded org: 15 UK trade supplier contacts, 15 AUTHORISED purchase orders, 15 ACCPAY bills, 14 receipt rows in a Google Sheet. 13 bills match clean; exactly 2 do not, by design — those 2 gaps ARE the demo. This file is the spec that `seed/` transcribes. It serves Gate G0; the G1 unit tests assert the exact match-states in the cast table below.

## ⚠️ Pre-flight — do this FIRST (before any write)

Run `npx tsx .claude/skills/xero-demo-seed/scripts/preflight.ts` from repo root (read-only). It asserts, in order:

1. **`XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` are non-empty**, with named `MissingEnv` errors. An empty client id surfaces from the token endpoint as 400 `invalid_request` (because `client_id=` got sent), which points away from the real cause. Secrets live in `.env` at repo root — never committed, never logged; the script logs `client_id_len`, never the value.
2. **A `client_credentials` token mints and its granted `scope` lists exactly the whole scope tokens `accounting.transactions` and `accounting.contacts`.** Compare as a Set of whole tokens split on whitespace, NEVER by substring — `"accounting.contacts.read".includes("accounting.contacts")` is `true`, so a substring check false-passes a read-only misconfiguration and the seed 403s on its first create instead. Custom-connection scopes are configured at BOTH ends — selected on the app config AND sent in the token request body. Fail here with a named `MissingScope` error instead of at the worst moment mid-seed.
3. **`GET https://api.xero.com/connections` returns 200** and the script prints `tenantName` so a human confirms it is the DEMO org before anything is written. Seeding a real org is unrecoverable on demo day. Do NOT use `GET /api.xro/2.0/Organisation` for this: it requires `accounting.settings` or `accounting.settings.read`, which this project's app does not carry, so it 403s every run. The connections route is the same one xero-auth's `verify-auth.ts` uses.
4. (Manual, once) **Confirm the org base currency is GBP in the Xero UI** (check org settings). An automated `BaseCurrency` check would need `accounting.settings.read`, which the project app does not carry — this stays a human pre-flight checklist item.
5. (Manual, once) **Pick the expense account for line items**: set `XERO_SEED_ACCOUNT_CODE` in `.env` to an expense account whose default tax rate is 20% VAT on purchases. Omit `TaxType` on lines so the AccountCode default applies — that mechanism is documented; the exact UK 20% TaxType code (commonly cited as `INPUT2`) is UNVERIFIED — check before relying.

## Auth model — why there is no `XERO_TENANT_ID`

- This project uses a **Custom Connection** (`grant_type=client_credentials`), which per Xero's docs "utilise the client credentials grant type to access data from a **single Xero organisation**". One org per connection → no org ambiguity → nothing for a tenant header to disambiguate.
- Token endpoint: `POST https://identity.xero.com/connect/token` with `Authorization: Basic base64(client_id:client_secret)`, `Content-Type: application/x-www-form-urlencoded`, body `grant_type=client_credentials&scope=...`.
- Xero's own custom-connection call example sends only `Authorization: Bearer ...` and `Accept` — **no `xero-tenant-id` header** (unlike code-flow tokens, where it is required). An explicit docs sentence "the header is not required" does not exist — UNVERIFIED — check before relying; the canonical example omitting it is the evidence.
- Token lifetime ~30 min (`expires_in` is authoritative); the response has **no `refresh_token`** — re-mint when needed. A full seed run fits in one token.
- Scopes for seeding: `accounting.transactions accounting.contacts` — a strict SUBSET of the four scopes assigned to the project's single app (`accounting.transactions accounting.contacts accounting.attachments accounting.reports.read`). There is no separate seed app; requesting any scope outside the assigned set gets 400 `invalid_scope` from the token endpoint. `accounting.transactions` grants Invoices AND PurchaseOrders; `accounting.contacts` grants Contacts.
- Custom Connections are UK-available (AU/NZ/UK/US only, paid subscription; free against the Xero Demo Company for development).

## The cast — 15 UK trade suppliers (transcribe exactly)

All amounts are net (ex VAT). Every document sets `"LineAmountTypes": "Exclusive"`; Xero adds 20% VAT from the account's default tax rate, so **Total = net × 1.20** (e.g. TT-8841: 4200.00 + 840.00 = 5040.00). Every net below lands on exact 2dp when multiplied by 1.2. One line item per document: `net = Qty × Unit`.

| # | Contact Name | Trade | PO # | Bill # (InvoiceNumber) | Unit £ | PO qty | Bill qty | PO net £ | Bill net £ | Line item description | Match state |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Thameside Timber Ltd | Timber merchant | PO-1001 | TT-8841 | 70.00 | 60 | 60 | 4200.00 | 4200.00 | C24 treated carcassing 47x150mm, 4.8m lengths | **MISSING_RECEIPT** (demo star) |
| 2 | Brixton Plumbing Merchants Ltd | Plumbers' merchant | PO-1002 | BPM-2210 | 74.00 | 25 | 27 | 1850.00 | 1998.00 | 15mm copper tube 3m and brassware bundle | **AMOUNT_MISMATCH** |
| 3 | Walthamstow Electrical Wholesale Ltd | Electrical wholesaler | PO-1003 | WEW-0345 | 93.25 | 10 | 10 | 932.50 | 932.50 | 6242Y twin and earth cable 2.5mm, 100m drum | MATCHED |
| 4 | Hackney Plant Hire Ltd | Plant hire | PO-1004 | HPH-7712 | 220.00 | 12 | 12 | 2640.00 | 2640.00 | 1.5t mini excavator, day rate | MATCHED |
| 5 | Bermondsey Skip Hire Ltd | Skip hire | PO-1005 | BSH-1108 | 340.00 | 1 | 1 | 340.00 | 340.00 | 8-yard builders skip, 2-week hire | MATCHED |
| 6 | Croydon Builders Merchants Ltd | Builders' merchant | PO-1006 | CBM-5521 | 45.00 | 84 | 84 | 3780.00 | 3780.00 | Aerated concrete blocks 100mm, per pack | MATCHED |
| 7 | Deptford Sheet Materials Ltd | Timber and sheet | PO-1007 | DSM-0092 | 31.60 | 40 | 40 | 1264.00 | 1264.00 | 18mm structural hardwood ply 2440x1220 | MATCHED |
| 8 | Ealing Electrical Factors Ltd | Electrical wholesaler | PO-1008 | EEF-4478 | 102.55 | 5 | 5 | 512.75 | 512.75 | 10-way consumer unit with RCBOs | MATCHED |
| 9 | Fulham Plumbing Supplies Ltd | Plumbers' merchant | PO-1009 | FPS-3301 | 689.95 | 1 | 1 | 689.95 | 689.95 | Unvented hot water cylinder 210L | MATCHED |
| 10 | Greenwich Tool and Plant Ltd | Plant hire | PO-1010 | GTP-6640 | 140.00 | 8 | 8 | 1120.00 | 1120.00 | Towable diesel generator, day rate | MATCHED |
| 11 | Ilford Aggregates and Skips Ltd | Skip hire and aggregates | PO-1011 | IAS-2287 | 65.00 | 12 | 12 | 780.00 | 780.00 | MOT Type 1 aggregate, bulk bag | MATCHED |
| 12 | Kentish Town Building Supplies Ltd | Builders' merchant | PO-1012 | KBS-9034 | 49.50 | 120 | 120 | 5940.00 | 5940.00 | Facing bricks, per pack | MATCHED |
| 13 | Leyton Roofing Supplies Ltd | Roofing merchant | PO-1013 | LRS-1156 | 38.50 | 60 | 60 | 2310.00 | 2310.00 | Concrete interlocking roof tiles, per bundle | MATCHED |
| 14 | Mile End Hire Centre Ltd | Plant hire | PO-1014 | MEH-8890 | 152.00 | 3 | 3 | 456.00 | 456.00 | Petrol cut-off saw, week hire | MATCHED |
| 15 | Peckham Decorating Supplies Ltd | Decorators' merchant | PO-1015 | PDS-0417 | 7.05 | 12 | 12 | 84.60 | 84.60 | Trade emulsion 10L, brilliant white | MATCHED |

Naming rules baked into the cast: no apostrophes or angle brackets (keeps `where` filters trivially encodable; Contact `Name` rejects angle brackets, leading/trailing whitespace, and repeating spaces), all references UPPERCASE-only (see Traps), net range £84.60–£5,940.00 inside the £80–£8,000 brief. Give each contact a plain-ASCII `EmailAddress` (`accounts@<slug>.co.uk`) — umlauts are unsupported.

## The story — exactly two gaps, everything else clean

- **#1 Thameside Timber (TT-8841, £4,200 net / £5,040 gross) — the demo star.** PO-1001 exists, AUTHORISED, amounts identical. The Google Sheet has **no row for PO-1001**. Expected engine verdict: `MISSING_RECEIPT`. The narrative: the biggest bill on the desk, looks perfect, and the one thing missing is proof anyone received the timber.
- **#2 Brixton Plumbing Merchants (BPM-2210).** PO-1002 authorises 25 × £74.00 = £1,850.00 net; the bill charges 27 × £74.00 = £1,998.00 net. Difference £148.00 = 8.0% of the PO. Tolerance is ±2% or £5, whichever is greater → max(£37.00, £5) = £37.00 — outside, net or gross. The sheet DOES have a receipt row for PO-1002 (qty 27, delivery was fine), so the only gap is bill vs PO: `AMOUNT_MISMATCH`.
- **#3–#15**: PO net = bill net, receipt row present with qty = bill qty → `MATCHED`. These are the auto-approve volume that makes the two exceptions stand out.

## Dates (relative to seed day D — always fresh)

| Field | Value | Why |
|---|---|---|
| PO `Date` | D−14 | Match rule requires PO date ≤ bill date |
| PO `DeliveryDate` | D−7 | Goods land a week later |
| Sheet `date` (receipt) | D−7 | Receipt signed on delivery day |
| Bill `Date` | D−5 | Invoice follows delivery |
| Bill `DueDate` | D+25 | 30 days from invoice, still open on demo day |

All `YYYY-MM-DD`.

## Purchase orders (raw Accounting API — no MCP tools exist for POs)

`POST https://api.xero.com/api.xro/2.0/PurchaseOrders?summarizeErrors=false`

```jsonc
{
  "PurchaseOrders": [
    {
      "Contact": { "ContactID": "<from contacts step>" }, // PO endpoint NEVER creates contacts
      "PurchaseOrderNumber": "PO-1001",                   // unique alphanumeric; auto-generated if omitted — always set it
      "Date": "<D-14>",
      "DeliveryDate": "<D-7>",
      "Status": "AUTHORISED",                             // create-as-AUTHORISED is shown in the official examples; reads as a real order
      "LineAmountTypes": "Exclusive",
      "LineItems": [
        { "Description": "C24 treated carcassing 47x150mm, 4.8m lengths",
          "Quantity": 60, "UnitAmount": 70.00, "AccountCode": "<XERO_SEED_ACCOUNT_CODE>" }
      ]
    }
    // ... one element per cast row; single batch call
  ]
}
```

PO statuses: `DRAFT`, `SUBMITTED`, `AUTHORISED`, `BILLED`, `DELETED`. No official PO status-transition table exists; anything beyond "official example deletes a DRAFT PO via Status=DELETED" is UNVERIFIED — check before relying. The demo later marks POs `BILLED` via a POST status update (implied mechanism; no official mark-as-billed example — UNVERIFIED — check before relying).

## Bills (ACCPAY invoices)

`POST https://api.xero.com/api.xro/2.0/Invoices?summarizeErrors=false`

```jsonc
{
  "Invoices": [
    {
      "Type": "ACCPAY",
      "Contact": { "ContactID": "<from contacts step>" }, // NEVER a bare Name — that silently creates a duplicate contact
      "InvoiceNumber": "TT-8841",  // supplier's invoice ref; for ACCPAY this is NON-unique and displays as "Reference" in the Xero UI
      "Reference": "PO-1001",      // the PO join key the match engine reads
      "Date": "<D-5>",
      "DueDate": "<D+25>",
      "Status": "SUBMITTED",       // "Awaiting Approval" — the agent's approve action flips it to AUTHORISED live on stage
      "LineAmountTypes": "Exclusive",
      "LineItems": [
        { "Description": "C24 treated carcassing 47x150mm, 4.8m lengths",
          "Quantity": 60, "UnitAmount": 70.00, "AccountCode": "<XERO_SEED_ACCOUNT_CODE>" }
      ]
    }
    // ... one element per cast row; single batch call
  ]
}
```

Why `SUBMITTED`: creating directly with DRAFT/SUBMITTED/AUTHORISED is documented; SUBMITTED → AUTHORISED is a legal transition and gives the demo its approval moment. Do NOT seed AUTHORISED (once AUTHORISED a bill can never go back and can only be VOIDED, and there is nothing left for the agent to do).

With `summarizeErrors=false` a batch returns **HTTP 200 even when elements fail** — the seed must check every element's `StatusAttributeString` and fail loudly printing its `ValidationErrors`. ACCPAY bills do not support discounts. UnitAmount is rounded to 2dp unless `unitdp=4` is passed — the cast is all 2dp, so don't pass it.

## Contacts

Create one per cast row (a batch `{"Contacts":[...]}` envelope is UNVERIFIED on the pages checked — 15 sequential calls are trivially inside the rate budget):

```jsonc
// PUT https://api.xero.com/api.xro/2.0/Contacts  (PUT = create-new per the API-wide rule)
{ "Name": "Thameside Timber Ltd", "EmailAddress": "accounts@thamesidetimber.co.uk" }
```

Store the returned `ContactID` — Xero warns Contact `Name` "may no longer be a unique field" in future; ContactID is the only durable key. `IsSupplier` cannot be set: Xero flips it automatically when the first ACCPAY bill lands.

## Google Sheet receipt log

Columns, exactly and in this order: `date, po_ref, supplier, items, qty, signed_by, photo_link`.

One row per PO **except PO-1001** (14 rows total — the missing row IS the demo star's gap). `po_ref` joins to `PurchaseOrderNumber`; `supplier` matches Contact `Name`; `qty` = units actually received = bill qty (so #2's only defect is bill vs PO). `photo_link` points at a real delivery-note photo in Drive (live-data rule — replace placeholders before rehearsal). Three example rows (seed day 2026-07-04 → date = D−7):

| date | po_ref | supplier | items | qty | signed_by | photo_link |
|---|---|---|---|---|---|---|
| 2026-06-27 | PO-1002 | Brixton Plumbing Merchants Ltd | 15mm copper tube 3m and brassware bundle | 27 | D. Okafor | https://drive.google.com/file/d/receipt-po-1002 |
| 2026-06-27 | PO-1004 | Hackney Plant Hire Ltd | 1.5t mini excavator, day rate | 12 | S. Whelan | https://drive.google.com/file/d/receipt-po-1004 |
| 2026-06-27 | PO-1006 | Croydon Builders Merchants Ltd | Aerated concrete blocks 100mm, per pack | 84 | M. Price | https://drive.google.com/file/d/receipt-po-1006 |

## Idempotency — check-by-reference before EVERY create

The seed must be safe to re-run: look up by reference, skip on hit, create only what is absent. Never check by amount (see Traps). Exact lookups:

| Entity | Reference | Exact lookup | Notes |
|---|---|---|---|
| Contact | `Name` | `GET /api.xro/2.0/Contacts?where=Name%3D%22Thameside%20Timber%20Ltd%22` (unencoded: `where=Name="Thameside Timber Ltd"`) | Optimised equals filter; case- and accent-insensitive; do NOT append `ToLower()` |
| Bill | `InvoiceNumber` | `GET /api.xro/2.0/Invoices?where=Type%3D%3D%22ACCPAY%22%20AND%20InvoiceNumber%3D%3D%22TT-8841%22&page=1` (unencoded: `where=Type=="ACCPAY" AND InvoiceNumber=="TT-8841"`) | Both fields optimised. ACCPAY InvoiceNumber is NON-unique — ANY hit means "already seeded, skip" |
| Purchase order | `PurchaseOrderNumber` | `GET /api.xro/2.0/PurchaseOrders?page=1&pageSize=100` then match `PurchaseOrderNumber` client-side | A generic `where` param is NOT documented on the PO endpoint (UNVERIFIED — check before relying) — do not use one. Paging is enforced by default; one page covers the cast; if the org ever holds >100 POs, walk `pagination.pageCount` |
| Sheet row | `po_ref` | Read the sheet, match `po_ref` string | Plain string compare, uppercase both sides |

Rules:

- The `where` value MUST be percent-encoded (spaces, quotes, `==`).
- Treat a hit whose `Status` is `DELETED` or `VOIDED` as absent and recreate (whether list GETs return deleted docs by default is UNVERIFIED — check before relying; this rule is safe either way).
- Persist returned `ContactID` / `PurchaseOrderID` / `InvoiceID` locally after create — they are the durable keys; references are only the lookup handles.
- Xero's `Idempotency-Key` header is NOT a substitute: keys expire after 6 minutes and cache errors too. Use it (one fresh UUID per create) to guard against double-submit within a run; check-by-reference is the durable guard across runs.

## Ordering — contacts → POs → bills → sheet rows

| Step | Why it cannot move |
|---|---|
| 1. Contacts | Both `/Invoices` and `/PurchaseOrders` require the `ContactID` of an EXISTING contact — the PO endpoint never creates contacts, and posting a bill with a bare contact name silently creates a duplicate contact. The ContactIDs minted here are inputs to steps 2–3. |
| 2. POs | Bills carry the PO number in `Reference`. Xero would not reject a bill referencing a nonexistent PO — the ordering is for referential truth: the match engine joins bill→PO, so the join target must exist before anything points at it. |
| 3. Bills | Consume ContactIDs (step 1) and PO numbers (step 2). |
| 4. Sheet rows | `po_ref` and `supplier` join back to steps 1–2; the sheet lives outside Xero, so it is written after Xero state is confirmed good. |

## Rate budget

60 calls/min/tenant, 5 concurrent, 5,000/day. First full run, sequential: 1 token + 1 org + 15 contact lookups + 15 contact creates + 1 PO list + 1 PO batch create + 1 bill lookup list + 1 bill batch create ≈ 36 calls — one minute of budget. Run strictly sequentially; on `429` read `Retry-After` and wait (`X-Rate-Limit-Problem` names the limit). Batch bills and POs in single `{"Invoices":[...]}` / `{"PurchaseOrders":[...]}` calls — never one call per document.

## Resetting seeded data

| Doc | Seeded status | Documented off-switch |
|---|---|---|
| Bill | SUBMITTED | POST status update to `DELETED` (legal from DRAFT/SUBMITTED). Once the demo has AUTHORISED it: `VOIDED` only — AUTHORISED can never return to DRAFT/SUBMITTED. If PAID: reverse the payment first (`POST /Payments/{PaymentID}` body `{"Status":"DELETED"}`), then void (void is documented only for approved invoices with no payments applied). |
| PO | AUTHORISED | Official delete example covers a DRAFT PO only; deleting an AUTHORISED PO is UNVERIFIED — check before relying. Whether a DELETED PO's number can be reused is UNVERIFIED — if a PO must be replaced, bump to a fresh number series (PO-2001…) rather than fight it. |
| Contact | ACTIVE | No delete exists in the docs; `ContactStatus: ARCHIVED` is the only documented end-state ("can no longer be used in transactions"); the exact write path to set it is UNVERIFIED — check before relying. Contacts are harmless to leave in place — re-runs skip them by Name. |

## Snippets

Both compile standalone under `strict`, `target=ES2022`, `module=commonjs`, `esModuleInterop`, `types=["node"]` — node builtins only, no npm deps, no top-level await. `.env` is loaded by the runner (e.g. `node --env-file=.env` on Node 20.6+); the scripts only read `process.env` and assert.

- `scripts/preflight.ts` — the pre-flight above: env assertions, token mint + scope check, `GET /Organisations` printout. Read-only. Run before every seed run.
- `scripts/check-by-reference.ts` — the three lookup functions with the exact filters from the idempotency table, plus a `main()` that probes the demo star's three references (Thameside Timber Ltd / PO-1001 / TT-8841) and prints EXISTS/ABSENT. Read-only. `seed/` imports the same shapes, not this file.

## Traps

- **Re-running with changed amounts creates near-duplicates.** Check by reference, never by amount. If you edit a cast amount, the reference lookup still hits the old document and skips — the org keeps the OLD amount, and "create if the amount differs" would mint a second TT-8841 (ACCPAY InvoiceNumber is non-unique; Xero will not stop you). To change an amount: delete/void the old doc first, or bump the reference.
- **ACCPAY `InvoiceNumber` is NON-unique** and displays as "Reference" in the Xero UI. An empty lookup does not mean Xero would block a duplicate. Store `InvoiceID` after create.
- **Xero auto-uppercases some references** UNVERIFIED — check before relying. Neutralised by construction: every seed reference (PO-1001, TT-8841) is already uppercase-only, and the match engine should compare references case-insensitively regardless.
- **Deleting seeded data is status-dependent.** Bills: DRAFT/SUBMITTED → `DELETED`; AUTHORISED → `VOIDED` only; PAID/VOIDED/DELETED are terminal. POs: only the DRAFT→DELETED path is documented. Plan resets BEFORE authorising things.
- **Contacts are not auto-deduplicated.** A bill posted with a contact `Name` instead of `ContactID` creates a NEW contact every time and litters the org. Duplicate suppliers appearing in the org = this bug.
- **Contact `Name` is a lookup handle, not a key.** Xero warns it may stop being unique; the optimised Name filter is case- and accent-insensitive; Name rejects leading/trailing whitespace and repeating spaces — trim before create AND before compare.
- **`Idempotency-Key` will not save a re-run.** Keys live 6 minutes and cache errors: a keyed request that failed returns the same cached error even after the cause is fixed — GET to check reality, recreate with a NEW key.
- **`summarizeErrors=false` hides failures in a 200.** Every batch element must be checked for `StatusAttributeString: "ERROR"` or the seed reports success while bills are silently missing.
- **Multi-invoice GETs without paging return NO line items.** Always add `page=1` when verifying seeded line details.
- **Updating a document's lines: omit an existing `LineItemID` and that line is DELETED.** If a re-run repairs a doc via POST update, echo every existing LineItemID.

## Errors → real cause

| Symptom | Real cause |
|---|---|
| `unauthorized_client` from the token endpoint | `XERO_CLIENT_ID`/`XERO_CLIENT_SECRET` empty or wrong — `client_id=undefined` got sent. Fix the env assertion trail, not Xero. |
| 401 mid-run | Access token expired (~30 min). No refresh token exists on client_credentials — mint a new token. |
| 403 on Contacts/Invoices/PurchaseOrders | Scope missing from the token: not sent in the token request body, or not enabled on the Custom Connection app config (both ends must agree). |
| 400 `Idempotency Key ... is used with a different request` | Same key reused within 6 min with a changed URL, body, or method. New create = new key. |
| The same error keeps returning after you fixed the cause | Cached idempotent error. GET to check whether the doc exists; recreate with a NEW key. |
| 429 | Rate limit — `X-Rate-Limit-Problem` names which (minute/day/concurrent); wait `Retry-After` seconds. |
| HTTP 200 but documents missing in Xero | `summarizeErrors=false` batch: per-element `StatusAttributeString: "ERROR"` with `ValidationErrors` you did not read. |
| 400 `A validation exception occurred` | Read `Elements[].ValidationErrors`. e.g. "A Contact must be specified for this type of transaction" = PO posted without an existing ContactID. |
| Duplicate suppliers in the org | A bill was posted with `Contact: { "Name": ... }` instead of `ContactID`. |
| Bills list shows no line items | Multi-invoice GET without `page` — add `page=1`. |
| 400 on a filtered GET | `where` value not percent-encoded, or an unoptimised filter expression. |

<!--
Sources (fact-check trail):
- .tmp/xero-refs/undefined/style.md — skill format/discipline, requireEnv pattern + unauthorized_client causal chain, idempotency-key rules (6 min, cached errors, 400 different-request), 429/Retry-After, contact-dedup gotcha, scope minimalism/granular scopes, /api.xro/2.0/Organisations verified 200 (Replit path table). Underlying: XeroAPI/xero-prompt-library SKILL.md files.
- .tmp/xero-refs/undefined/docs-accounting.md — Invoices (ACCPAY, statuses + legal transitions, InvoiceNumber non-unique + displays-as-Reference, create envelopes, summarizeErrors, optimised where fields incl. Type/InvoiceNumber/Contact.Name, pagination, LineItemID delete-on-omit, no-discounts-on-ACCPAY, unitdp), PurchaseOrders (fields, PurchaseOrderNumber unique/auto-generate, AUTHORISED-on-create shown in examples, DRAFT→DELETED example, no documented `where` param, paging enforced 100/page), LineAmountTypes Exclusive default, Payments delete/reverse. Underlying: developer.xero.com/documentation/api/accounting/{invoices,purchaseorders,payments,types}, verified 2026-07-04.
- .tmp/xero-refs/ap-symfony.md — AP surface = /Invoices (bills) + /PurchaseOrders + /Payments + /Contacts; three-way-match seed-shape hints. Underlying: xero-prompt-library/php/accounts-payable-symfony.txt.
- .tmp/xero-refs/undefined/docs-evidence.md — Contacts (Name required/constraints/uniqueness warning, ContactID durable key, IsSupplier auto-set, optimised where=Name="..." case/accent-insensitive, searchTerm, pagination), ContactStatus ARCHIVED. Underlying: developer.xero.com/documentation/api/accounting/contacts, verified 2026-07-04.
- .tmp/xero-refs/undefined/docs-auth.md — custom connections (token endpoint, Basic auth, client_credentials, single-org quote, no tenant header in canonical example, scopes at both ends, token response fields incl. no refresh_token, ~30 min lifetime), rate limits (60/min, 5 concurrent, Retry-After, X-Rate-Limit-Problem), where-encoding, summarizeErrors 200 behaviour, pagination object, Idempotency-Key guide facts. Underlying: developer.xero.com oauth2 guides + requests-and-responses, verified 2026-07-04.
- .tmp/xero-refs/xero-mcp-server/src/handlers — grepped 2026-07-04: zero PurchaseOrder handlers → POs are raw-API only.
- Tolerance ±2%/£5 and match-state names (MATCHED / MISSING_RECEIPT / AMOUNT_MISMATCH): context/architecture.md (project truth, not a Xero fact).
- Auto-uppercase of references: searched all fact sheets and cloned repos 2026-07-04 — no evidence either way; left UNVERIFIED.
-->
