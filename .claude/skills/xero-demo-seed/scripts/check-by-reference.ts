// .claude/skills/xero-demo-seed/scripts/check-by-reference.ts
//
// Read-only. The check-by-reference lookups the seed MUST run before every
// create (idempotency: skip on hit, create only what is absent). Run from
// repo root:
//
//   npx tsx .claude/skills/xero-demo-seed/scripts/check-by-reference.ts
//
// Compiles standalone: strict, target=ES2022, module=commonjs, esModuleInterop,
// types=["node"]. Node builtins only. Node 18+ (global fetch).
//
// Parses <repo-root>/.env itself (no dotenv dep): comments and blank lines
// skipped, leading `export ` tolerated, MATCHING single/double quotes
// stripped, and variables already set in process.env always win over the file.
//
// Exact lookups (see SKILL.md idempotency table):
//   Contact:  GET /Contacts?where=Name="<Contact Name>"
//             optimised equals filter; case- and accent-insensitive
//   Bill:     one-off probe:
//               GET /Invoices?where=Type=="ACCPAY" AND InvoiceNumber=="<ref>"&page=1
//             full seed run — ONE batched call for ALL 15 refs:
//               GET /Invoices?InvoiceNumbers=TT-8841,BPM-2210,...&page=1
//             (documented optimised comma-separated param), matched client-side.
//             ACCPAY InvoiceNumber is NON-unique — ANY hit means "already
//             seeded, skip".
//   PO:       GET /PurchaseOrders?page=1&pageSize=100 fetched ONCE per run,
//             then matched on PurchaseOrderNumber client-side — a generic
//             `where` param is NOT documented on the PO endpoint, so none is
//             used here. findPurchaseOrderByNumber takes the PREFETCHED list
//             so a per-row transcription cannot re-fetch: 15 per-row list GETs
//             waste 14 calls and help blow the 60/min window (SKILL.md Rate
//             budget).

import * as fs from "node:fs";
import * as path from "node:path";

const TOKEN_URL = "https://identity.xero.com/connect/token";
const API_BASE = "https://api.xero.com/api.xro/2.0";

// A strict SUBSET of the four scopes assigned to the project's single app —
// see SKILL.md §Auth model. Requesting a scope outside the assigned set gets
// 400 invalid_scope. accounting.transactions covers Invoices AND PurchaseOrders.
const SEED_SCOPES = "accounting.transactions accounting.contacts";

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
  Type?: string;
  Status: string;
  Total?: number;
}

export interface XeroPurchaseOrder {
  PurchaseOrderID: string;
  PurchaseOrderNumber: string;
  Status: string;
}

// Tiny .env parser: skip comments/blanks, tolerate leading `export `, strip
// MATCHING single/double quotes, never override existing process.env.
function loadDotEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) {
    console.warn(`[seed:check] no .env at ${envPath} — relying on process.env only`);
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
  if (v === undefined || v.trim() === "") {
    throw new Error(
      `MissingEnv: ${name} is empty — an empty client id surfaces from the token ` +
        `endpoint as 400 invalid_request, which points away from the real cause. ` +
        `Set it in .env and retry.`,
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
 * Bill check-by-reference — ONE-OFF PROBE form. Unencoded filter:
 *   where=Type=="ACCPAY" AND InvoiceNumber=="TT-8841"
 * Returns ALL hits: ACCPAY InvoiceNumber is NON-unique in Xero, so the caller
 * treats a non-empty result as "already seeded — skip".
 * The full seed run must use findBillsByInvoiceNumbers below instead — never
 * this function once per cast row (15 GETs where 1 suffices).
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
 * Bill check-by-reference — BATCHED form for the full seed run. ONE call
 * covers every cast row via the documented optimised comma-separated param:
 *   GET /Invoices?InvoiceNumbers=TT-8841,BPM-2210,...&page=1
 * Returns a Map keyed by every requested reference (empty array = ABSENT).
 * ACCPAY filtering happens client-side (the param has no Type filter).
 */
export async function findBillsByInvoiceNumbers(
  accessToken: string,
  invoiceNumbers: string[],
): Promise<Map<string, XeroInvoice[]>> {
  const param = encodeURIComponent(invoiceNumbers.join(","));
  const data = await apiGet<{ Invoices?: XeroInvoice[] }>(
    accessToken,
    `/Invoices?InvoiceNumbers=${param}&page=1`,
  );
  const byNumber = new Map<string, XeroInvoice[]>();
  for (const ref of invoiceNumbers) byNumber.set(ref, []);
  for (const inv of data.Invoices ?? []) {
    if (inv.Type !== undefined && inv.Type !== "ACCPAY") continue;
    byNumber.get(inv.InvoiceNumber)?.push(inv);
  }
  return byNumber;
}

/**
 * Fetch the PO list ONCE per run. No documented `where` support on
 * /PurchaseOrders — page through and match client-side. Paging is enforced by
 * default; one page of 100 covers the whole 15-PO cast. If the org ever holds
 * more than 100 POs, walk pages until the pagination pageCount.
 */
export async function fetchPurchaseOrdersPage(
  accessToken: string,
): Promise<XeroPurchaseOrder[]> {
  const data = await apiGet<{ PurchaseOrders?: XeroPurchaseOrder[] }>(
    accessToken,
    "/PurchaseOrders?page=1&pageSize=100",
  );
  return data.PurchaseOrders ?? [];
}

/**
 * PO check-by-reference — a PURE client-side match against the PREFETCHED
 * list (no network call). Call fetchPurchaseOrdersPage exactly once per run
 * and reuse the list for all 15 cast rows.
 */
export function findPurchaseOrderByNumber(
  purchaseOrders: XeroPurchaseOrder[],
  poNumber: string,
): XeroPurchaseOrder | null {
  return (
    purchaseOrders.find((po) => po.PurchaseOrderNumber === poNumber) ?? null
  );
}

async function main(): Promise<void> {
  loadDotEnv(path.resolve(__dirname, "../../../../.env"));

  const accessToken = await getAccessToken();

  // Probe the demo star's three references.
  const contact = await findContactByName(accessToken, "Thameside Timber Ltd");
  console.log(
    `Contact "Thameside Timber Ltd": ${contact ? `EXISTS (${contact.ContactID})` : "ABSENT"}`,
  );

  const purchaseOrders = await fetchPurchaseOrdersPage(accessToken); // ONE list GET, reused below
  const po = findPurchaseOrderByNumber(purchaseOrders, "PO-1001");
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
