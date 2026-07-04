import { ApiProperty } from '@nestjs/swagger';
import {
  BillingSource,
  InvoiceProposalState,
  PotentialClientState,
} from '../../../entities';

// The billing profile Robyn derived for a client (rate + provenance).
export class BillingProfileDto {
  @ApiProperty({ type: Number, nullable: true, example: 150, description: 'Rate in the contract currency.' })
  rate!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['HOUR', 'DAY', 'FIXED'],
    example: 'HOUR',
    description: 'Whether the rate is hourly, per-day or a fixed fee.',
  })
  rateUnit!: 'HOUR' | 'DAY' | 'FIXED' | null;

  @ApiProperty({ type: String, example: 'GBP', description: 'ISO 4217 currency code.' })
  currency!: string;

  @ApiProperty({ type: String, nullable: true, example: 'monthly retainer', description: 'Billing cadence, if known.' })
  cadence!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Net 14', description: 'Payment terms.' })
  terms!: string | null;

  @ApiProperty({
    enum: BillingSource,
    example: BillingSource.CONTRACT,
    description: 'CONTRACT (parsed from a signed document) or INFERRED (from history).',
  })
  source!: BillingSource;

  @ApiProperty({
    type: String,
    example: 'Clause 3.1',
    description: 'Human-readable citation for where these terms came from.',
  })
  provenance!: string;
}

// Compact contract summary shown on the client card / list row.
export class ContractSummaryDto {
  @ApiProperty({ type: Boolean, example: true, description: 'Whether a parsed contract is on file for this client.' })
  hasContract!: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'Consulting Agreement 2026' })
  title!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 150 })
  rate!: number | null;

  @ApiProperty({ type: String, nullable: true, enum: ['HOUR', 'DAY', 'FIXED'], example: 'HOUR' })
  rateUnit!: 'HOUR' | 'DAY' | 'FIXED' | null;

  @ApiProperty({ type: String, nullable: true, example: 'GBP' })
  currency!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Net 14' })
  terms!: string | null;

  @ApiProperty({ enum: BillingSource, nullable: true, example: BillingSource.CONTRACT })
  source!: BillingSource | null;
}

// One clause of a parsed contract (the clause viewer).
export class ClauseDto {
  @ApiProperty({ type: String, example: 'Clause 3.1', description: 'The clause reference.' })
  ref!: string;

  @ApiProperty({ type: String, example: 'The Consultant shall be paid at a rate of GBP 150 per hour.' })
  text!: string;
}

// The full parsed contract — GET /clients/:id/contract.
export class ContractDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  clientId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Consulting Agreement 2026' })
  title!: string | null;

  @ApiProperty({ type: String, example: 'pasted-contract', description: 'Source file reference for the contract.' })
  fileRef!: string;

  @ApiProperty({ type: String, nullable: true, description: 'The raw contract text so the viewer can highlight in place.' })
  rawText!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 150 })
  rate!: number | null;

  @ApiProperty({ type: String, nullable: true, enum: ['HOUR', 'DAY', 'FIXED'], example: 'HOUR' })
  rateUnit!: 'HOUR' | 'DAY' | 'FIXED' | null;

  @ApiProperty({ type: String, example: 'GBP' })
  currency!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Net 14' })
  paymentTerms!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Ongoing UX consulting on a time basis.' })
  scopeSummary!: string | null;

  @ApiProperty({ type: [ClauseDto], description: 'Every parsed clause, each keeping its citation.' })
  clauses!: ClauseDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

// One historical invoice proposal for a client (invoice history).
export class InvoiceHistoryItemDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: InvoiceProposalState, example: InvoiceProposalState.SENT })
  state!: InvoiceProposalState;

  @ApiProperty({ type: Number, example: 900, description: 'Invoice total (incl. tax).' })
  total!: number;

  @ApiProperty({ type: String, example: 'GBP' })
  currency!: string;

  @ApiProperty({ type: String, nullable: true, example: 'ROBYN-8f21ac3d', description: 'Idempotency reference used in Xero.' })
  reference!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'INV-0042' })
  xeroInvoiceNumber!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Deep-link into the Xero invoice, once written.' })
  xeroDeepLink!: string | null;

  @ApiProperty({ type: Boolean, example: false, description: 'Whether Robyn sent this automatically (autonomy ON).' })
  autoSent!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

