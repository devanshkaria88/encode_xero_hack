import { z } from 'zod';

// Zod on every LLM output. Nothing unvalidated crosses this boundary. The LLM
// PARSES and PROPOSES only — the engine decides billed/unbilled downstream.

export const TranscriptScopeItemSchema = z.object({
  description: z.string().min(1),
  est_hours: z.number().min(0).max(1000),
  evidence_quote: z.string().min(1),
  billable: z.boolean(),
});

export const TranscriptParsedSchema = z.object({
  summary: z.string().nullable(),
  action_points: z.array(z.string()),
  scope_items: z.array(TranscriptScopeItemSchema),
});
export type TranscriptParsedLLM = z.infer<typeof TranscriptParsedSchema>;

export const ClauseSchema = z.object({ ref: z.string(), text: z.string() });

export const ContractParsedSchema = z.object({
  rate: z.number().nullable(),
  rate_unit: z.enum(['HOUR', 'DAY', 'FIXED']).nullable(),
  currency: z.string().default('GBP'),
  payment_terms: z.string().nullable(),
  scope_summary: z.string().nullable(),
  clauses: z.array(ClauseSchema),
});
export type ContractParsedLLM = z.infer<typeof ContractParsedSchema>;

export const AgreementClassificationSchema = z.object({
  agreement: z.boolean(),
  evidence_quote: z.string(),
  reasoning: z.string(),
});
export type AgreementClassificationLLM = z.infer<typeof AgreementClassificationSchema>;

export const MatchProposalSchema = z.object({
  client_id: z.string(),
  client_name: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
export const MatchProposalsSchema = z.object({ proposals: z.array(MatchProposalSchema) });
export type MatchProposalsLLM = z.infer<typeof MatchProposalsSchema>;
