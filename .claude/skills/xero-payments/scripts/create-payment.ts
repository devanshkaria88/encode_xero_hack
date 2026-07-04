// .claude/skills/xero-payments/scripts/create-payment.ts
//
// Create a Payment against an AUTHORISED ACCPAY invoice via the raw Accounting API.
// Custom connection (client_credentials): the token is bound to exactly ONE Xero
// organisation, so no xero-tenant-id header and no XERO_TENANT_ID env var.
//
// Usage (from repo root):
//   npx tsx .claude/skills/xero-payments/scripts/create-payment.ts <INVOICE_ID> <ACCOUNT_CODE> <AMOUNT> [DATE] [REFERENCE]
//   or via env: INVOICE_ID, ACCOUNT_CODE, AMOUNT, PAYMENT_DATE, PAYMENT_REFERENCE
//
// Env (this script parses repo-root .env itself — no dotenv; vars already in
// process.env win over the file; never commit, never log):
//   XERO_CLIENT_ID, XERO_CLIENT_SECRET   required
//   XERO_SCOPES                          optional, default "accounting.transactions"
//                                        (payments ride on the project's broad scope — see xero-auth)
//   IDEMPOTENCY_SALT                     optional, appended to the Idempotency-Key.
//                                        Xero caches ERRORS under a key for ~6 minutes,
//                                        so after fixing a failure's cause set a NEW
//                                        salt: new salt = new key per attempt.
//
// Compiles standalone: strict, target=ES2022, module=commonjs, types=["node"].
// Node 18+ (native fetch). No npm deps.

import * as fs from "node:fs";
import * as path from "node:path";

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_API = "https://api.xero.com/api.xro/2.0";

// Tiny .env parser (same shape as xero-auth's verify-auth.ts): skip comments and
// blanks, tolerate a leading `export `, strip MATCHING single/double quotes,
// never override vars already set in process.env. Missing file tolerated.
function loadDotEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) {
    console.warn(`[xero] no .env at ${envPath} — relying on process.env only`);
    return;
  }
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    const existing = process.env[key];
    if (existing === undefined || existing === "") {
      process.env[key] = value;
    }
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `MissingEnv: ${name} is empty — if it reaches Xero's token endpoint it surfaces as ` +
        `400 invalid_request (verified 2026-07-04), pointing away from the real cause. ` +
        `Set it in .env at repo root and retry.`,
    );
  }
  return v.trim();
}

function arg(pos: number, envName: string): string | undefined {
  return process.argv[2 + pos] ?? process.env[envName];
}

interface ValidationError {
  Message?: string;
}
interface ApiException {
  ErrorNumber?: number;
  Type?: string;
  Message?: string;
  Elements?: Array<{ ValidationErrors?: ValidationError[] }>;
}
interface XeroPayment {
  PaymentID?: string;
  Status?: string;
  Amount?: number;
  Date?: string;
  Reference?: string;
}
interface XeroInvoice {
  InvoiceID?: string;
  Type?: string;
  Status?: string;
  AmountDue?: number;
  AmountPaid?: number;
  CurrencyCode?: string;
  Payments?: XeroPayment[];
}
interface InvoiceEnvelope {
  Invoices?: XeroInvoice[];
}
interface PaymentEnvelope {
  Payments?: XeroPayment[];
}

