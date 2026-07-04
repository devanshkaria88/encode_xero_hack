// Typed Xero Accounting API resource helpers (ACCREC / receivables — Robyn
// invoices clients). Transport + auth live in xero-http.ts. Business decisions
// live in the engine and services; this file is I/O only.
//
// Idempotency discipline: every write does check-by-reference first. ACCREC
// invoices carry a unique-ish Reference we own, so we filter on it before create.

import { xeroFetch, xeroRequest, Pagination, resolveTenant } from './xero-http';

// ---- Contacts -------------------------------------------------------------

export interface XeroContact {
  ContactID: string;
  Name: string;
  EmailAddress?: string;
  ContactStatus?: string;
  IsCustomer?: boolean;
  IsSupplier?: boolean;
}

export async function listContacts(page = 1, searchTerm?: string): Promise<XeroContact[]> {
  const res = await xeroFetch<{ Contacts?: XeroContact[] }>('/Contacts', {
    query: { page, ...(searchTerm ? { SearchTerm: searchTerm } : {}) },
  });
  return res.Contacts ?? [];
}

export async function findContactByEmail(email: string): Promise<XeroContact | null> {
  const where = `EmailAddress="${email.replace(/"/g, '')}"`;
  const res = await xeroFetch<{ Contacts?: XeroContact[] }>('/Contacts', {
    query: { where, page: 1 },
  });
  return res.Contacts?.[0] ?? null;
}

export async function findContactByName(name: string): Promise<XeroContact | null> {
  const where = `Name="${name.replace(/"/g, '')}"`;
  const res = await xeroFetch<{ Contacts?: XeroContact[] }>('/Contacts', {
    query: { where, page: 1 },
  });
  return res.Contacts?.[0] ?? null;
}

/** Idempotent: reuse an existing contact by email/name before creating. */
export async function ensureContact(
  name: string,
  email?: string,
): Promise<{ contact: XeroContact; created: boolean }> {
  if (email) {
    const byEmail = await findContactByEmail(email);
    if (byEmail) return { contact: byEmail, created: false };
  }
  const byName = await findContactByName(name);
  if (byName) return { contact: byName, created: false };

  const res = await xeroFetch<{ Contacts: XeroContact[] }>('/Contacts', {
    method: 'POST',
    json: { Contacts: [{ Name: name, ...(email ? { EmailAddress: email } : {}) }] },
    query: { summarizeErrors: 'false' },
    idempotencyKey: `contact:${name}:${email ?? ''}`.slice(0, 128),
  });
  return { contact: res.Contacts[0], created: true };
}

// ---- Invoices (ACCREC) ----------------------------------------------------

export interface XeroLineItem {
  Description: string;
  Quantity?: number;
  UnitAmount?: number;
  AccountCode?: string;
  TaxType?: string;
  LineAmount?: number;
  ItemCode?: string;
}

export interface XeroInvoice {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Type?: string;
  Contact?: { ContactID: string; Name?: string };
  Reference?: string;
  Status?: string;
  Date?: string;
  DueDate?: string;
  LineItems?: XeroLineItem[];
  LineAmountTypes?: string;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  AmountDue?: number;
  AmountPaid?: number;
  CurrencyCode?: string;
}

export interface CreateInvoiceInput {
  contactId: string;
  reference: string; // our stable idempotency reference
  lineItems: XeroLineItem[];
  date?: string; // YYYY-MM-DD
  dueDate?: string;
  status?: 'DRAFT' | 'SUBMITTED' | 'AUTHORISED';
  lineAmountTypes?: 'Exclusive' | 'Inclusive' | 'NoTax';
  currencyCode?: string;
}

/** Find an ACCREC invoice we previously created, by our Reference. */
export async function findInvoiceByReference(reference: string): Promise<XeroInvoice | null> {
  const where = `Type=="ACCREC" AND Reference=="${reference.replace(/"/g, '')}"`;
  const res = await xeroFetch<{ Invoices?: XeroInvoice[] }>('/Invoices', {
    query: { where, page: 1 },
  });
  return res.Invoices?.[0] ?? null;
}

export async function getInvoice(invoiceId: string): Promise<XeroInvoice | null> {
  const res = await xeroFetch<{ Invoices?: XeroInvoice[] }>(`/Invoices/${invoiceId}`, {});
  return res.Invoices?.[0] ?? null;
}

/** Idempotent create: returns the existing invoice if the Reference is taken. */
export async function createInvoice(
  input: CreateInvoiceInput,
): Promise<{ invoice: XeroInvoice; created: boolean }> {
  const existing = await findInvoiceByReference(input.reference);
  if (existing) return { invoice: existing, created: false };

  const payload: XeroInvoice = {
    Type: 'ACCREC',
    Contact: { ContactID: input.contactId },
    Reference: input.reference,
    LineItems: input.lineItems,
    LineAmountTypes: input.lineAmountTypes ?? 'Exclusive',
    Status: input.status ?? 'DRAFT',
    ...(input.date ? { Date: input.date } : {}),
    ...(input.dueDate ? { DueDate: input.dueDate } : {}),
    ...(input.currencyCode ? { CurrencyCode: input.currencyCode } : {}),
  };

  const res = await xeroFetch<{ Invoices: XeroInvoice[] }>('/Invoices', {
    method: 'POST',
    json: { Invoices: [payload] },
    query: { summarizeErrors: 'false' },
    idempotencyKey: `invoice:${input.reference}`.slice(0, 128),
  });
  return { invoice: res.Invoices[0], created: true };
}

/** Move a DRAFT/SUBMITTED invoice to AUTHORISED (raw API — MCP cannot). */
export async function authoriseInvoice(invoiceId: string): Promise<XeroInvoice> {
  const res = await xeroFetch<{ Invoices: XeroInvoice[] }>(`/Invoices/${invoiceId}`, {
    method: 'POST',
    json: { Invoices: [{ InvoiceID: invoiceId, Status: 'AUTHORISED' }] },
  });
  return res.Invoices[0];
}

