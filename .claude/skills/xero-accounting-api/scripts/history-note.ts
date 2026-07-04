// .claude/skills/xero-accounting-api/scripts/history-note.ts
//
// History & Notes — NOT in the Xero MCP server; raw Accounting API only.
// PUT /{Endpoint}/{Guid}/history appends a note (this is how the agent's
// decision note lands on a bill or PO). Updating notes is documented as
// impossible; no delete method is documented, and records are created
// system-dated with user "System Generated" — the payload carries no date
// field (delete/backdate: UNVERIFIED — check before relying).

import { xeroFetch } from "./xero-fetch";

/** Document types that support history/notes (from the History & Notes page). */
export type HistoryParent =
  | "BankTransactions"
  | "BatchPayments"
  | "Contacts"
  | "CreditNotes"
  | "Invoices"
  | "Items"
  | "ManualJournals"
  | "Overpayments"
  | "Payments"
  | "Prepayments"
  | "PurchaseOrders"
  | "RepeatingInvoices"
  | "Quotes";

export interface HistoryRecord {
  /** Type of change, e.g. "Approved", "Edited". Notes are the only type you can create. */
  Changes?: string;
  DateUTC?: string; // "/Date(...)/" ms epoch
  User?: string; // "System Generated" for API-created records
  Details: string;
}

export interface HistoryResponse {
  HistoryRecords: HistoryRecord[];
}

const MAX_NOTE_LENGTH = 2500;

/** Append one or more notes. Exact documented shape: {"HistoryRecords":[{"Details":"..."}]} */
export async function appendNotes(
  endpoint: HistoryParent,
  guid: string,
  details: string[],
): Promise<HistoryResponse> {
  for (const note of details) {
    if (note.length > MAX_NOTE_LENGTH) {
      throw new Error(
        `NoteTooLong: ${note.length} chars — Xero caps history Details at ${MAX_NOTE_LENGTH}`,
      );
    }
  }
  return xeroFetch<HistoryResponse>(`/${endpoint}/${guid}/history`, {
    method: "PUT", // POST behaves identically; updates are impossible, no delete method is documented
    json: { HistoryRecords: details.map((d) => ({ Details: d })) },
  });
}

export async function getHistory(endpoint: HistoryParent, guid: string): Promise<HistoryRecord[]> {
  const res = await xeroFetch<HistoryResponse>(`/${endpoint}/${guid}/history`);
  return res.HistoryRecords;
}

// ---------------------------------------------------------------------------
// Demo entrypoint:
//   npx tsx history-note.ts <InvoiceID> "note text"
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [guid, note] = process.argv.slice(2);
  if (!guid || !note) {
    throw new Error('Usage: npx tsx history-note.ts <InvoiceID> "note text"');
  }
  await appendNotes("Invoices", guid, [note]);
  const records = await getHistory("Invoices", guid);
  console.log(`Document now has ${records.length} history records:`);
  for (const record of records) {
    console.log(`  [${record.User ?? "?"}] ${record.Changes ?? "Note"}: ${record.Details}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
