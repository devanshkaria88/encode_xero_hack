import { ChatToolsService } from './chat-tools.service';
import type { XeroService } from '../xero/xero.service';
import type { XeroInvoice } from '../xero/xero-api';

// list_unpaid_invoices only touches XeroService, so every repository/audit
// dependency can be a null stub. The point pinned here: outstanding/overdue
// totals and the count cover EVERY unpaid sale returned by Xero, while the
// row list is capped at 50 with truncated=true. Computing totals after the
// slice (the old bug) silently shrank them once >50 invoices were unpaid.

function serviceWith(invoices: XeroInvoice[]): ChatToolsService {
  const xero = {
    listInvoices: jest.fn(async () => ({ invoices })),
  } as unknown as XeroService;
  return new ChatToolsService(
    null as never, // meetings
    null as never, // clients
    null as never, // proposals
    null as never, // detections
    null as never, // tasks
    xero,
    null as never, // audit
  );
}

function inv(over: Partial<XeroInvoice> = {}): XeroInvoice {
  return {
    Type: 'ACCREC',
    Status: 'AUTHORISED',
    AmountDue: 10,
    Total: 10,
    DueDate: '2099-01-01',
    ...over,
  } as XeroInvoice;
}

async function runTool(svc: ChatToolsService): Promise<any> {
  const out = await svc.execute('list_unpaid_invoices', { page: 1 });
  expect(out.isError).toBe(false);
  return JSON.parse(out.content);
}

describe('list_unpaid_invoices', () => {
  it('computes count and totals over ALL unpaid sales, slicing only the rows', async () => {
    // 55 future-due at £10 plus 5 overdue at £20 placed at the END of the
    // list, past the 50-row cap. Slice-then-sum would report outstanding 500
    // and overdue 0; the fix must see all 60.
    const future = Array.from({ length: 55 }, (_, i) =>
      inv({ InvoiceNumber: `INV-F${i}`, AmountDue: 10 }),
    );
    const overdue = Array.from({ length: 5 }, (_, i) =>
      inv({ InvoiceNumber: `INV-O${i}`, AmountDue: 20, DueDate: '2020-01-01' }),
    );
    const result = await runTool(serviceWith([...future, ...overdue]));

    expect(result.count).toBe(60);
    expect(result.outstandingGbp).toBe(55 * 10 + 5 * 20); // 650
    expect(result.overdueGbp).toBe(100);
    expect(result.truncated).toBe(true);
    expect(result.invoices).toHaveLength(50);
  });

  it('reports truncated=false when everything fits in the row list', async () => {
    const result = await runTool(
      serviceWith([
        inv({ AmountDue: 40 }),
        inv({ AmountDue: 60, DueDate: '2020-01-01' }),
      ]),
    );
    expect(result.count).toBe(2);
    expect(result.outstandingGbp).toBe(100);
    expect(result.overdueGbp).toBe(60);
    expect(result.truncated).toBe(false);
    expect(result.invoices).toHaveLength(2);
  });

  it('excludes bills and settled invoices from count and totals alike', async () => {
    const result = await runTool(
      serviceWith([
        inv({ AmountDue: 25 }),
        inv({ Type: 'ACCPAY', AmountDue: 999 }), // a bill, not a sale
        inv({ AmountDue: 0, Total: 300 }), // nothing left to pay
      ]),
    );
    expect(result.count).toBe(1);
    expect(result.outstandingGbp).toBe(25);
    expect(result.invoices).toHaveLength(1);
  });
});
