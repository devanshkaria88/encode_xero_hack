---
name: xero-accounting-api
description: The raw Xero Accounting API surface THIS project touches, over plain fetch with a Custom Connection (client_credentials, no xero-node SDK, no tenant id) — ACCPAY bills on /Invoices (where filters, create, DRAFT→SUBMITTED→AUTHORISED walk), Purchase Orders and Attachments and History notes (all three are NOT in the Xero MCP server — raw API is the ONLY path), Contacts for supplier matching, and the AgedPayablesByContact report. Covers pagination, If-Modified-Since, where-filter quoting traps, the Elements[].ValidationErrors envelope, rate limits and 429/Retry-After handling. Use when writing or reviewing ANY code in api/src/modules/xero/ that calls api.xro/2.0, when an MCP tool is missing (see xero-mcp-usage), or when debugging a Xero 400/403/429. Read this BEFORE writing any raw Accounting API call; do NOT rely on generic Xero knowledge.
---

# Raw Accounting API (Custom Connection, plain fetch — no SDK)

Base `https://api.xero.com/api.xro/2.0/{Resource}`. Send `Accept: application/json` on every call — Xero's default response format is XML. Bills are `/Invoices` with `Type: "ACCPAY"`; there is no `/Bills` endpoint. For token mechanics see the **`xero-auth`** skill; for paying bills see **`xero-payments`**; for what routes through MCP instead see **`xero-mcp-usage`**.

## ⚠️ Pre-flight — do this FIRST (skipping it costs hours)

1. **Assert env non-empty before any call.** `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` live in `.env` at the repo root, never committed, never logged. Empty values surface from Xero as `unauthorized_client` (because `client_id=` got sent), which points away from the real cause. `requireEnv()` in `scripts/xero-fetch.ts` throws `MissingEnv: XERO_CLIENT_ID is empty — ...` at first use.
2. **No tenant id — here is why.** A Custom Connection "utilise[s] the client credentials grant type to access data from a single Xero organisation" — one org per connection, so the tenant is implicit. The docs' canonical custom-connection API call carries exactly two headers: `Authorization: Bearer <token>` and `Accept: application/json`. (An explicit docs sentence "the xero-tenant-id header is not required" does not exist — UNVERIFIED — check before relying; the basis is the single-org binding plus its omission from the documented call.)
3. **Scopes are set at BOTH ends** — selected at app creation AND passed as `scope` in every token request body (this differs from code/PKCE flow where scopes ride the URL). This project's app selects `accounting.transactions accounting.contacts accounting.attachments accounting.reports.read` (see `.env.example`). A token minted without the needed scope 403s at runtime. Granular-scope migration: from 29 April 2026 all custom connections have granular scopes (`accounting.invoices` covers Invoices AND PurchaseOrders); existing connections may keep broad scopes until September 2027. Whether a brand-new custom connection can still select broad scopes today, and the exact granular report scope for aged payables: UNVERIFIED — check before relying (check the app dashboard scope picker).
4. **Smoke-test before wiring anything:** `npx tsx .claude/skills/xero-accounting-api/scripts/bills.ts` must print a bill count and a `pagination` object. If it fails here, fix auth first — Xero's errors deeper in are less useful.
5. **Reports need the reports role.** "An application that has been authorised by a Standard user without the 'reports' role will not be able to access the Reports ... endpoints (A HTTP 403 error will be returned)." Have the org admin who authorises the connection hold that role.

## Conventions on every call

| Fact | Value |
|---|---|
| JSON dates | `"UpdatedDateUTC": "\/Date(1439434356790)\/"` — unix epoch in **milliseconds** inside |
| PUT vs POST | PUT creates only; POST creates **or updates** |
| Envelope | single object or plural-keyed array (`{"Invoices":[...]}`) — both accepted |
| Page size | default **100**, max **1000**, min 1; out-of-range auto-adjusted (`pageSize=5000` → 1000 items) |
| Pagination object | responses include `"pagination": {page, pageSize, pageCount, itemCount}` |
| Paged endpoints | Invoices, Contacts, CreditNotes, BankTransactions, ManualJournals, Payments, PurchaseOrders, Prepayments, Overpayments |
| Request cap | 10MB per request; batch writes in bundles of ~50 elements |
| `If-Modified-Since` | header, UTC, accurate to the second; recommended on all large result sets |

