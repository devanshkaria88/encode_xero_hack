---
name: xero-payments
description: Create a Payment against an AUTHORISED ACCPAY bill via the raw Xero Accounting API (PUT /Payments, plain fetch, Custom Connection client_credentials — no tenant id). Use when recording a bill payment in Xero, checking why a payment write was rejected, verifying the payment-account prerequisite, or reversing a payment. Covers required fields (Invoice.InvoiceID, Account.Code/AccountID, Date, Amount), the BANK-or-payments-enabled account rule, partial vs full payment effects on invoice Status/AmountDue, idempotency discipline, and the rejection causes that bite. Read this BEFORE writing any payment code; do NOT use the MCP server's create-payment (no idempotency — see xero-mcp-usage skill).
---

# Paying an ACCPAY bill: `PUT /Payments`

Money moves outside Xero (bank rail). Xero is the ledger: a Payment row records that the bill was paid. This skill is facts + runnable snippets only — the decision to pay lives in `api/src/modules/`, never here.

## ⚠️ Pre-flight — do this FIRST (skipping it costs hours)

Each check prevents a misleading upstream error.

1. **Assert secrets non-empty.** Verified empirically 2026-07-04 against the live token endpoint: an empty client id in the Basic header, a missing Authorization header, or a JSON body → 400 `invalid_request`; wrong credentials → 400 `invalid_client`. Both point away from the real cause (`unauthorized_client` means something else — see the error table). At boot:

```ts
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`MissingEnv: ${name} is empty — reaches the token endpoint as 400 invalid_request. Set it in .env and retry.`);
  }
  return v;
}
```

2. **Scope: payments ride on the project's broad `accounting.transactions`.** The ONE app (see xero-auth) has exactly `accounting.transactions accounting.contacts accounting.attachments accounting.reports.read`; `accounting.transactions` covers both the pre-flight invoice GET and `PUT /Payments`. Request only subsets of the app's assigned scopes — a scope the app does not have (e.g. granular `accounting.invoices accounting.payments` on this app) → 400 `invalid_scope`. Missing scope → 403 at the API call, and a token's scope cannot be widened — mint a new token.

3. **Fact-check the payment account once per org.** The account must be type `BANK` **or** have "enable payments to this account" switched on (edit account screen, Chart of Accounts). The GET /Accounts check below needs `accounting.settings.read` (per xero-auth's scope table: Accounts sits under `accounting.settings[.read]`), which the project's four canonical scopes deliberately exclude — so it **403s under the project token**. Project path: verify the account once by hand in Xero (Chart of Accounts) and record its Code in `.env` as `XERO_PAYMENT_ACCOUNT_CODE`. If you do run the check, note the `Code=="..."` where-filter on Accounts is UNVERIFIED — check before relying (docs only show `Type=="BANK"`):

```ts
const where = encodeURIComponent(`Code=="${accountCode}"`);
const res = await fetch(`https://api.xero.com/api.xro/2.0/Accounts?where=${where}`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
});
const { Accounts } = (await res.json()) as { Accounts?: Array<{ Type?: string }> };
const acc = Accounts?.[0];
if (!acc) throw new Error(`AccountNotFound: no account with Code ${accountCode}`);
if (acc.Type !== "BANK") console.warn(`[xero] account is ${acc.Type} — confirm payments are enabled on it`, acc);
```

4. **Fact-check the invoice: `Status === "AUTHORISED"` and `AmountDue >= amount`.** Built into `scripts/create-payment.ts` below — it GETs the invoice and fails with `InvoiceNotAuthorised` / `AmountExceedsAmountDue` before attempting the write. This restates Xero's documented constraints as named local errors; it is not approval logic.

## Auth: why there is no tenant id

Custom Connection = `client_credentials` grant, bound to **one** Xero organisation ("access data from a single Xero organisation" — multi-org needs code/PKCE flow instead). One org means nothing to select, so no `XERO_TENANT_ID` env var and no `xero-tenant-id` header: the documented custom-connection API call carries only `Authorization: Bearer` + `Accept`. (The docs omit the header from the canonical example; an explicit "not required" sentence does not appear — UNVERIFIED — check before relying.)

Token: `POST https://identity.xero.com/connect/token` with `Authorization: Basic base64(client_id:client_secret)`, body `grant_type=client_credentials&scope=...` (scopes in the BODY — differs from code/PKCE where scopes ride in the URL). Access token is a JWT, valid up to 30 minutes. Only `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` are needed, from `.env`, never committed, never logged (log `client_id_len`, not the value).

