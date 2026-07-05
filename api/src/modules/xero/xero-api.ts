// Typed Xero Accounting API resource helpers (ACCREC / receivables — Robyn
// invoices clients). Transport + auth live in xero-http.ts. Business decisions
// live in the engine and services; this file is I/O only.
//
// Idempotency discipline: every write does check-by-reference first. ACCREC
// invoices carry a unique-ish Reference we own, so we filter on it before create.

import { xeroFetch, xeroRequest, assertElementOk, Pagination, resolveTenant } from './xero-http';

// Microsoft-JSON date parser ("/Date(ms+0000)/") for DueDate / Date /
// UpdatedDateUTC fields on read responses. Lives in xero-date.ts; re-exported
// here so xero-api stays the one import surface for callers.
export { parseXeroDate } from './xero-date';

// ---- Date helpers (YYYY-MM-DD in UTC) -------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

  // Xero rejects an AUTHORISED create with no DueDate; default to Net 14 from
  // the invoice date so both DRAFT and AUTHORISED writes always validate.
  const date = input.date ?? todayISO();
  const dueDate = input.dueDate ?? addDaysISO(date, 14);

  const payload: XeroInvoice = {
    Type: 'ACCREC',
    Contact: { ContactID: input.contactId },
    Reference: input.reference,
    LineItems: input.lineItems,
    LineAmountTypes: input.lineAmountTypes ?? 'Exclusive',
    Status: input.status ?? 'DRAFT',
    Date: date,
    DueDate: dueDate,
    ...(input.currencyCode ? { CurrencyCode: input.currencyCode } : {}),
  };

  const res = await xeroFetch<{
    Invoices: (XeroInvoice & {
      StatusAttributeString?: 'OK' | 'WARNING' | 'ERROR';
      ValidationErrors?: { Message?: string }[];
    })[];
  }>(
    '/Invoices',
    {
      method: 'POST',
      json: { Invoices: [payload] },
      query: { summarizeErrors: 'false' },
      idempotencyKey: `invoice:${input.reference}`.slice(0, 128),
    },
  );
  // summarizeErrors=false hides validation failures inside a 200 — assert the
  // element status so a bad write throws instead of returning a zero-GUID.
  const element = res.Invoices?.[0];
  if (!element) throw new Error('XeroInvoiceCreateFailed: no invoice element in response');
  assertElementOk(element, `create ACCREC invoice ${input.reference}`);
  return { invoice: element, created: true };
}

/** Move a DRAFT/SUBMITTED invoice to AUTHORISED (raw API — MCP cannot). */
export async function authoriseInvoice(invoiceId: string): Promise<XeroInvoice> {
  const res = await xeroFetch<{ Invoices: XeroInvoice[] }>(`/Invoices/${invoiceId}`, {
    method: 'POST',
    json: { Invoices: [{ InvoiceID: invoiceId, Status: 'AUTHORISED' }] },
  });
  return res.Invoices[0];
}

/**
 * Ask Xero to email the invoice to the contact's email address
 * (POST /Invoices/{InvoiceID}/Email with an empty JSON body; success is 204).
 * Requires an AUTHORISED invoice and a contact with an email address —
 * otherwise Xero rejects it and the error surfaces to the caller, who treats
 * the email step as best-effort (it must never undo an authorised invoice).
 */
export async function emailInvoice(invoiceId: string): Promise<void> {
  await xeroRequest(`/Invoices/${invoiceId}/Email`, {
    method: 'POST',
    json: {},
  });
}