**If-Modified-Since misses some changes.** Changes that don't bump `UpdatedDateUTC` are not returned: `DueDate`/`SentToContact` edits on partially paid transactions, and Contact `Balances`/`IsSupplier`/`IsCustomer`. Do not rely on it for those fields.

### Rate limits (per tenant unless stated)

| Limit | Value |
|---|---|
| Concurrent | 5 calls in progress |
| Minute | **60 calls/min** |
| Daily | 1,000/day (Starter tier) — **5,000/day** (higher tiers) |
| App-wide | 10,000 calls/min across all tenants |

Every response carries `X-DayLimit-Remaining`, `X-MinLimit-Remaining`, `X-AppMinLimit-Remaining`. On **429** the `X-Rate-Limit-Problem` header names the limit hit; minute/daily breaches also send `Retry-After` (seconds) — wait exactly that long. `xeroFetch` does this. Batch reads and cache in Postgres; never poll in a loop.

### Idempotency-Key header

Send `Idempotency-Key` on POST/PUT (ignored on GET). Xero caches the response for **6 minutes**; same key replays the cached response. Max **128 chars**. Same key + a *different* request (URL, body, or method changed) → 400 `Idempotency Key ... is used with a different request.` **Errors are cached too** — after fixing the underlying problem, GET to check whether the resource exists, then retry with a NEW key. Keyed duplicates still count against rate limits.

### `where` filter — quoting traps