// A row on the Clients screen — GET /clients.
export class ClientListItemDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, example: 'Fenwick Interiors' })
  name!: string;

  @ApiProperty({ type: [String], example: ['ops@fenwick.co.uk'] })
  emails!: string[];

  @ApiProperty({ type: String, nullable: true, description: 'Xero ContactID once created; null until then.' })
  xeroContactId!: string | null;

  @ApiProperty({ type: Boolean, example: false, description: 'Per-client auto-send policy.' })
  autonomyEnabled!: boolean;

  @ApiProperty({ type: BillingProfileDto, nullable: true })
  billingProfile!: BillingProfileDto | null;

  @ApiProperty({ type: ContractSummaryDto })
  contract!: ContractSummaryDto;

  @ApiProperty({ type: Number, example: 1200, description: 'Sum of DRAFT/IN_REVIEW proposal totals — money not yet invoiced.' })
  unbilledExposureGbp!: number;

  @ApiProperty({ type: Number, example: 6, description: 'Number of invoices sent for this client.' })
  invoiceHistoryCount!: number;
}

// GET /clients/:id — full client detail with contract clauses and history.
export class ClientDetailDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, example: 'Fenwick Interiors' })
  name!: string;

  @ApiProperty({ type: [String], example: ['ops@fenwick.co.uk'] })
  emails!: string[];

  @ApiProperty({ type: String, nullable: true })
  xeroContactId!: string | null;

  @ApiProperty({ type: Boolean, example: false })
  autonomyEnabled!: boolean;

  @ApiProperty({ type: BillingProfileDto, nullable: true })
  billingProfile!: BillingProfileDto | null;

  @ApiProperty({ type: ContractDto, nullable: true, description: 'The parsed contract on file, if any.' })
  contract!: ContractDto | null;

  @ApiProperty({ type: [InvoiceHistoryItemDto], description: 'Invoices sent for this client, newest first.' })
  invoiceHistory!: InvoiceHistoryItemDto[];

  @ApiProperty({ type: Number, example: 1200 })
  unbilledExposureGbp!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

// A prospect in the potential-client queue — GET /potential-clients.
export class PotentialClientDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, example: 'Priya Nair' })
  displayName!: string;

  @ApiProperty({ type: [String], example: ['priya.nair@gmail.com'] })
  emails!: string[];

  @ApiProperty({ enum: PotentialClientState, example: PotentialClientState.QUEUED })
  state!: PotentialClientState;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'The meeting this prospect was first seen on.' })
  firstSeenMeetingId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "let's go ahead",
    description: 'Verbatim agreement quote, once an agreement email is detected.',
  })
  evidenceQuote!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'priya.nair@gmail.com', description: 'Sender of the agreement email, if detected.' })
  evidenceFrom!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Set to the new Client id once promoted.' })
  promotedClientId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Last time Robyn polled this prospect\'s inbox.' })
  lastPolledAt!: string | null;
}

// Result of promoting a prospect into a real client — POST .../confirm.
export class PromoteResultDto {
  @ApiProperty({ type: String, format: 'uuid', description: 'The id of the newly created Client.' })
  clientId!: string;

  @ApiProperty({ type: String, example: 'Priya Nair' })
  clientName!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Xero ContactID if the write succeeded; null if Xero was unavailable.' })
  xeroContactId!: string | null;

  @ApiProperty({ type: Boolean, example: true, description: 'True when a new Xero contact was created (false if reused or Xero down).' })
  xeroContactCreated!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Non-fatal Xero error message when the contact could not be created live. Local promotion still completed.',
  })
  xeroError!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'The ATTACH_CONTRACT task raised for the new client.' })
  attachContractTaskId!: string | null;

  @ApiProperty({ type: PotentialClientDto, description: 'The prospect, now in PROMOTED state.' })
  potentialClient!: PotentialClientDto;
}

// Generic mutation acknowledgement (dismiss, autonomy toggle response reuse).
export class MutationResultDto {
  @ApiProperty({ type: Boolean, example: true })
  ok!: boolean;

  @ApiProperty({ type: String, example: 'Prospect dismissed.' })
  message!: string;
}
