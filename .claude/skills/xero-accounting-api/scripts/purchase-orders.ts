// .claude/skills/xero-accounting-api/scripts/purchase-orders.ts
//
// Purchase Orders — NOT in the Xero MCP server (zero purchase-order tools);
// the raw Accounting API is the ONLY path. Create (PUT), list (explicit
// params — a generic `where` is not documented for POs), and status updates
// (POST), including marking billed. Transport facts only.

import {
  assertElementOk,
  xeroFetch,
  type Pagination,
  type StatusAttributed,
} from "./xero-fetch";

export type PurchaseOrderStatus = "DRAFT" | "SUBMITTED" | "AUTHORISED" | "BILLED" | "DELETED";

export interface PurchaseOrderLineItem {
  /** Same rule as invoices: on update, lines missing their LineItemID are deleted. */
  LineItemID?: string;
  Description: string; // a line can be Description-only
  Quantity?: number; // if Quantity is specified, UnitAmount must be too
  UnitAmount?: number; // POs round UnitAmount to FOUR decimal places
  AccountCode?: string;
  TaxType?: string;
  LineAmount?: number;
}

export interface PurchaseOrder {
  PurchaseOrderID?: string;
  /** Unique alphanumeric; auto-generated from org invoice settings when missing. */
  PurchaseOrderNumber?: string;
  /** Must reference an EXISTING contact — this endpoint never creates contacts. */
  Contact: { ContactID: string };
  Date?: string; // YYYY-MM-DD; defaults to today in the org timezone
  DeliveryDate?: string; // YYYY-MM-DD
  Reference?: string;
  Status?: PurchaseOrderStatus; // examples create DRAFT by default or pass AUTHORISED
  LineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax"; // Exclusive when omitted
  LineItems: PurchaseOrderLineItem[];
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  CurrencyCode?: string;
  UpdatedDateUTC?: string;
}

export interface PurchaseOrdersResponse {
  PurchaseOrders: Array<PurchaseOrder & StatusAttributed>;
  pagination?: Pagination;
}

// ---------------------------------------------------------------------------
// List — paging is enforced by default on POs (100/page, pageSize up to 1000)
// ---------------------------------------------------------------------------

export async function listPurchaseOrders(
  options: {
    status?: PurchaseOrderStatus; // explicit Status param, e.g. ?status=DRAFT
    dateFrom?: string; // YYYY-MM-DD
    dateTo?: string; // YYYY-MM-DD
    page?: number;
    pageSize?: number;
    modifiedSince?: Date;
  } = {},
): Promise<PurchaseOrdersResponse> {
  return xeroFetch<PurchaseOrdersResponse>("/PurchaseOrders", {
    query: {
      // Casing matches the docs' example URLs (?status=DRAFT&DateFrom=...);
      // param case-sensitivity is UNVERIFIED — check before relying.
      status: options.status,
      DateFrom: options.dateFrom,
      DateTo: options.dateTo,
      page: options.page ?? 1,
      pageSize: options.pageSize,
    },
    ifModifiedSince: options.modifiedSince,
  });
}

export async function getPurchaseOrder(purchaseOrderId: string): Promise<PurchaseOrder> {
  const res = await xeroFetch<PurchaseOrdersResponse>(`/PurchaseOrders/${purchaseOrderId}`);
  const po = res.PurchaseOrders[0];
  if (!po) throw new Error(`XeroNotFound: PurchaseOrder ${purchaseOrderId} not in response`);
  return po;
}

// ---------------------------------------------------------------------------
// Create — PUT creates only; POST creates or updates
// ---------------------------------------------------------------------------

export async function createPurchaseOrder(
  purchaseOrder: Omit<PurchaseOrder, "PurchaseOrderID">,
  idempotencyKey: string,
): Promise<PurchaseOrder> {
  const res = await xeroFetch<PurchaseOrdersResponse>("/PurchaseOrders", {
    method: "PUT",
    json: { PurchaseOrders: [purchaseOrder] },
    query: { summarizeErrors: false },
    idempotencyKey,
  });
  const created = res.PurchaseOrders[0];
  if (!created) {
    throw new Error("XeroEmptyResponse: PUT /PurchaseOrders returned no PurchaseOrders element");
  }
  return assertElementOk(created, `create PO ${purchaseOrder.PurchaseOrderNumber ?? "(auto)"}`);
}

// ---------------------------------------------------------------------------
// Status updates — POST with the new Status (official example: DRAFT -> DELETED)
// Marking billed = Status "BILLED" via the same mechanism. Xero publishes no
// PO transition table, so verify each transition against a live org.
// ---------------------------------------------------------------------------

export async function setPurchaseOrderStatus(
  purchaseOrderId: string,
  status: PurchaseOrderStatus,
  idempotencyKey: string,
): Promise<PurchaseOrder> {
  const res = await xeroFetch<PurchaseOrdersResponse>(`/PurchaseOrders/${purchaseOrderId}`, {
    method: "POST",
    json: { PurchaseOrders: [{ PurchaseOrderID: purchaseOrderId, Status: status }] },
    idempotencyKey,
  });
  const updated = res.PurchaseOrders[0];
  if (!updated) {
    throw new Error("XeroEmptyResponse: POST /PurchaseOrders returned no PurchaseOrders element");
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Demo entrypoint: npx tsx purchase-orders.ts  (lists first page of POs)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const res = await listPurchaseOrders({ page: 1, pageSize: 10 });
  console.log(`Fetched ${res.PurchaseOrders.length} purchase orders`);
  for (const po of res.PurchaseOrders) {
    console.log(`- ${po.PurchaseOrderNumber} ${po.Status} total=${po.Total}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
