// Pure engine I/O types. The engine takes plain data (never entities/repos) so
// it is deterministic and unit-testable with zero infrastructure. Services map
// entities -> these inputs and apply the outputs.

import { ProposalLine } from '../../entities/shapes';

export type RateUnit = 'HOUR' | 'DAY' | 'FIXED';

export interface EngineAttendee {
  email: string;
  name?: string;
  organizer?: boolean;
}

export interface EngineClient {
  id: string;
  name: string;
  emails: string[];
  autonomyEnabled: boolean;
  hasContractOnFile: boolean;
}

export type MatchKind = 'PERSONAL' | 'MATCHED' | 'AMBIGUOUS' | 'UNKNOWN';

export interface MatchResult {
  kind: MatchKind;
  matchedClientId: string | null;
  candidateClientIds: string[];
  externalAttendees: EngineAttendee[];
  unknownAttendees: EngineAttendee[]; // external + not matched to any client
}

export interface BillingInput {
  rate: number | null;
  rateUnit: RateUnit | null;
  currency: string;
  clauseLabel: string | null; // e.g. "Clause 3.1"
  clauseText: string | null; // verbatim
  hasContract: boolean;
}

export interface ScopeItemInput {
  description: string;
  estHours: number;
  evidenceQuote: string;
  billable: boolean;
}

export interface CalendarBlock {
  label: string; // "Tue 3 Jun, 14:00–15:30"
  durationHours: number;
  meetingId: string;
}

export interface BuildProposalInput {
  block: CalendarBlock;
  billing: BillingInput;
  scopeItems: ScopeItemInput[];
  taxRatePct: number; // e.g. 20 for UK VAT
  accountCode?: string;
}

export interface BuiltProposal {
  lines: ProposalLine[];
  subtotal: number;
  taxTotal: number;
  total: number;
  currency: string;
  // True if any billable scope item was added — those always require review.
  hasTranscriptScope: boolean;
}

export interface PolicyInput {
  autonomyEnabled: boolean;
  hasContractOnFile: boolean;
  matchKind: MatchKind;
  amount: number;
  contractTermsMaxAmount: number | null; // cap if the contract states one
  hasUnreviewedScope: boolean;
}