- The whole expression must be **percent-encoded** (the helper's `query` map does this; never hand-concatenate into the URL).
- Strings use **double quotes** and `==`: official invoice example `Type=="ACCPAY" AND Status=="AUTHORISED"` → encoded `where=Type%3d%3d%22ACCPAY%22+AND+Status%3d%3d%22AUTHORISED%22`.
- Dates use **`DateTime(2015, 01, 01)`** syntax, not ISO strings: `Date >= DateTime(2015, 01, 01) && Date < DateTime(2015, 12, 31)`. Join conditions with `and`/`&&`.
- Keep to simple `==` on optimised fields — "Long, complex where queries can cause time outs"; unoptimised filter/order producing >100k rows → 400.
- Contacts' optimised examples use a single `=` (`where=Name="ABC limited"`) and are case- and accent-insensitive — never append `ToLower()`/`ToUpper()`.

### Validation error envelopes — two shapes

HTTP **400** returns an ApiException (real documented example):

```json
{
  "ErrorNumber": 10,
  "Type": "ValidationException",
  "Message": "A validation exception occurred",
  "Elements": [{ "ValidationErrors": [{ "Message": "Email address must be valid" }] }]
}
```

With `?summarizeErrors=false` (batch writes) you instead get HTTP **200** and a per-element `StatusAttributeString` of `OK`/`WARNING`/`ERROR`, with `ValidationErrors` on the failed element (the docs' bulk example shows `{"Description": "Invoice not of valid type for creation"}` — note the key differs from the 400 shape; parse both). A 200 does NOT mean the write succeeded — always assert per element (`assertElementOk` in the helper).

## Bills — `/Invoices` with `Type: "ACCPAY"`

Fields this project uses (create/read):

| Field | Notes |
|---|---|
| `Type` | `"ACCPAY"` — required on create |
| `Contact` | required; provide **only** `ContactID` |
| `LineItems` | at least one required; `Description` alone makes a valid line (1–4000 chars) |
| `LineItems[].UnitAmount` | rounded to **2dp** unless the request adds `?unitdp=4` |
| `LineItems[].TaxType` | override only when the `AccountCode` default tax is wrong |
| `InvoiceNumber` | ACCPAY: **NON-unique**, max 255, displays as **"Reference"** in the Xero UI |
| `Date` / `DueDate` | `YYYY-MM-DD`; `Date` defaults to today in the org timezone |
| `Status` | optional on create, defaults to `DRAFT`; may create directly as `SUBMITTED` or `AUTHORISED` |
| `LineAmountTypes` | `Exclusive` (default when omitted) / `Inclusive` / `NoTax` |
| `CurrencyCode` | defaults to org base currency |
| `Total` | computed: `SubTotal + TotalTax`; `LineAmount = Quantity × UnitAmount` (≤ 9,999,999,999.99) |

ACCPAY does **not** support discounts (`DiscountRate`/`DiscountAmount` are ACCREC-only).

### Status transitions (the documented table — everything else is illegal)

| Existing | May become |
|---|---|
| `DRAFT` | `DRAFT`, `SUBMITTED`, `AUTHORISED`, `DELETED` |
| `SUBMITTED` | `SUBMITTED`, `AUTHORISED`, `DRAFT`, `DELETED` |
| `AUTHORISED` | `AUTHORISED`, `VOIDED` |

- **`AUTHORISED` locks.** Journals are created and payments can now be applied; it can never return to `DRAFT`/`SUBMITTED` and cannot be deleted — only `VOIDED` (and voiding is shown only for invoices with no payments applied).
- **`PAID` is system-set** when fully paid. Never write it; a "paid" bill is a two-step: `AUTHORISED`, then a Payment (see `xero-payments`). No transitions are documented out of `PAID`, `VOIDED`, `DELETED` — treat as terminal.
- Invoices in a **locked period** cannot be updated. Partially/fully paid ACCPAY bills allow edits only to: Reference, DueDate, InvoiceNumber, BrandingThemeID, Contact (with CIS/credit-note caveats), Url, line Description, AccountCode (non-CIS), Tracking, PlannedPaymentDate.
- **Line-item update rule:** in an update, a line WITH `LineItemID` is updated, WITHOUT one is created, and any existing line whose id is missing from a supplied `LineItems` array is **deleted**. Status-only updates (as in the docs' delete example) send no `LineItems` at all.

### Listing

- Optimised `where` equality fields: Status, Contact.ContactID, Contact.Name, Contact.ContactNumber, Reference, InvoiceNumber, InvoiceId, Type, AmountPaid; range (`>`, `>=`, `<`, `<=`) also on Date, DueDate, AmountDue.
- Faster than `where` for lists: `?Statuses=AUTHORISED,DRAFT`, `?IDs=`, `?InvoiceNumbers=`, `?ContactIDs=` (comma-separated). `SearchTerm` text-searches InvoiceNumber + Reference.
- Default order `UpdatedDateUTC ASC, InvoiceId ASC`; optimised order fields: InvoiceId, UpdatedDateUTC, Date.
- **Always page**: paged responses include full `LineItems`; an unpaged multi-invoice GET returns contact summaries and NO line details. `summaryOnly=true` drops Payments/LineItems/HasAttachments and forces pagination.

### Idempotent create (check-by-reference)

Because ACCPAY `InvoiceNumber` is non-unique, "does this bill already exist?" must combine fields — filter on `Contact.ContactID` + `InvoiceNumber` (both optimised) and compare `Total` — or better, persist the returned `InvoiceID` and never re-create. Belt-and-braces: a stable `Idempotency-Key` per logical write (6-minute window only — it protects against retries, not against re-runs tomorrow).

## Purchase Orders — `/PurchaseOrders`

> ⚠️ **NOT IN THE MCP SERVER.** The Xero MCP server has zero purchase-order tools (verified by grep of its `src/tools/` — no tool name contains "purchase"). Same for Attachments and History. The raw API below is the ONLY path. Do not go looking for an MCP tool.

| Field | Notes |
|---|---|
| `Contact` | required; must be an **existing** contact — "The PurchaseOrders endpoint does not create new contacts" |
| `LineItems` | at least one required; if `Quantity` is set, `UnitAmount` must be too; `UnitAmount` rounds to **4dp** (no `unitdp` needed) |
| `PurchaseOrderNumber` | **unique**; auto-generated from org invoice settings when missing |
| `Status` | `DRAFT` (default) \| `SUBMITTED` \| `AUTHORISED` \| `BILLED` \| `DELETED` |
| `Date` / `DeliveryDate` / `Reference` / `LineAmountTypes` / `CurrencyCode` | as for bills |

- **Create:** PUT (create-only) or POST, envelope `{"PurchaseOrders":[...]}`, `?summarizeErrors=false` for per-element errors. Line-item update rule identical to invoices.
- **Status update:** POST to `/PurchaseOrders/{PurchaseOrderID}` with the new `Status` (docs' example flips a draft PO to `DELETED`). **Marking billed** = same mechanism with `"Status": "BILLED"` — but Xero publishes no PO transition table and no explicit mark-as-billed example, so which transitions are legal is UNVERIFIED — check before relying (probe on the seeded org first). `SentToContact` can be set only on approved or billed POs.
- **Listing:** explicit params only — `?status=DRAFT`, `?DateFrom=2015-12-01&DateTo=2015-12-31`, `order`, `page`, `pageSize`; changed-since via `If-Modified-Since`. A generic `where` param is not documented for POs — UNVERIFIED — check before relying (use the explicit params).
- **Paging is enforced by default**: 100/page, `pageSize` up to 1000.

## Attachments — `/{Endpoint}/{Guid}/Attachments/{Filename}`

> ⚠️ **NOT IN THE MCP SERVER** — raw API only.

- **Upload:** PUT or POST with the **raw file bytes** as the body — not JSON. `Content-Type` = the file's MIME type. PUT and POST are identical; the same filename on the same document **overwrites**. Example: `PUT /api.xro/2.0/Invoices/{InvoiceID}/Attachments/evidence.pdf`.
- **Limits:** **10 attachments per document, each up to 10MB** (the Contacts page says 25MB per file — the two official pages conflict; assume 10MB, do not rely on more without testing: UNVERIFIED above 10MB).
- **Filename rules:** any of `< > : " / \ | ? * NUL +` → rejected as Bad Request. Special characters must NOT be percent-encoded — except brackets, which MUST be encoded or the call fails.
- **List:** `GET /{Endpoint}/{Guid}/Attachments/` → `Attachments[]` of `{AttachmentID, FileName, Url, MimeType, ContentLength}`. **Fetch content:** GET the `Url` (`.../Attachments/{Filename}`) — returns raw bytes with the file's `Content-Type` and a `Content-Disposition: attachment` header, no JSON wrapper.
- **`?IncludeOnline=true`** on the upload URL makes the attachment visible on the online invoice — but only for **accounts receivable invoices and AR credit notes**. It does not apply to ACCPAY bills, so it is irrelevant to this project's evidence uploads; the response echoes `"IncludeOnline": true` when used.
- Parents supporting attachments: Invoices, Receipts, Credit Notes, Repeating Invoices, Bank Transactions, Bank Transfers, Contacts, Accounts, Manual Journals, Purchase Orders, Quotes.

## History & Notes — `/{Endpoint}/{Guid}/history`

> ⚠️ **NOT IN THE MCP SERVER** — raw API only. This is how the agent's decision note lands on a bill/PO.

Exact PUT shape (POST behaves identically):

```json
{ "HistoryRecords": [ { "Details": "Matched to PO-0042; approved under threshold rule." } ] }
```

- `Details` max **2500 chars**; multiple notes per call allowed.
- The note displays the **date of creation** and user **"System Generated"** — notes cannot be backdated, updated, or deleted, and Notes are the only Change type you can create.
- GET returns `HistoryRecords[]` of `{Changes, DateUTC, User, Details}` (e.g. `Changes: "Approved"`).
- Supported parents: BankTransactions, BatchPayments, BankTransfers (via BankTransactions), Contacts, Creditnotes, Invoices, Items, ManualJournals, Overpayments, Payments, Prepayments, Purchase Orders, Repeating Invoices, Quotes.

## Contacts — `/Contacts` (supplier matching fields)

| Field | Notes |
|---|---|
| `ContactID` | the only stable key — Xero warns Name "may no longer be a unique field"; never key on Name |
| `Name` | required, max 255; no angle brackets, no leading/trailing/repeated whitespace |
| `EmailAddress` | max 255, umlauts not supported |
| `IsSupplier` | read-only — auto-set once an AP invoice exists against the contact; **cannot** be set via PUT/POST |
| `ContactStatus` | `ACTIVE` / `ARCHIVED` / `GDPRREQUEST` (only ACTIVE is usable in transactions) |

- Optimised (equals-only, case- and accent-insensitive): `where=Name="ABC limited"`, `where=EmailAddress="email@example.com"`. Avoid `Contains`/`StartsWith` — unoptimised, and >100k rows → 400.
- `?SearchTerm=peter` — case-insensitive across Name, FirstName, LastName, ContactNumber, CompanyNumber, EmailAddress. This is the candidate source for fuzzy matching; the scoring itself lives in the match engine, not here.
- **Always page** (`?page=1`): unpaged GET returns a subset of fields. **Never `summaryOnly=true` for matching** — it excludes `IsSupplier`/`IsCustomer`.
- Contacts are **not auto-deduplicated by email** — posting an invoice with a new contact *name* creates a NEW contact every time. Look up first, reuse the `ContactID`.

## Reports — `GET /Reports/AgedPayablesByContact`

| Param | Notes |
|---|---|
| `ContactID` | **REQUIRED** — guid. Parameter table spells it `contactID`, the docs' example URL uses `ContactID`; casing tolerance UNVERIFIED — match the example: `?ContactID={guid}` |
| `date` | payments up to this date; defaults to end of current month |
| `fromDate` / `toDate` | payable-invoice window for the contact |

Response: `Reports[0].Rows[]`, each `RowType` one of `Header` (column labels: Date, Reference, Due Date, blank, Total, Paid, Credited, Due), `Section` (nests `Rows`), `Row` (data — each Cell `{Value, Attributes}` where `Attributes` carries `{Id:"invoiceID", Value:<guid>}` for drill-down), `SummaryRow` (totals). See `reportDataRows()` in the script for the walk.

## Snippets

All compile standalone (strict, ES2022, commonjs, `@types/node` only) and import nothing but node builtins and `./xero-fetch`. Run with `npx tsx <file>` from the repo root with the `.env` vars exported into the environment first (tsx does not auto-load `.env`).

| File | Shows |
|---|---|
| `scripts/xero-fetch.ts` | the thin helper: env assertion, token cache, `Accept: application/json`, query encoding, 429/`Retry-After` retry, 400-envelope parsing, `assertElementOk` |
| `scripts/bills.ts` | list ACCPAY with `where`/order/page/If-Modified-Since, create bill (PUT + idempotency key + `summarizeErrors=false`), legal status walk |
| `scripts/purchase-orders.ts` | PO create/list/get, status update incl. `BILLED` |
| `scripts/attachments.ts` | raw-bytes upload onto an invoice, filename guard, list |
| `scripts/history-note.ts` | append the agent's decision note (exact PUT shape), read history |
| `scripts/suppliers-and-report.ts` | contact lookup by Name/EmailAddress/searchTerm, aged payables + row walker |

## Traps (these bite in production)

- **ACCPAY `InvoiceNumber` is non-unique and shows up as "Reference" in the Xero UI.** Existence checks must combine ContactID + InvoiceNumber + Total, or persist `InvoiceID`.
- **A 200 is not success on batch writes.** With `summarizeErrors=false`, failed elements hide inside a 200 — assert `StatusAttributeString` per element.
- **Omitting `LineItemID`s in an update deletes those lines.** Send every existing line's id, or send no `LineItems` at all for status-only updates.
- **Unpaged list calls silently drop data**: multi-invoice GETs lose LineItems; unpaged Contacts lose fields; `summaryOnly` loses `IsSupplier`. Always `?page=`.
- **`If-Modified-Since` is not a full change feed** — `IsSupplier`, `Balances`, and DueDate-on-partially-paid edits don't bump `UpdatedDateUTC`.
- **Idempotency keys cache errors** for 6 minutes — recover with GET-then-new-key, never blind retry with the same key.
- **`unitdp` differs by endpoint**: invoice UnitAmounts are 2dp unless `?unitdp=4`; PO UnitAmounts are natively 4dp. Penny drift between a PO and its bill can be rounding, not fraud — the match engine must compare at consistent precision.
- **`AUTHORISED` is a one-way door** — no edits back to DRAFT, no delete, only VOIDED (unpaid only). Do the match BEFORE approving.
- **Locked periods reject updates** with a validation error even on otherwise-legal transitions.
- **`IncludeOnline` is AR-only** — it does nothing for ACCPAY bills.
- **History notes are permanent and timestamped at creation** — never write anything into a note you would not show an auditor.
- **The PO endpoint never creates contacts** (unlike invoice creation by contact name, which spawns duplicates) — resolve the ContactID first.

## Error → real cause

| Symptom | Real cause |
|---|---|
| `unauthorized_client` from the token endpoint | empty/missing `XERO_CLIENT_ID`/`XERO_CLIENT_SECRET` — assert env before building the request |
| `invalid_scope` / 403 on a call that used to work | scope missing from app config or token request; scopes live at BOTH ends (see pre-flight 3) |
| 403 on `/Reports/...` only | authorising user lacks the 'reports' role |
| HTTP 400 + `ApiException` | validation failure — read `Elements[].ValidationErrors[].Message` |
| HTTP 200 but the entity never appeared | `summarizeErrors=false` swallowed a per-element `ERROR` — check `StatusAttributeString` |
| 429 | rate limit; `X-Rate-Limit-Problem` names which; sleep `Retry-After` seconds (helper does) |
| 400 `Idempotency Key ... used with a different request` | same key, different URL/body/method within the 6-minute window |
| Same error repeats after the fix | cached idempotent error — GET to check existence, retry with a NEW key |
| 400 Bad Request on attachment upload | forbidden filename char (`< > : " / \ | ? * NUL +`), or unencoded brackets, or file over the cap |
| 400 on a list call | unoptimised `where`/`order` over >100k rows, or unencoded `where` expression |
| Line items vanished after an update | `LineItems` array supplied without every existing `LineItemID` |
| Can't set status `PAID` | PAID is system-set — create/approve to `AUTHORISED`, then apply a Payment |
| Can't move `AUTHORISED` back to `DRAFT` | illegal transition — AUTHORISED only stays or becomes `VOIDED` |
| Update rejected on an old bill | locked period, or the bill is partially/fully paid (only the whitelisted fields are editable) |
| Duplicate suppliers appearing | invoices posted with a contact *name* instead of a resolved `ContactID` |
| History note rejected | `Details` over 2500 chars |

<!--
Sources (fact sheets verified 2026-07-04 against developer.xero.com, plus cloned repos):
- .tmp/xero-refs/undefined/style.md            — prompt-library skill discipline; error→cause quotes; scope tables; contact-dedup trap
- .tmp/xero-refs/undefined/docs-accounting.md  — Invoices/PurchaseOrders/Payments/Types pages: fields, status tables, where examples, pagination
- .tmp/xero-refs/undefined/docs-evidence.md    — Attachments/HistoryAndNotes/Reports/Contacts pages: upload mechanics, size-cap conflict, note shape, report rows, contact filters
- .tmp/xero-refs/undefined/docs-auth.md        — custom connections, rate limits, requests-and-responses conventions, idempotency guide, 400 envelope example
- .tmp/xero-refs/ap-symfony.md                 — AP endpoint quartet (/Invoices bills, /PurchaseOrders, /Payments, /Contacts)
- .tmp/xero-refs/mcp.md + xero-mcp-server repo — "no purchase order / attachment / history tools" (verified by grep)
Doc URLs: developer.xero.com/documentation/api/accounting/{invoices,purchaseorders,attachments,historyandnotes,reports,contacts,types,requests-and-responses,responsecodes}; /documentation/guides/oauth2/{custom-connections,limits}; /documentation/guides/idempotent-requests/idempotency
-->
