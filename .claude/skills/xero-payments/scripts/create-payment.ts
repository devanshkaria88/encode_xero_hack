// .claude/skills/xero-payments/scripts/create-payment.ts
//
// Create a Payment against an AUTHORISED ACCPAY invoice via the raw Accounting API.
// Custom connection (client_credentials): the token is bound to exactly ONE Xero
// organisation, so no xero-tenant-id header and no XERO_TENANT_ID env var.
//
// Usage:
//   ts-node create-payment.ts <INVOICE_ID> <ACCOUNT_CODE> <AMOUNT> [DATE] [REFERENCE]
//   or via env: INVOICE_ID, ACCOUNT_CODE, AMOUNT, PAYMENT_DATE, PAYMENT_REFERENCE
//
// Env (export from .env at repo root before running; never commit, never log):
//   XERO_CLIENT_ID, XERO_CLIENT_SECRET   required
//   XERO_SCOPES                          optional, default "accounting.invoices accounting.payments"
//
// Compiles standalone: strict, target=ES2022, module=commonjs, types=["node"].
// Node 18+ (native fetch). No npm deps.

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_API = "https://api.xero.com/api.xro/2.0";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `MissingEnv: ${name} is empty — this surfaces from Xero as unauthorized_client. Set it in .env and retry.`,
    );
  }
  return v;
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

async function main(): Promise<void> {
  const clientId = requireEnv("XERO_CLIENT_ID");
  const clientSecret = requireEnv("XERO_CLIENT_SECRET");
  const scopes = process.env.XERO_SCOPES?.trim() || "accounting.invoices accounting.payments";

  const invoiceId = arg(0, "INVOICE_ID");
  const accountCode = arg(1, "ACCOUNT_CODE");
  const amountRaw = arg(2, "AMOUNT");
  const date = arg(3, "PAYMENT_DATE") ?? new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const reference = arg(4, "PAYMENT_REFERENCE");

  if (!invoiceId || !accountCode || !amountRaw) {
    throw new Error(
      "Usage: create-payment.ts <INVOICE_ID> <ACCOUNT_CODE> <AMOUNT> [DATE] [REFERENCE] (or set INVOICE_ID/ACCOUNT_CODE/AMOUNT env vars)",
    );
  }
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`BadAmount: "${amountRaw}" is not a positive number`);
  }

  // Never log the secret — length only.
  console.log("[xero] token request", { client_id_len: clientId.length, scopes });
  const token = await getToken(clientId, clientSecret, scopes);

  // ---- Pre-flight FACT-CHECK (not business logic) --------------------------
  // These asserts restate Xero's documented constraints so a bad write fails
  // here with a named local error instead of an opaque ValidationException.
  // The decision to pay was made upstream in api/src/modules/ — nothing below
  // decides anything.
  const inv = await getInvoice(token, invoiceId);

  if (inv.Status !== "AUTHORISED") {
    throw new Error(
      `InvoiceNotAuthorised: invoice ${invoiceId} has status ${inv.Status ?? "unknown"} — ` +
        `Xero applies payments to AUTHORISED invoices only (DRAFT/SUBMITTED create no journals). ` +
        `Approve it first: POST /Invoices/${invoiceId} {"Status":"AUTHORISED"}.`,
    );
  }
  if (typeof inv.AmountDue !== "number" || inv.AmountDue < amount) {
    throw new Error(
      `AmountExceedsAmountDue: AmountDue is ${inv.AmountDue ?? "unknown"}, requested ${amount} — ` +
        `Amount must be less than or equal to the outstanding amount owing on the invoice.`,
    );
  }

  // Idempotency check-by-reference: this project requires every Xero write to
  // check for an existing record before creating. Best-effort here via the
  // invoice's Payments array; the durable record is PaymentID persisted in
  // Postgres by the caller. Pass a unique REFERENCE to make reruns no-ops.
  if (reference) {
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
  }

  // ---- The write. PUT /Payments creates; POST /Payments/{id} deletes. ------
  const payment = {
    Invoice: { InvoiceID: invoiceId },
    Account: { Code: accountCode },
    Date: date,
    Amount: amount,
    ...(reference ? { Reference: reference } : {}),
  };
  // Deterministic Idempotency-Key: identical retries within Xero's 6-minute
  // cache window return the cached response instead of double-paying. This is
  // a retry guard only — the durable guarantee is the check above + Postgres.
  const idempotencyKey = `pay:${invoiceId}:${accountCode}:${amount}:${date}:${reference ?? ""}`.slice(0, 128);

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
    throw new Error(formatRejection(res.status, bodyText));
  }

  const created = (JSON.parse(bodyText) as PaymentEnvelope).Payments?.[0];
  if (!created?.PaymentID) {
    throw new Error(`PaymentParseError: 2xx response but no PaymentID — body: ${bodyText}`);
  }
  console.log(
    `[xero] created PaymentID=${created.PaymentID} Status=${created.Status ?? "?"} Amount=${created.Amount ?? amount}`,
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
