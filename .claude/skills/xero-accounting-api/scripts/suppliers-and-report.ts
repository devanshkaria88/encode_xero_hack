// .claude/skills/xero-accounting-api/scripts/suppliers-and-report.ts
//
// Contacts (the fields supplier matching needs) and the AgedPayablesByContact
// report (requires ContactID). Fetch-and-shape only — the fuzzy matching
// itself is the match engine's job (api/src/modules/), not this file's.

import { xeroFetch, type Pagination } from "./xero-fetch";

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export interface Contact {
  ContactID: string; // the ONLY stable key — do not key on Name
  Name: string; // max 255; no angle brackets, leading/trailing or repeated spaces
  EmailAddress?: string; // max 255; umlauts not supported
  ContactStatus?: "ACTIVE" | "ARCHIVED" | "GDPRREQUEST";
  /** Read-only: auto-set once any AP invoice exists for the contact. Never settable. */
  IsSupplier?: boolean;
}

export interface ContactsResponse {
  Contacts: Contact[];
  pagination?: Pagination;
}

/**
 * Optimised exact-match filter. Contacts' documented examples use single `=`
 * (where=Name="ABC limited") and are case- and accent-insensitive — never
 * append ToLower()/ToUpper(). Values are embedded in double quotes, so a name
 * containing `"` cannot go through `where`; use searchContacts() for those.
 *
 * Always pass `page`: unpaged GET /Contacts returns only a subset of fields.
 * Never use summaryOnly=true for supplier matching — it excludes IsSupplier.
 */
export async function findContactsByName(name: string): Promise<Contact[]> {
  const res = await xeroFetch<ContactsResponse>("/Contacts", {
    query: { where: `Name="${name}"`, page: 1 },
  });
  return res.Contacts;
}

export async function findContactsByEmail(email: string): Promise<Contact[]> {
  const res = await xeroFetch<ContactsResponse>("/Contacts", {
    query: { where: `EmailAddress="${email}"`, page: 1 },
  });
  return res.Contacts;
}

/**
 * Case-insensitive text search across Name, FirstName, LastName,
 * ContactNumber, CompanyNumber, EmailAddress — the raw-candidate source for
 * fuzzy supplier matching.
 */
export async function searchContacts(term: string, page = 1): Promise<ContactsResponse> {
  return xeroFetch<ContactsResponse>("/Contacts", {
    // Casing matches the docs' example (?SearchTerm=peter); param
    // case-sensitivity is UNVERIFIED — check before relying.
    query: { SearchTerm: term, page },
  });
}

// ---------------------------------------------------------------------------
// Reports — Aged Payables By Contact (GET only; ContactID is REQUIRED)
// ---------------------------------------------------------------------------

export interface ReportCell {
  Value?: string;
  /** Data rows carry {Id:"invoiceID", Value:<guid>} for drill-down. */
  Attributes?: Array<{ Id: string; Value: string }>;
}

export interface ReportRow {
  RowType: "Header" | "Section" | "Row" | "SummaryRow";
  Title?: string;
  Cells?: ReportCell[];
  Rows?: ReportRow[]; // Section rows nest their data rows here
}

export interface Report {
  ReportID: string;
  ReportName: string;
  ReportType: string;
  ReportTitles?: string[];
  ReportDate?: string;
  UpdatedDateUTC?: string;
  Rows: ReportRow[];
}

export interface ReportResponse {
  Reports: Report[];
}

/**
 * Header columns for this report: Date, Reference, Due Date, (blank), Total,
 * Paid, Credited, Due. Defaults to "payments up to the end of the current
 * month" when `date` is omitted.
 */
export async function agedPayablesByContact(
  contactId: string,
  options: { date?: string; fromDate?: string; toDate?: string } = {},
): Promise<ReportResponse> {
  return xeroFetch<ReportResponse>("/Reports/AgedPayablesByContact", {
    query: {
      ContactID: contactId, // param casing follows the docs' own example URL
      date: options.date,
      fromDate: options.fromDate,
      toDate: options.toDate,
    },
  });
}

/** Flatten the nested Rows tree into data rows + the invoiceID attribute. */
export function reportDataRows(report: Report): Array<{ cells: string[]; invoiceId?: string }> {
  const out: Array<{ cells: string[]; invoiceId?: string }> = [];
  const walk = (rows: ReportRow[]): void => {
    for (const row of rows) {
      if (row.RowType === "Row" && row.Cells) {
        const invoiceId = row.Cells.flatMap((c) => c.Attributes ?? []).find(
          (a) => a.Id === "invoiceID",
        )?.Value;
        const entry: { cells: string[]; invoiceId?: string } = {
          cells: row.Cells.map((c) => c.Value ?? ""),
        };
        if (invoiceId) entry.invoiceId = invoiceId;
        out.push(entry);
      }
      if (row.Rows) walk(row.Rows);
    }
  };
  walk(report.Rows);
  return out;
}

// ---------------------------------------------------------------------------
// Demo entrypoint:
//   npx tsx suppliers-and-report.ts "Supplier Name"
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) throw new Error('Usage: npx tsx suppliers-and-report.ts "Supplier Name"');

  const matches = await findContactsByName(name);
  const supplier = matches[0];
  if (!supplier) {
    console.log(`No exact contact match for "${name}" — try searchContacts()`);
    return;
  }
  console.log(`Contact: ${supplier.Name} (${supplier.ContactID}) IsSupplier=${supplier.IsSupplier}`);

  const report = await agedPayablesByContact(supplier.ContactID);
  const firstReport = report.Reports[0];
  if (!firstReport) throw new Error("XeroEmptyResponse: no Reports element returned");
  for (const row of reportDataRows(firstReport)) {
    console.log(`- [${row.invoiceId ?? "no-id"}] ${row.cells.join(" | ")}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
