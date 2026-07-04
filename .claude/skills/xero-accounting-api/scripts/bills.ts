// .claude/skills/xero-accounting-api/scripts/bills.ts
//
// ACCPAY bills on the /Invoices endpoint: filtered list (where/order/page),
// create (PUT), and the DRAFT -> SUBMITTED -> AUTHORISED status walk (POST).
// Shapes trimmed to the fields this project reads/writes. Transport facts
// only — matching and approval decisions live in api/src/modules/.

import { assertElementOk, xeroFetch, type Pagination, type StatusAttributed } from "./xero-fetch";

// ---------------------------------------------------------------------------
// Trimmed shapes
// ---------------------------------------------------------------------------

export type InvoiceStatus = "DRAFT" | "SUBMITTED" | "AUTHORISED" | "PAID" | "VOIDED" | "DELETED";
export type LineAmountTypes = "Exclusive" | "Inclusive" | "NoTax";

export interface BillLineItem {
  /** Omit on create. On update: any existing line whose LineItemID is missing
   *  from a supplied LineItems array is DELETED. Lines supplied without a
   *  LineItemID are created as new lines. */
  LineItemID?: string;
  Description: string; // 1..4000 chars; a line can be Description-only
  Quantity?: number;
  UnitAmount?: number; // rounded to 2dp unless the request uses ?unitdp=4
  AccountCode?: string;
  TaxType?: string; // override only when the AccountCode default is wrong
  LineAmount?: number;
}

export interface Bill {
  InvoiceID?: string;
  Type: "ACCPAY";
  Contact: { ContactID: string }; // only ContactID on create/update
  Date?: string; // YYYY-MM-DD; defaults to today in the org timezone
  DueDate?: string; // YYYY-MM-DD
  /** NON-unique for ACCPAY — displays as "Reference" in the Xero UI. Max 255. */
  InvoiceNumber?: string;
  Status?: InvoiceStatus; // defaults to DRAFT on create
  LineAmountTypes?: LineAmountTypes; // defaults to Exclusive when omitted
  LineItems: BillLineItem[];
  SubTotal?: number;
  TotalTax?: number;
  Total?: number; // SubTotal + TotalTax (computed)
  AmountDue?: number;
  AmountPaid?: number;
  CurrencyCode?: string; // defaults to the org base currency
  UpdatedDateUTC?: string; // "/Date(1439434356790)/" — unix ms inside
}

export interface InvoicesResponse {
  Invoices: Array<Bill & StatusAttributed>;
  pagination?: Pagination;
}

// ---------------------------------------------------------------------------
// List bills — where/order/page
// ---------------------------------------------------------------------------

/**
 * where strings use double quotes and == (official invoice filter example:
 * Type=="ACCPAY" AND Status=="AUTHORISED"). Percent-encoding is handled by the
 * helper's query serialiser. Always page: paged responses include full
 * LineItems; unpaged multi-invoice GETs return NO line details.
 */
export async function listBills(
  options: {
    status?: InvoiceStatus;
    page?: number;
    pageSize?: number; // default 100, max 1000
    modifiedSince?: Date;
  } = {},
): Promise<InvoicesResponse> {
  const where = options.status
    ? `Type=="ACCPAY" AND Status=="${options.status}"`
    : `Type=="ACCPAY"`;
  return xeroFetch<InvoicesResponse>("/Invoices", {
    query: {
      where,
      // Optimised order fields on Invoices: InvoiceId, UpdatedDateUTC, Date.
      order: "UpdatedDateUTC ASC",
      page: options.page ?? 1,
      pageSize: options.pageSize,
    },
    ifModifiedSince: options.modifiedSince,
  });
}

// ---------------------------------------------------------------------------
// Create — PUT creates only; POST creates or updates
// ---------------------------------------------------------------------------

/**
 * Creates a bill (status defaults to DRAFT). summarizeErrors=false means a
 * validation failure comes back as HTTP 200 with a per-element
 * StatusAttributeString of ERROR — always assert it.
 *
 * The idempotency key must be stable per logical write and persisted by the
 * caller (Xero caches it for 6 minutes; same key + different body → 400).
 */
export async function createBill(
  bill: Omit<Bill, "InvoiceID">,
  idempotencyKey: string,
): Promise<Bill> {
  const res = await xeroFetch<InvoicesResponse>("/Invoices", {
    method: "PUT",
    json: { Invoices: [bill] },
    query: { summarizeErrors: false, unitdp: 4 },
    idempotencyKey,
  });
  const created = res.Invoices[0];
  if (!created) throw new Error("XeroEmptyResponse: PUT /Invoices returned no Invoices element");
  return assertElementOk(created, `create bill ${bill.InvoiceNumber ?? "(no number)"}`);
}

// ---------------------------------------------------------------------------
// Status transitions — POST /Invoices/{InvoiceID}
// ---------------------------------------------------------------------------

/**
 * Legal transitions (from the official Invoices status table):
 *   DRAFT     -> DRAFT | SUBMITTED | AUTHORISED | DELETED
 *   SUBMITTED -> SUBMITTED | AUTHORISED | DRAFT | DELETED
 *   AUTHORISED -> AUTHORISED | VOIDED   (never back to DRAFT/SUBMITTED)
 * PAID is system-set when fully paid — never write it. Status-only updates
 * send no LineItems array (sending one without every LineItemID deletes lines).
 */
export async function setBillStatus(
  invoiceId: string,
  status: "DRAFT" | "SUBMITTED" | "AUTHORISED" | "DELETED" | "VOIDED",
  idempotencyKey: string,
): Promise<Bill> {
  const res = await xeroFetch<InvoicesResponse>(`/Invoices/${invoiceId}`, {
    method: "POST",
    json: { Invoices: [{ InvoiceID: invoiceId, Status: status }] },
    idempotencyKey,
  });
  const updated = res.Invoices[0];
  if (!updated) throw new Error("XeroEmptyResponse: POST /Invoices returned no Invoices element");
  return updated;
}

// ---------------------------------------------------------------------------
// Demo entrypoint: npx tsx bills.ts  (lists first page of ACCPAY bills)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const res = await listBills({ page: 1, pageSize: 10 });
  console.log(`Fetched ${res.Invoices.length} bills (pagination:`, res.pagination, ")");
  for (const bill of res.Invoices) {
    console.log(`- ${bill.InvoiceNumber ?? "(no number)"} ${bill.Status} total=${bill.Total}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