async function getToken(clientId: string, clientSecret: string, scopes: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    // Custom connections take scopes in the BODY (unlike code/PKCE flows, where
    // scopes ride in the authorize URL).
    body: new URLSearchParams({ grant_type: "client_credentials", scope: scopes }).toString(),
  });
  if (!res.ok) {
    // Verified empirically 2026-07-04: empty client id / missing Authorization /
    // JSON body -> 400 invalid_request; wrong creds -> 400 invalid_client;
    // unauthorized_client -> app is not a Custom Connection / grant not enabled.
    throw new Error(`TokenError: ${res.status} from identity.xero.com — ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("TokenError: token response contained no access_token");
  }
  return json.access_token;
}

async function getInvoice(token: string, invoiceId: string): Promise<XeroInvoice> {
  // No xero-tenant-id header: a custom connection token is scoped to a single org.
  const res = await fetch(`${XERO_API}/Invoices/${invoiceId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (res.status === 404) {
    throw new Error(`InvoiceNotFound: no invoice with InvoiceID ${invoiceId}`);
  }
  if (!res.ok) {
    throw new Error(`InvoiceFetchError: ${res.status} — ${await res.text()}`);
  }
  const json = (await res.json()) as InvoiceEnvelope;
  const inv = json.Invoices?.[0];
  if (!inv) {
    throw new Error(`InvoiceNotFound: empty Invoices envelope for ${invoiceId}`);
  }
  return inv;
}

function formatRejection(status: number, bodyText: string): string {
  try {
    const api = JSON.parse(bodyText) as ApiException;
    const msgs = (api.Elements ?? [])
      .flatMap((e) => e.ValidationErrors ?? [])
      .map((v) => v.Message)
      .filter((m): m is string => typeof m === "string");
    if (msgs.length > 0) {
      return `PaymentRejected: ${status} ${api.Type ?? ""} — ${msgs.join(" | ")}`;
    }
    if (api.Message) {
      return `PaymentRejected: ${status} — ${api.Message}`;
    }
  } catch {
    // not JSON — fall through to raw body
  }
  return `PaymentRejected: ${status} — ${bodyText}`;
}

function statusRemedy(invoiceId: string, status: string): string {
  if (status === "DRAFT" || status === "SUBMITTED") {
    // Approval is legal from DRAFT and SUBMITTED ONLY; these create no journals
    // and cannot take payments.
    return `Approve it first: POST /Invoices/${invoiceId} {"Status":"AUTHORISED"}.`;
  }
  if (status === "PAID") {
    return "Already fully paid — nothing to do (AmountDue 0).";
  }
  if (status === "VOIDED" || status === "DELETED") {
    return `${status} is terminal — this invoice cannot be paid.`;
  }
  return "Xero applies payments to AUTHORISED invoices only.";
}

async function main(): Promise<void> {
  // Repo root is four levels up from this script's directory.
  loadDotEnv(path.resolve(__dirname, "../../../../.env"));

  const clientId = requireEnv("XERO_CLIENT_ID");
  const clientSecret = requireEnv("XERO_CLIENT_SECRET");
  // Payments ride on the project's broad accounting.transactions scope (the ONE
  // app's assigned scopes — see xero-auth). Request only subsets of the app's
  // assigned scopes: anything else 400s with invalid_scope.
  const scopes = process.env.XERO_SCOPES?.trim() || "accounting.transactions";

  const invoiceId = arg(0, "INVOICE_ID");
  const accountCode = arg(1, "ACCOUNT_CODE");
  const amountRaw = arg(2, "AMOUNT");
  // Default date is UTC (toISOString), not org-local — off by one day 00:00-00:59 BST.
  const date = arg(3, "PAYMENT_DATE") ?? new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  if (!invoiceId || !accountCode || !amountRaw) {
    throw new Error(
      "Usage: create-payment.ts <INVOICE_ID> <ACCOUNT_CODE> <AMOUNT> [DATE] [REFERENCE] (or set INVOICE_ID/ACCOUNT_CODE/AMOUNT env vars)",
    );
  }
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`BadAmount: "${amountRaw}" is not a positive number`);
  }

  // Reference is ALWAYS set: defaults deterministically so the check-by-reference
  // guard below can never be silently skipped (project rule: every Xero write is
  // idempotent check-by-reference).
  const reference = arg(4, "PAYMENT_REFERENCE") ?? `pay:${invoiceId.slice(0, 8)}:${amount}`;

  // Never log the secret — length only.
  console.log("[xero] token request", { client_id_len: clientId.length, scopes });
  const token = await getToken(clientId, clientSecret, scopes);

  const inv = await getInvoice(token, invoiceId);

  // ---- Idempotency check-by-reference (ALWAYS runs) ------------------------
  // Runs BEFORE the status/amount asserts so a rerun after a successful full
  // payment reports the skip, not an error. Whether the embedded Payments array
  // on GET /Invoices/{id} carries Reference/Status is
  // UNVERIFIED — check before relying
  // (verify on the live org at G2 and record the shape in SKILL.md). If
  // Reference is absent from the embedded array this skip never matches; the
  // status/AmountDue asserts below are the backstop. Durable record: PaymentID
  // persisted in Postgres by the caller.
  const existing = (inv.Payments ?? []).find(
    (p) => p.Reference === reference && p.Status !== "DELETED",
  );
  if (existing) {
    console.log(
      `[xero] payment already exists — idempotent skip. PaymentID=${existing.PaymentID ?? "?"} Reference=${reference}`,
    );
    console.log(`[xero] invoice ${invoiceId}: Status=${inv.Status} AmountDue=${inv.AmountDue}`);
    return;
  }

  // ---- Pre-flight FACT-CHECK (not business logic) --------------------------
  // These asserts restate Xero's documented constraints so a bad write fails
  // here with a named local error instead of an opaque ValidationException.
  // The decision to pay was made upstream in api/src/modules/ — nothing below
  // decides anything.
  if (inv.Status !== "AUTHORISED") {
    const status = inv.Status ?? "unknown";
    throw new Error(
      `InvoiceNotAuthorised: invoice ${invoiceId} has status ${status} — ` +
        `Xero applies payments to AUTHORISED invoices only. ${statusRemedy(invoiceId, status)}`,
    );
  }
  if (typeof inv.AmountDue !== "number" || inv.AmountDue < amount) {
    throw new Error(
      `AmountExceedsAmountDue: AmountDue is ${inv.AmountDue ?? "unknown"}, requested ${amount} — ` +
        `Amount must be less than or equal to the outstanding amount owing on the invoice.`,
    );
  }

  // ---- The write. PUT /Payments creates; POST /Payments/{id} deletes. ------
  const payment = {
    Invoice: { InvoiceID: invoiceId },
    Account: { Code: accountCode },
    Date: date,
    Amount: amount,
    Reference: reference,
  };
  // Idempotency-Key: a retry guard only — the durable guarantee is the
  // check-by-reference above + Postgres. Xero caches ERROR responses under the
  // key for ~6 minutes too, so a purely deterministic key would replay a stale
  // error after the cause is fixed. IDEMPOTENCY_SALT mints a fresh key:
  // new salt = new key per attempt.
  const salt = process.env.IDEMPOTENCY_SALT?.trim();
  const idempotencyKey =
    `pay:${invoiceId}:${accountCode}:${amount}:${date}:${reference}${salt ? `:${salt}` : ""}`.slice(0, 128);

  const res = await fetch(`${XERO_API}/Payments`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payment),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    console.error(
      "[xero] write rejected — Xero caches this error under the Idempotency-Key for ~6 minutes: " +
        "after fixing the cause, rerun with a NEW IDEMPOTENCY_SALT (or wait out the window), " +
        "or the cached error replays even though the cause is fixed.",
    );
    throw new Error(formatRejection(res.status, bodyText));
  }

  const created = (JSON.parse(bodyText) as PaymentEnvelope).Payments?.[0];
  if (!created?.PaymentID) {
    throw new Error(`PaymentParseError: 2xx response but no PaymentID — body: ${bodyText}`);
  }
  console.log(
    `[xero] created PaymentID=${created.PaymentID} Status=${created.Status ?? "?"} Amount=${created.Amount ?? amount} Reference=${reference}`,
  );

  // Re-read the invoice: AmountDue drops by Amount; Status flips to PAID only
  // when fully paid (system-set), stays AUTHORISED while partially paid.
  const after = await getInvoice(token, invoiceId);
  console.log(
    `[xero] invoice ${invoiceId}: Status=${after.Status ?? "?"} AmountDue=${after.AmountDue ?? "?"} AmountPaid=${after.AmountPaid ?? "?"}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

export {};