export async function listInvoices(
  statuses?: string[],
  page = 1,
): Promise<{ invoices: XeroInvoice[]; pagination?: Pagination }> {
  const res = await xeroFetch<{ Invoices?: XeroInvoice[]; pagination?: Pagination }>('/Invoices', {
    query: {
      page,
      pageSize: 100, // explicit (matches the API default) so paging math is deterministic
      ...(statuses ? { Statuses: statuses.join(',') } : {}),
      summaryOnly: 'false',
    },
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
  Date?: string; // Microsoft-JSON "/Date(ms+0000)/" — parse with parseXeroDate
  Amount?: number;
  Reference?: string;
  Status?: string; // AUTHORISED | DELETED
  PaymentType?: string; // ACCRECPAYMENT | ACCPAYPAYMENT | AR/AP credit-note & (pre|over)payment types
  Invoice?: { InvoiceID?: string; InvoiceNumber?: string };
}

export async function listPayments(page = 1): Promise<XeroPayment[]> {
  const res = await xeroFetch<{ Payments?: XeroPayment[] }>('/Payments', {
    query: { page, pageSize: 100 },
  });
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
  // The go.xero.com deep link for a receivable invoice (opens in the org UI).
  return `https://go.xero.com/app/invoicing/view/${invoiceId}`;
}

// ---- Composed write: the money moment (G2) --------------------------------
// One idempotent path used by BOTH the auto-send loop and the manual approve
// flow. Ensures the contact, creates the ACCREC invoice (draft or authorised),
// writes Robyn's decision note to History, and attaches the evidence. Takes
// plain data and returns plain data — callers persist. Every step is safe to
// re-run (check-by-reference on the invoice, overwrite-by-filename on attachments).

export interface WriteInvoiceEvidence {
  filename: string; // e.g. "robyn-evidence.txt" (no < > : " / \ | ? * +)
  text: string;
  mimeType?: string; // default text/plain
}

export interface WriteInvoiceInput {
  clientName: string;
  clientEmail?: string;
  existingContactId?: string; // reuse if we already know it
  reference: string; // stable idempotency key -> Xero Reference
  lines: XeroLineItem[];
  currency?: string;
  date?: string;
  dueDate?: string;
  authorise: boolean; // false => leave DRAFT; true => AUTHORISED (sent)
  decisionNote: string; // Robyn's reasoning -> History & Notes
  evidence?: WriteInvoiceEvidence[]; // transcript excerpt + contract clause
}

export interface WriteInvoiceResult {
  contactId: string;
  contactCreated: boolean;
  invoiceId: string;
  invoiceNumber: string | null;
  status: string | null;
  total: number | null;
  deepLink: string;
  alreadyExisted: boolean;
}

export async function writeInvoice(input: WriteInvoiceInput): Promise<WriteInvoiceResult> {
  // 1. Contact (idempotent)
  let contactId = input.existingContactId ?? null;
  let contactCreated = false;
  if (!contactId) {
    const { contact, created } = await ensureContact(input.clientName, input.clientEmail);
    contactId = contact.ContactID;
    contactCreated = created;
  }

  // 2. Invoice (idempotent by Reference)
  const { invoice, created } = await createInvoice({
    contactId,
    reference: input.reference,
    lineItems: input.lines,
    currencyCode: input.currency,
    date: input.date,
    dueDate: input.dueDate,
    status: input.authorise ? 'AUTHORISED' : 'DRAFT',
  });
  const invoiceId = invoice.InvoiceID as string;

  // 3. If it existed as DRAFT but we now want it AUTHORISED, walk it up.
  let status = invoice.Status ?? null;
  if (input.authorise && status !== 'AUTHORISED' && status !== 'PAID') {
    const authed = await authoriseInvoice(invoiceId);
    status = authed.Status ?? status;
  }

  // 4. Robyn's decision note -> History (raw API; no MCP tool).
  try {
    await addHistoryNote('Invoices', invoiceId, input.decisionNote);
  } catch {
    /* history is best-effort; never block the money moment on a note */
  }

  // 5. Evidence attachments -> raw API (overwrite-by-filename is idempotent).
  for (const ev of input.evidence ?? []) {
    try {
      await uploadAttachment(
        'Invoices',
        invoiceId,
        ev.filename,
        new TextEncoder().encode(ev.text),
        ev.mimeType ?? 'text/plain',
      );
    } catch {
      /* attachment is best-effort evidence */
    }
  }

  return {
    contactId,
    contactCreated,
    invoiceId,
    invoiceNumber: invoice.InvoiceNumber ?? null,
    status,
    total: invoice.Total ?? null,
    deepLink: await invoiceDeepLink(invoiceId),
    alreadyExisted: !created,
  };
}
