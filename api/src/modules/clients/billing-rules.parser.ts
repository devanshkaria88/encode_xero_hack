// LLM edge: extract the contract's STRUCTURED billing rules (tiered weekly
// rates, minimum billing blocks, round-up blocks, cycle, payment terms) into
// strict, zod-validated JSON. Extraction only — the deterministic engine is
// the only thing that ever applies these numbers. A contract with no such
// rules returns null and everything downstream behaves exactly as before.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { loadConfig } from '../../config/env';
import { ContractBillingRules } from '../../entities';

const MODEL = 'claude-sonnet-5';

export const ContractBillingRulesSchema = z.object({
  baseRateGbp: z.number().positive(),
  reducedRateGbp: z.number().positive().nullish(),
  reducedRateThresholdHoursPerWeek: z.number().positive().nullish(),
  minBlockMinutes: z.number().int().positive().max(480).nullish(),
  roundUpToBlockMinutes: z.number().int().positive().max(480).nullish(),
  billingCycle: z.enum(['weekly', 'monthly']).nullish(),
  paymentTermsDays: z.number().int().min(0).max(365).nullish(),
});

const EnvelopeSchema = z.object({
  billing_rules: ContractBillingRulesSchema.nullable(),
});

function extractJson(text: string): unknown {
  // Tolerate ```json fences or prose around the object.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('LLM returned no JSON object');
  return JSON.parse(raw.slice(start, end + 1));
}

const SYSTEM =
  'You extract STRUCTURED billing rules from a consulting contract, and only ' +
  'rules the contract states explicitly. Return strict JSON. Never invent or ' +
  'infer numbers that are not written in the contract. If the contract has a ' +
  'plain single rate with no minimum blocks, no round-up rule and no tiered ' +
  'weekly rates, return {"billing_rules": null}.';

function userPrompt(rawText: string): string {
  return (
    'Contract:\n"""\n' +
    rawText.slice(0, 45000) +
    '\n"""\n\nReturn JSON: {"billing_rules": {"baseRateGbp": number, ' +
    '"reducedRateGbp": number|null, "reducedRateThresholdHoursPerWeek": number|null, ' +
    '"minBlockMinutes": number|null, "roundUpToBlockMinutes": number|null, ' +
    '"billingCycle": "weekly"|"monthly"|null, "paymentTermsDays": number|null} | null}\n' +
    '- baseRateGbp: the standard hourly rate in GBP. With tiered weekly rates this is ' +
    'the rate that applies when weekly hours are at or below the threshold.\n' +
    '- reducedRateGbp: the lower hourly rate applied to the whole week once weekly ' +
    'hours exceed the threshold, if the contract has one.\n' +
    '- reducedRateThresholdHoursPerWeek: the weekly hours figure the contract uses ' +
    'for that switch (strictly more than this number triggers the reduced rate).\n' +
    '- minBlockMinutes: the minimum billing block in minutes, when any session bills ' +
    'at least one block.\n' +
    '- roundUpToBlockMinutes: the block size in minutes that time beyond the first ' +
    'block rounds up to.\n' +
    '- billingCycle: "weekly" or "monthly" invoicing, if stated.\n' +
    '- paymentTermsDays: days until payment is due, if stated as a number of days.\n' +
    'Use null for any value the contract does not state.'
  );
}

/**
 * Parse the structured billing rules out of a contract. Returns null when the
 * contract does not state any. Throws only when the model output is invalid
 * twice in a row — callers treat that as "no rules extracted" plus an audit
 * row, never as a reason to reject the contract itself.
 */
export async function parseBillingRules(rawText: string): Promise<ContractBillingRules | null> {
  const client = new Anthropic({ apiKey: loadConfig().anthropicApiKey });
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            attempt === 0
              ? userPrompt(rawText)
              : `${userPrompt(rawText)}\n\nYour previous reply was not valid JSON for the schema. Reply with ONLY the JSON object, no prose, no code fences.`,
        },
      ],
    });
    const block = res.content.find((c) => c.type === 'text');
    const text = block && block.type === 'text' ? block.text : '';
    try {
      const parsed = EnvelopeSchema.parse(extractJson(text));
      return parsed.billing_rules;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Billing rules parse invalid after retry: ${String(lastErr).slice(0, 300)}`);
}