export async function listInvoices(
  statuses?: string[],
  page = 1,
): Promise<{ invoices: XeroInvoice[]; pagination?: Pagination }> {
  const res = await xeroFetch<{ Invoices?: XeroInvoice[]; pagination?: Pagination }>('/Invoices', {
    query: { page, ...(statuses ? { Statuses: statuses.join(',') } : {}), summaryOnly: 'false' },
  });
  return { invoices: res.Invoices ?? [], pagination: res.pagination };
}

// ---- History & Notes (raw API only — no MCP tool) -------------------------

export async function addHistoryNote(
  endpoint: 'Invoices' | 'Contacts' | 'Quotes',
  guid: string,
  details: string,
): Promise<void> {
  await xeroRequest(`/${endpoint}/${guid}/history`, {
    method: 'PUT',
    json: { HistoryRecords: [{ Details: details.slice(0, 2500) }] },
  });
}

export async function getHistory(
  endpoint: 'Invoices' | 'Contacts' | 'Quotes',
  guid: string,
): Promise<Array<{ Changes?: string; DateUTC?: string; User?: string; Details?: string }>> {
  const res = await xeroFetch<{ HistoryRecords?: any[] }>(`/${endpoint}/${guid}/history`, {});
  return res.HistoryRecords ?? [];
}

// ---- Attachments (raw API only — no MCP tool) -----------------------------

const FORBIDDEN_FILENAME = /[<>:"/\\|?*\x00+]/;

export async function uploadAttachment(
  endpoint: 'Invoices' | 'Contacts' | 'Quotes',
  guid: string,
  filename: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<void> {
  if (FORBIDDEN_FILENAME.test(filename)) {
    throw new Error(`InvalidAttachmentFilename: "${filename}" contains a forbidden character`);
  }
  await xeroRequest(`/${endpoint}/${guid}/Attachments/${filename}`, {
    method: 'PUT',
    body: bytes,
    contentType: mimeType,
  });
}

export async function listAttachments(
  endpoint: 'Invoices' | 'Contacts' | 'Quotes',
  guid: string,
): Promise<Array<{ AttachmentID: string; FileName: string; MimeType: string; ContentLength: number }>> {
  const res = await xeroFetch<{ Attachments?: any[] }>(`/${endpoint}/${guid}/Attachments/`, {});
  return res.Attachments ?? [];
}

// ---- Payments (read for retainer cadence; write on demand) -----------------

export interface XeroPayment {
  PaymentID?: string;
  Date?: string;
  Amount?: number;
  Reference?: string;
  Status?: string;
  Invoice?: { InvoiceID?: string; InvoiceNumber?: string };
}

export async function listPayments(page = 1): Promise<XeroPayment[]> {
  const res = await xeroFetch<{ Payments?: XeroPayment[] }>('/Payments', { query: { page } });
  return res.Payments ?? [];
}

export async function createPayment(input: {
  invoiceId: string;
  accountCode: string;
  amount: number;
  date: string;
  reference: string;
}): Promise<XeroPayment> {
  const res = await xeroFetch<{ Payments: XeroPayment[] }>('/Payments', {
    method: 'PUT',
    json: {
      Invoice: { InvoiceID: input.invoiceId },
      Account: { Code: input.accountCode },
      Date: input.date,
      Amount: input.amount,
      Reference: input.reference,
    },
    idempotencyKey: `payment:${input.reference}`.slice(0, 128),
  });
  return res.Payments[0];
}

// ---- Quotes (loop-3 detector: accepted quote never invoiced) --------------

export interface XeroQuote {
  QuoteID?: string;
  QuoteNumber?: string;
  Status?: string;
  Contact?: { ContactID: string; Name?: string };
  Total?: number;
  Date?: string;
  Reference?: string;
  LineItems?: XeroLineItem[];
}

export async function listQuotes(status?: string, page = 1): Promise<XeroQuote[]> {
  const res = await xeroFetch<{ Quotes?: XeroQuote[] }>('/Quotes', {
    query: { page, ...(status ? { Status: status } : {}) },
  });
  return res.Quotes ?? [];
}

// ---- Accounts (revenue account codes for invoice lines) -------------------

export interface XeroAccount {
  AccountID: string;
  Code: string;
  Name: string;
  Type: string;
  Class?: string;
  EnablePaymentsToAccount?: boolean;
}

export async function listAccounts(): Promise<XeroAccount[]> {
  const res = await xeroFetch<{ Accounts?: XeroAccount[] }>('/Accounts', {});
  return res.Accounts ?? [];
}

/** First sales/revenue account code, for ACCREC invoice lines. Falls back to 200. */
export async function defaultSalesAccountCode(): Promise<string> {
  try {
    const accounts = await listAccounts();
    const revenue = accounts.find(
      (a) => a.Type === 'REVENUE' || a.Class === 'REVENUE' || a.Code === '200',
    );
    return revenue?.Code ?? '200';
  } catch {
    return '200';
  }
}

// ---- Reports: Aged Receivables by Contact (leak strip) --------------------

export async function agedReceivablesByContact(contactId: string): Promise<any> {
  return xeroFetch<any>('/Reports/AgedReceivablesByContact', {
    query: { contactID: contactId },
  });
}

// ---- Deep link ------------------------------------------------------------

export async function invoiceDeepLink(invoiceId: string): Promise<string> {
  const t = await resolveTenant();
  // The go.xero.com deep link for a receivable invoice.
  return `https://go.xero.com/app/${t?.id ? '' : ''}invoicing/view/${invoiceId}`;
}
