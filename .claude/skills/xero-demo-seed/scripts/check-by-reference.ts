// .claude/skills/xero-demo-seed/scripts/check-by-reference.ts
//
// Read-only. The three check-by-reference lookups the seed MUST run before
// every create (idempotency: skip on hit, create only what is absent).
// Compiles standalone: strict, target=ES2022, module=commonjs, esModuleInterop,
// types=["node"]. Node builtins only. Node 18+ (global fetch).
//
// Exact lookups (see SKILL.md idempotency table):
//   Contact:  GET /Contacts?where=Name="<Contact Name>"
//             optimised equals filter; case- and accent-insensitive
//   Bill:     GET /Invoices?where=Type=="ACCPAY" AND InvoiceNumber=="<ref>"&page=1
//             both fields optimised; ACCPAY InvoiceNumber is NON-unique —
//             ANY hit means "already seeded, skip"
//   PO:       GET /PurchaseOrders?page=1&pageSize=100 + client-side match on
//             PurchaseOrderNumber — a generic `where` param is NOT documented
//             on the PO endpoint, so none is used here.
//
// .env is loaded by the runner (e.g. `node --env-file=.env` on Node 20.6+).

const TOKEN_URL = "https://identity.xero.com/connect/token";
const API_BASE = "https://api.xero.com/api.xro/2.0";
const SEED_SCOPES = "accounting.contacts accounting.invoices";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface XeroContact {
  ContactID: string;
  Name: string;
}

export interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber: string;
  Status: string;
  Total?: number;
}

export interface XeroPurchaseOrder {
  PurchaseOrderID: string;
  PurchaseOrderNumber: string;
  Status: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") {
    throw new Error(
      `MissingEnv: ${name} is empty — this surfaces from Xero as unauthorized_client, ` +
        `which points away from the real cause. Set it in .env and retry.`,
    );
  }
  return v;
}

async function getAccessToken(): Promise<string> {
  const clientId = requireEnv("XERO_CLIENT_ID");
  const clientSecret = requireEnv("XERO_CLIENT_SECRET");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: SEED_SCOPES,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `TokenRequestFailed: HTTP ${res.status} from ${TOKEN_URL} — ${body}`,
    );
  }
  const token = (await res.json()) as TokenResponse;
  return token.access_token;
}

async function apiGet<T>(accessToken: string, pathAndQuery: string): Promise<T> {
  // No xero-tenant-id header: custom connection tokens are bound to one org.
  const res = await fetch(`${API_BASE}${pathAndQuery}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `XeroGetFailed: HTTP ${res.status} from GET ${pathAndQuery} — ${body}`,
    );
  }
  return (await res.json()) as T;
}

/** Contact check-by-reference. Unencoded filter: where=Name="Thameside Timber Ltd" */
export async function findContactByName(
  accessToken: string,
  name: string,
): Promise<XeroContact | null> {
  const where = encodeURIComponent(`Name="${name}"`);
  const data = await apiGet<{ Contacts?: XeroContact[] }>(
    accessToken,
    `/Contacts?where=${where}`,
  );
  return data.Contacts?.[0] ?? null;
}

/**
 * Bill check-by-reference. Unencoded filter:
 *   where=Type=="ACCPAY" AND InvoiceNumber=="TT-8841"
 * Returns ALL hits: ACCPAY InvoiceNumber is NON-unique in Xero, so the caller
 * treats a non-empty result as "already seeded — skip".
 */
export async function findBillsByInvoiceNumber(
  accessToken: string,
  invoiceNumber: string,
): Promise<XeroInvoice[]> {
  const where = encodeURIComponent(
    `Type=="ACCPAY" AND InvoiceNumber=="${invoiceNumber}"`,
  );
  const data = await apiGet<{ Invoices?: XeroInvoice[] }>(
    accessToken,
    `/Invoices?where=${where}&page=1`,
  );
  return data.Invoices ?? [];
}

/**
 * PO check-by-reference. No documented `where` support on /PurchaseOrders —
 * page through and match PurchaseOrderNumber client-side. Paging is enforced
 * by default; one page of 100 covers the whole 15-PO cast. If the org ever
 * holds more than 100 POs, walk pages until the pagination pageCount.
 */
export async function findPurchaseOrderByNumber(
  accessToken: string,
  poNumber: string,
): Promise<XeroPurchaseOrder | null> {
  const data = await apiGet<{ PurchaseOrders?: XeroPurchaseOrder[] }>(
    accessToken,
    "/PurchaseOrders?page=1&pageSize=100",
  );
  return (
    (data.PurchaseOrders ?? []).find(
      (po) => po.PurchaseOrderNumber === poNumber,
    ) ?? null
  );
}

async function main(): Promise<void> {
  const accessToken = await getAccessToken();

  // Probe the demo star's three references.
  const contact = await findContactByName(accessToken, "Thameside Timber Ltd");
  console.log(
    `Contact "Thameside Timber Ltd": ${contact ? `EXISTS (${contact.ContactID})` : "ABSENT"}`,
  );

  const po = await findPurchaseOrderByNumber(accessToken, "PO-1001");
  console.log(
    `PurchaseOrder PO-1001: ${po ? `EXISTS (${po.PurchaseOrderID}, ${po.Status})` : "ABSENT"}`,
  );

  const bills = await findBillsByInvoiceNumber(accessToken, "TT-8841");
  console.log(
    `Bill TT-8841: ${bills.length > 0 ? `EXISTS (${bills.length} hit(s) — ACCPAY InvoiceNumber is non-unique)` : "ABSENT"}`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