## The write

Endpoint: `https://api.xero.com/api.xro/2.0/Payments` — **PUT creates. POST deletes (reverses). There is no update** ("Payments cannot be modified, only created and deleted").

Minimum body (official single-payment example shape):

```json
{
  "Invoice": { "InvoiceID": "96df0dff-43ec-4899-a7d9-e9d63ef12b19" },
  "Account": { "Code": "001" },
  "Date": "2026-07-04",
  "Amount": 32.06
}
```

| Field | Facts |
|---|---|
| `Invoice` | Exactly ONE identifier object per payment (Invoice, CreditNote, Prepayment, or Overpayment). Identify by `InvoiceID`. `InvoiceNumber` also works but is NON-unique on ACCPAY — always use `InvoiceID`. |
| `Account` | `Code` or `AccountID`. "Not all accounts have a code value" — `AccountID` is always safe. Must satisfy the BANK-or-payments-enabled prerequisite. |
| `Date` | Date the payment is being made, `YYYY-MM-DD`. |
| `Amount` | In the **invoice's** currency. Must be less than or equal to the outstanding amount owing (`AmountDue`). |
| Optional | `Reference`, `IsReconciled`, `BankAmount`, `CurrencyRate`, `Status`. |

Envelope: single object, or `{"Payments": [...]}` for multiple (add `?summarizeErrors=false` for per-element `ValidationErrors`). Multiple bills in one transaction → `BatchPayments` endpoint instead. Send `Accept: application/json` or you get XML.

### Partial vs full payment

- Partial payments are allowed (any Amount ≤ AmountDue). Invoice `Status` stays `AUTHORISED` — the enum's own definition: "An Invoice that is Approved and Awaiting Payment OR partially paid". `AmountDue` drops, `AmountPaid` rises (computed fields).
- Full payment: "Once an invoice is fully paid the status will change to PAID." `PAID` is system-set — you cannot write it. Creating a paid bill is always two steps: create/approve to `AUTHORISED`, then `PUT /Payments`.
- After partial/full payment, an ACCPAY bill is mostly frozen: only Reference, DueDate, InvoiceNumber, BrandingThemeID, Contact (with exceptions), Url, line Description/AccountCode (non-CIS), Tracking, PlannedPaymentDate remain updatable.

### Created payment

Response envelope `{"Payments": [...]}` with `PaymentID`. Payment status codes: `AUTHORISED`, `DELETED`. A bill payment shows PaymentType `ACCPAYPAYMENT`. Reverse with `POST /Payments/{PaymentID}` body `{"Status": "DELETED"}` (payments created via batch payments and receipts are excluded from this delete method).

### Multicurrency

A payment is multicurrency if the payment account or the invoice is in a non-base currency. `Amount` is always invoice-currency. If the bank account currency differs, set `BankAmount` (account currency) and let Xero calculate `CurrencyRate` — "If you know this amount, specifying it is preferred to setting CurrencyRate". Non-multicurrency payments have `CurrencyRate` 1; a CurrencyRate validation warning may be returned if the rate appears incorrect.

## Runnable snippet

`scripts/create-payment.ts` — standalone (strict TS, commonjs, Node 18+ fetch, zero deps; compile-verified). Run from repo root:

```
npx tsx .claude/skills/xero-payments/scripts/create-payment.ts <INVOICE_ID> <ACCOUNT_CODE> <AMOUNT> [DATE] [REFERENCE]
```

