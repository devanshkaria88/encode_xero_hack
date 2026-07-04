// Domain enums. These are the *only* legal states — every transition either
// writes to Xero or raises a Task. No silent third path.

export enum MeetingState {
  DETECTED = 'DETECTED',
  AWAITING_TRANSCRIPT = 'AWAITING_TRANSCRIPT',
  TRANSCRIPT_ATTACHED = 'TRANSCRIPT_ATTACHED',
  CLIENT_MATCHED = 'CLIENT_MATCHED',
  UNKNOWN_ATTENDEE = 'UNKNOWN_ATTENDEE',
  INVOICE_PROPOSED = 'INVOICE_PROPOSED',
  SENT = 'SENT',
  SKIPPED = 'SKIPPED',
}

export enum PotentialClientState {
  QUEUED = 'QUEUED',
  WATCHING = 'WATCHING',
  AGREEMENT_DETECTED = 'AGREEMENT_DETECTED',
  PROMOTED = 'PROMOTED',
  DISMISSED = 'DISMISSED',
}

export enum InvoiceProposalState {
  DRAFT = 'DRAFT', // built by the engine, not yet in Xero
  IN_REVIEW = 'IN_REVIEW', // waiting on a human (Task REVIEW_INVOICE)
  APPROVED = 'APPROVED', // human approved, about to write
  SENT = 'SENT', // written to Xero (draft or authorised)
  REJECTED = 'REJECTED',
}

export enum DetectionType {
  QUOTE_NOT_INVOICED = 'QUOTE_NOT_INVOICED',
  RETAINER_STOPPED = 'RETAINER_STOPPED',
  EXPENSE_NOT_RECHARGED = 'EXPENSE_NOT_RECHARGED',
}

export enum DetectionState {
  OPEN = 'OPEN',
  PROPOSED = 'PROPOSED',
  RESOLVED = 'RESOLVED',
  DISMISSED = 'DISMISSED',
}

export enum TaskType {
  PROVIDE_TRANSCRIPT = 'PROVIDE_TRANSCRIPT',
  CONFIRM_CLIENT_MATCH = 'CONFIRM_CLIENT_MATCH',
  REVIEW_INVOICE = 'REVIEW_INVOICE',
  CONFIRM_AGREEMENT = 'CONFIRM_AGREEMENT',
  ATTACH_CONTRACT = 'ATTACH_CONTRACT',
}

export enum TaskState {
  OPEN = 'OPEN',
  RESOLVED = 'RESOLVED',
}

export enum TaskRefType {
  MEETING = 'MEETING',
  PROPOSAL = 'PROPOSAL',
  POTENTIAL_CLIENT = 'POTENTIAL_CLIENT',
  CLIENT = 'CLIENT',
  DETECTION = 'DETECTION',
}

// Where a value on an invoice line came from — this is the provenance chip.
export enum ProvenanceKind {
  CONTRACT_CLAUSE = 'CONTRACT_CLAUSE',
  TRANSCRIPT_QUOTE = 'TRANSCRIPT_QUOTE',
  CALENDAR_BLOCK = 'CALENDAR_BLOCK',
  LEDGER = 'LEDGER', // detector-sourced (quote / payment / expense)
}

export enum BillingSource {
  CONTRACT = 'CONTRACT',
  INFERRED = 'INFERRED',
}

export enum TranscriptSource {
  PASTED = 'PASTED',
  GRANOLA = 'GRANOLA',
  UPLOAD = 'UPLOAD',
}

export enum ConnectionKind {
  XERO = 'XERO',
  CALENDAR = 'CALENDAR',
  EMAIL = 'EMAIL',
}

export enum ConnectionStatus {
  LIVE = 'LIVE',
  FALLBACK = 'FALLBACK',
  DOWN = 'DOWN',
}

// The actor on an AuditEvent — Robyn (the deterministic engine / cron),
// the human operator, or the LLM edge (parse/propose only, never decides).
export enum AuditActor {
  ROBYN = 'ROBYN',
  HUMAN = 'HUMAN',
  LLM = 'LLM',
  XERO = 'XERO',
  SYSTEM = 'SYSTEM',
}
