import { Injectable, Logger } from '@nestjs/common';
import * as api from './xero-api';
import { xeroHealthCheck, resolveTenant } from './xero-http';

// Thin NestJS surface over the raw Accounting API helpers. Business decisions
// live in the engine and services — this is I/O + a health probe only.
@Injectable()
export class XeroService {
  private readonly log = new Logger('XeroService');

  // Contacts
  ensureContact = api.ensureContact;
  findContactByEmail = api.findContactByEmail;
  findContactByName = api.findContactByName;
  listContacts = api.listContacts;

  // Invoices (ACCREC)
  createInvoice = api.createInvoice;
  authoriseInvoice = api.authoriseInvoice;
  getInvoice = api.getInvoice;
  findInvoiceByReference = api.findInvoiceByReference;
  listInvoices = api.listInvoices;

  // Evidence (raw API only)
  addHistoryNote = api.addHistoryNote;
  getHistory = api.getHistory;
  uploadAttachment = api.uploadAttachment;
  listAttachments = api.listAttachments;

  // The composed money-moment write (G2): contact + invoice + history + attachment.
  writeInvoice = api.writeInvoice;

  // Payments / quotes / accounts / reports
  listPayments = api.listPayments;
  createPayment = api.createPayment;
  listQuotes = api.listQuotes;
  listAccounts = api.listAccounts;
  defaultSalesAccountCode = api.defaultSalesAccountCode;
  agedReceivablesByContact = api.agedReceivablesByContact;
  invoiceDeepLink = api.invoiceDeepLink;

  async health(): Promise<{ ok: boolean; orgName: string | null; scope: string | null; reason: string | null }> {
    const h = await xeroHealthCheck();
    if (!h.ok) this.log.warn(`Xero not live: ${h.reason}`);
    return h;
  }

  async orgName(): Promise<string | null> {
    const t = await resolveTenant();
    return t?.name ?? null;
  }
}