It: parses repo-root `.env` itself (no dotenv; existing process.env wins) → asserts env → gets a client_credentials token → GETs the invoice → ALWAYS runs check-by-reference (`REFERENCE` defaults deterministically to `pay:<first 8 of InvoiceID>:<amount>` and is set on the created payment) and skips if a non-deleted payment with that `Reference` already exists on the invoice → fails with named errors unless `AUTHORISED` and `AmountDue >= amount` → PUTs the payment with an `Idempotency-Key` (deterministic + optional `IDEMPOTENCY_SALT` env; new salt = new key per attempt) → prints `PaymentID` → re-GETs the invoice and prints new `Status`/`AmountDue`/`AmountPaid`. 3 API calls + 1 token call — well under the 60/min tenant limit.

## Traps

- **Paying a non-AUTHORISED invoice.** Payments apply to approved AR/AP invoices only; `DRAFT`/`SUBMITTED` create no journals and cannot take payments. Approve first: `POST /Invoices/{InvoiceID}` with `{"Status": "AUTHORISED"}` (legal from DRAFT and SUBMITTED; the MCP server cannot do this — raw API only). Exact ValidationError text for this rejection is not published — UNVERIFIED — check before relying.
- **Wrong account class.** Non-`BANK` account without payments enabled → validation rejection (exact message not published — UNVERIFIED — check before relying). Fix in the UI (edit account screen) or via the Accounts API — SDK field `enablePaymentsToAccount` (confirmed in XeroAPI/xero-command-line `accounts update`); raw JSON property name `EnablePaymentsToAccount` UNVERIFIED — check before relying.
- **Currency mismatch.** `Amount` is invoice-currency, not account-currency. A currency the org is not subscribed to fails validation — documented example message: `Organisation is not subscribed to currency EUR`. Cross-currency: prefer `BankAmount` over hand-set `CurrencyRate`; a suspect rate returns a validation warning.
- **Amount exceeding AmountDue.** Documented constraint: "Must be less than or equal to the outstanding amount owing on the invoice". Exact rejection message not published — UNVERIFIED — check before relying. Always compare against a FRESH `AmountDue` (another partial payment may have landed since your cache).
- **Idempotency: check-by-reference BEFORE create.** Project rule: every Xero write checks for an existing record first. Give each payment a unique `Reference`, check the invoice's `Payments` array before writing, persist the returned `PaymentID` in Postgres. The `Idempotency-Key` header is only a retry guard: keys expire after **6 minutes**, max **128 chars**, same key + different request → 400 `Idempotency Key: KEY_VALUE is used with a different request.`, and **errors are cached** — a rerun with the same key can replay a stale error after the real cause is fixed (GET to check, then retry with a new key; the script's optional `IDEMPOTENCY_SALT` env exists for exactly this — new salt = new key per attempt).
- **Embedded `Payments` shape on `GET /Invoices/{id}`: whether the array carries `Reference`/`Status` is UNVERIFIED — check before relying.** The check-by-reference skip depends on it; verify on the live org at G2 and record the observed shape here. If `Reference` is absent, the skip silently never matches and reruns double-pay (the script's status/AmountDue asserts are the backstop).
- **PUT/POST are inverted vs habit.** `PUT /Payments` creates; `POST /Payments/{PaymentID}` deletes. Nothing updates a payment — to correct one, delete and re-create.
- **`PAID` cannot be written and `AUTHORISED` cannot be re-drafted.** PAID is system-set on full payment. An AUTHORISED invoice can only stay AUTHORISED or go VOIDED (and voiding is shown only for invoices with no payments applied) — delete the payment first if you must void.
- **Batch responses lie about success.** With `summarizeErrors=false`, validation failures come back **HTTP 200** with per-element `StatusAttributeString: "ERROR"` — check `ValidationErrors` per element, never the HTTP status alone.

## Error → real cause

| You see | Real cause |
|---|---|
| Token 400 `invalid_request` (verified empirically 2026-07-04) | Empty client id in the Basic header, missing Authorization header, or a JSON body instead of form-encoding. Assert env first. |
| Token 400 `invalid_client` (verified empirically) | Wrong secret or wrong client id, incl. malformed Basic encoding. |
| `unauthorized_client` from the token endpoint | App is not a Custom Connection / client_credentials grant not enabled on it — not an empty-env symptom on this endpoint (that is code-flow only). |
| `invalid_scope` (HTTP 400) from the token endpoint | Scope string includes a scope not assigned to the app. Request a subset of the app's assigned scopes — this project: `accounting.transactions` covers payments (see xero-auth). |
| `403` on the API call | Token missing the needed scope. Scopes cannot be widened on an existing token — mint a new one with the right scope (and match the app config). |
| `400` with `"Type": "ValidationException"` (`ErrorNumber` 10) | Field-level rejection — the truth is in `Elements[].ValidationErrors[].Message`, not the top-level message. |
| HTTP 200 but element has `StatusAttributeString: "ERROR"` | You sent `summarizeErrors=false`; per-element `ValidationErrors` carry the failure. |
| `400` `Idempotency Key: ... is used with a different request.` | Same key, changed URL/body/method. Persist the key with the record and retry byte-identically, or use a new key. |
| Same error repeats after the cause is fixed | Cached idempotent error (keys live 6 min). GET to check whether the payment exists; if not, re-create with a NEW key. |
| `429` + `Retry-After` header | Rate limit: 60/min per tenant, 5 concurrent, daily 1,000 on starter tier (new-app default) or 5,000 on higher tiers. `X-Rate-Limit-Problem` names the limit hit; wait `Retry-After` seconds. |
| XML instead of JSON | Missing `Accept: application/json` — XML is the Accounting API default. |
| `404` on the invoice GET | Wrong `InvoiceID`, or wrong path — use the real REST path `/api.xro/2.0/Invoices/{InvoiceID}`, not `/accounting/...`-style alias paths (those 404). |

<!--
Sources (fact-checked 2026-07-04):
- .tmp/xero-refs/facts/docs-accounting.md — §4 Payments (min body, one-identifier rule, Account.Code/AccountID, Amount<=outstanding, account BANK/payments-enabled prerequisite, partial->AUTHORISED / full->PAID, PUT create / POST delete, BankAmount/CurrencyRate, "Organisation is not subscribed to currency EUR" example, Payment statuses AUTHORISED|DELETED, ACCPAYPAYMENT), §1 Invoices (status transition table, AUTHORISED="apply payments", ACCPAY InvoiceNumber non-unique, post-payment updatable fields, summaryOnly excludes Payments — basis for the invoice Payments array check).
- .tmp/xero-refs/facts/docs-auth.md — §1 Custom Connections (token endpoint, Basic auth, scope in body, single-org quote, two-header call example / xero-tenant-id omission marked UNVERIFIED, 30-min token), §2 rate limits + 429/Retry-After/X-Rate-Limit-Problem, §3 request conventions (XML default, where-filter encoding, summarizeErrors semantics, ApiException envelope, PUT-vs-POST), §4 Idempotency-Key (6 min, 128 chars, different-request 400 message, errors cached).
- .tmp/xero-refs/facts/style.md — skill format, pre-flight discipline, client_id_len logging, idempotency "rules that bite". (Its unauthorized_client-from-empty-client_id chain is the code-flow authorize URL — superseded here by the 2026-07-04 token-endpoint probes; its granular-scope prescription superseded by the project scope canon in xero-auth.)
- .tmp/xero-refs/facts/mcp.md — §4 create-payment passes idempotencyKey undefined, §5 update-invoice cannot set status (why approval must be raw API), §3 custom-connection env (XERO_CLIENT_ID/SECRET, no tenant env).
- .tmp/xero-refs/facts/ap-symfony.md — AP surface = /Invoices (bills) + /PurchaseOrders + /Payments + /Contacts; Xero is the ledger, money moves on external rails.
- .tmp/xero-refs/xero-command-line/src/commands/accounts/update.ts:57,73 + src/lib/validators.ts:181 — enablePaymentsToAccount SDK field.
- Empirical probes 2026-07-04 against live https://identity.xero.com/connect/token (via xero-auth): wrong creds → 400 {"error":"invalid_client"}; empty client id in Basic / no Authorization header / JSON body → 400 {"error":"invalid_request"}.
- scripts/create-payment.ts compile-verified: tsc --strict --target ES2022 --module commonjs --esModuleInterop --types node; run-verified with npx tsx (reaches the token call from a bare .env).
-->
