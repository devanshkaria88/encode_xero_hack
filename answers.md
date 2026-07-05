# Submission answers

## 1. Detailed explanation of the submission

Robyn is an autonomous back office for freelancers. It connects a real Google Calendar, a real Gmail inbox and a real Xero org, then closes the gap between work that happened and work that got invoiced.

- **Calendar to invoice.** Meetings sync in and match to clients by attendee email, then get priced from the contract on file.
- **Transcript scope capture.** Claude parses the call transcript, and a deterministic engine catches billable work that never made it onto an invoice. It prices it from the contract's own rules (rates, 30 minute minimum blocks, payment terms) and cites the exact clause.
- **Email to client.** New faces on the calendar are watched in the inbox. When a signed agreement PDF arrives, Robyn creates the client, files the contract and creates the Xero contact. Zero forms.

One rule everywhere: the LLM parses and proposes, it never decides and never sends. Decisions live in a pure TypeScript engine (79 unit tests, zero model calls) behind a five condition autonomy policy. Every action either writes to Xero or raises a review task, and everything lands on an audit trail.

We proved it live: a real meeting's transcript revealed 15 minutes of unbilled review work, and with zero clicks Robyn wrote invoice INV-0073 to Xero as AUTHORISED, with the decision note in History and the evidence attached. Minutes later a prospect emailed a signed agreement and Robyn onboarded them end to end.

## 2. How the project uses the Xero API

Automated invoicing under a policy gate. Robyn ensures the contact, creates the ACCREC invoice idempotently, authorises it, writes its decision note to the invoice History, attaches transcript and contract evidence, and has Xero email the invoice to the client. It also reads Payments, Quotes and Aged Receivables to spot broken retainers and money walking away.

## 3. Xero API endpoints used

- `POST /connect/token` (Custom Connection, client credentials)
- `GET /connections`, `GET /Organisation` (health probe)
- `GET /Contacts`, `POST /Contacts`
- `GET /Invoices`, `GET /Invoices/{id}`, `POST /Invoices` (create and authorise)
- `POST /Invoices/{id}/Email`
- `GET, PUT /Invoices/{id}/History`
- `GET, PUT /Invoices/{id}/Attachments/{filename}`
- `GET /Payments`, `PUT /Payments`
- `GET /Quotes`, `GET /Accounts`
- `GET /Reports/AgedReceivablesByContact`

## 4. Development platform

Claude Code (Anthropic) built the backend, engine and integrations. Cursor built the Next.js frontend against a committed OpenAPI contract. Claude models via the Anthropic API also run inside the product for parsing and the agent chat. Stack: NestJS, Next.js, PostgreSQL.

## 5. Xero OAuth 2.0 scopes

`accounting.invoices`, `accounting.contacts`, `accounting.attachments`, `accounting.payments`, `accounting.settings.read`, `accounting.reports.aged.read`, `accounting.reports.profitandloss.read`, `accounting.reports.balancesheet.read`
