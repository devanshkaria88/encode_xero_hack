// Strongly-typed shapes for jsonb columns. These are the payloads the LLM
// edges produce (validated by zod before they ever land here) and the engine
// consumes. Kept in one place so entities, DTOs and the engine agree.

import { ProvenanceKind, BillingSource } from './enums';

export interface ClauseRef {
  ref: string; // e.g. "Clause 3.1"
  text: string; // verbatim clause text
}

export interface ContractParsed {
  rate: number | null; // hourly/day rate in the contract currency
  rate_unit: 'HOUR' | 'DAY' | 'FIXED' | null;
  currency: string; // ISO 4217, e.g. "GBP"
  payment_terms: string | null; // e.g. "Net 14"
  scope_summary: string | null;
  clauses: ClauseRef[];
}

export interface BillingProfile {
  rate: number | null;
  rate_unit: 'HOUR' | 'DAY' | 'FIXED' | null;
  currency: string;
  cadence: string | null; // e.g. "monthly retainer", "per-project"
  terms: string | null;
  source: BillingSource;
  provenance: string; // human-readable e.g. "Contract clause 3.1"
}

export interface TranscriptScopeItem {
  description: string;
  est_hours: number;
  evidence_quote: string; // verbatim line from the transcript
  billable: boolean; // LLM proposal only; engine re-checks against policy
}

export interface TranscriptParsed {
  summary: string | null;
  action_points: string[];
  scope_items: TranscriptScopeItem[];
}

// The provenance chip on an invoice line — every value keeps its citation.
export interface LineProvenance {
  kind: ProvenanceKind;
  label: string; // short chip label e.g. "Clause 3.1", "Transcript 04:12"
  detail: string; // the verbatim quote / clause text / calendar block detail
  source_ref?: string; // meeting id, contract id, quote id, etc.
}

export interface ProposalLine {
  description: string;
  quantity: number; // hours or units
  unit_amount: number; // rate per unit
  account_code?: string; // Xero revenue account code
  tax_type?: string;
  line_amount: number; // quantity * unit_amount (pre-tax)
  // A line can cite more than one source — e.g. hours from the calendar block
  // AND the rate from a contract clause. Every chip renders on the card.
  provenance: LineProvenance[];
}

export interface PolicyResult {
  auto: boolean; // may Robyn send without asking?
  reasons: string[]; // every reason the gate passed / failed, rendered on the card
}

// A fuzzy client-match proposal from the LLM (never a decision).
export interface MatchProposal {
  client_id: string;
  client_name: string;
  confidence: number; // 0..1
  reason: string;
}

// PotentialClient agreement evidence
export interface AgreementEvidence {
  email_msg_id: string;
  quote: string; // verbatim line indicating agreement
  from: string;
  subject: string;
  received_at: string; // ISO
}

// Detection evidence — flexible per detector type
export interface DetectionEvidence {
  summary: string;
  [key: string]: unknown;
}
