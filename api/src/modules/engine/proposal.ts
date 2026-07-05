// Deterministic invoice-proposal maths. Given a calendar block, the client's
// billing profile (rate cited from a contract clause) and the transcript's
// billable scope items (each with a verbatim quote), build the invoice lines
// with full provenance and totals. Zero LLM: the LLM already produced the
// scope items upstream; here we only price and cite.
//
// When the contract carries structured billing rules (minimum billing block,
// round-up block, tiered weekly rates), each line's hours are quantised BEFORE
// pricing:   hours' = max(minBlock, ceil(hours * 60 / block) * block) / 60
// and the tier is picked from THIS proposal's total advisory hours. The
// whole-week reduced-rate rule is applied at proposal granularity; aggregating
// hours across separate proposals in the same week is out of scope.

import { ProposalLine, LineProvenance, ContractBillingRules } from '../../entities/shapes';
import { ProvenanceKind } from '../../entities/enums';
import { BuildProposalInput, BuiltProposal, RateUnit } from './types';

export function round2(n: number): number {
  // Avoid binary FP drift on money.
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const HOURS_PER_DAY = 8;

// Guard against FP drift when converting hours to minutes (0.6667h -> 40.002
// minutes must not count as a 41st minute; 0.5h -> 30 must stay one block).
const MINUTE_EPSILON = 1e-7;

/** Effective hourly rate used to price transcript scope items. */
function effectiveHourly(rate: number, unit: RateUnit): number {
  if (unit === 'DAY') return rate / HOURS_PER_DAY;
  return rate; // HOUR or FIXED treated as hourly-equivalent for extra scope
}

function baseLineQuantity(durationHours: number, unit: RateUnit): number {
  if (unit === 'DAY') return round2(durationHours / HOURS_PER_DAY);
  if (unit === 'FIXED') return 1;
  return round2(durationHours);
}

export interface QuantisedHours {
  hours: number; // quantised hours, the quantity that gets priced
  originalMinutes: number; // what was actually worked, in whole minutes
  quantisedMinutes: number; // what gets billed, in whole minutes
  changed: boolean; // did quantisation move the number?
  usedMinimumBlock: boolean; // true when the minimum-block floor kicked in
}

/**
 * Quantise a duration under the contract's billing rules:
 *   hours' = max(minBlockMinutes, ceil(hours*60 / block) * block) / 60
 * where block = roundUpToBlockMinutes (falling back to minBlockMinutes).
 * Pure and exact: 15 min -> 30 min, 40 min -> 60 min, 90 min -> 90 min.
 */
export function quantiseHours(hours: number, rules: ContractBillingRules): QuantisedHours {
  const block = rules.roundUpToBlockMinutes ?? rules.minBlockMinutes ?? null;
  const minBlock = rules.minBlockMinutes ?? null;
  const rawMinutes = hours * 60;
  const originalMinutes = Math.round(rawMinutes);

  if (block === null && minBlock === null) {
    return {
      hours,
      originalMinutes,
      quantisedMinutes: originalMinutes,
      changed: false,
      usedMinimumBlock: false,
    };
  }

  let minutes = rawMinutes;
  if (block !== null && block > 0) {
    minutes = Math.ceil(rawMinutes / block - MINUTE_EPSILON) * block;
  }
  if (minBlock !== null && minutes < minBlock) {
    minutes = minBlock;
  }
  // "Minimum block" is the story when the session itself was shorter than the
  // floor (15 min bills as the 30-minute minimum block); otherwise it is a
  // plain round-up to the next block (40 min bills as 60).
  const usedMinimumBlock = minBlock !== null && rawMinutes < minBlock - MINUTE_EPSILON;
  const quantisedMinutes = Math.round(minutes);
  return {
    hours: quantisedMinutes / 60,
    originalMinutes,
    quantisedMinutes,
    changed: quantisedMinutes !== originalMinutes,
    usedMinimumBlock,
  };
}

function rateProvenance(billing: BuildProposalInput['billing']): LineProvenance[] {
  if (billing.hasContract && billing.clauseLabel) {
    return [
      {
        kind: ProvenanceKind.CONTRACT_CLAUSE,
        label: billing.clauseLabel,
        detail: billing.clauseText ?? `Rate ${billing.rate} ${billing.currency}`,
      },
    ];
  }
  return [];
}

/** The chip explaining why 15 minutes bills as 30 — cited to the contract. */
function quantisationProvenance(
  q: QuantisedHours,
  rules: ContractBillingRules,
  clauseLabel: string | null,
): LineProvenance[] {
  if (!q.changed) return [];
  const cite = clauseLabel ? ` (${clauseLabel})` : '';
  const detail = q.usedMinimumBlock
    ? `${q.originalMinutes} min rounds up to the ${rules.minBlockMinutes}-minute minimum block${cite}`
    : `${q.originalMinutes} min rounds up to ${q.quantisedMinutes} min in ${
        rules.roundUpToBlockMinutes ?? rules.minBlockMinutes
      }-minute blocks${cite}`;
  return [
    {
      kind: ProvenanceKind.CONTRACT_CLAUSE,
      label: clauseLabel ?? 'Billing rules',
      detail,
    },
  ];
}

/** The chip explaining the reduced weekly tier, when it applies. */
function tierProvenance(
  reducedApplied: boolean,
  totalHours: number,
  rules: ContractBillingRules,
  clauseLabel: string | null,
): LineProvenance[] {
  if (!reducedApplied) return [];
  const cite = clauseLabel ? ` (${clauseLabel})` : '';
  return [
    {
      kind: ProvenanceKind.CONTRACT_CLAUSE,
      label: clauseLabel ?? 'Billing rules',
      detail:
        `Advisory time on this invoice is ${round2(totalHours)}h, over the ` +
        `${rules.reducedRateThresholdHoursPerWeek}-hour weekly threshold, so every hour ` +
        `bills at the reduced rate of ${rules.reducedRateGbp} GBP/hour${cite}`,
    },
  ];
}

export function buildProposal(input: BuildProposalInput): BuiltProposal {
  const { block, billing, scopeItems, taxRatePct } = input;
  const currency = billing.currency || 'GBP';
  const lines: ProposalLine[] = [];

  const rules = billing.rules ?? null;
  // Structured rules are hourly GBP by definition; they override the unit.
  const unit: RateUnit = rules ? 'HOUR' : (billing.rateUnit ?? 'HOUR');

  const billableScope = scopeItems.filter((s) => s.billable);

  // --- Quantise every duration first (identity when no rules) ---------------
  const baseQuant = rules ? quantiseHours(block.durationHours, rules) : null;
  const scopeQuants = rules ? billableScope.map((s) => quantiseHours(s.estHours, rules)) : null;

  // --- Pick the tier from THIS proposal's total advisory hours --------------
  let rate = billing.rate ?? 0;
  let reducedApplied = false;
  let totalAdvisoryHours = 0;
  if (rules && baseQuant && scopeQuants) {
    totalAdvisoryHours = baseQuant.hours + scopeQuants.reduce((s, q) => s + q.hours, 0);
    const threshold = rules.reducedRateThresholdHoursPerWeek ?? null;
    if (
      rules.reducedRateGbp != null &&
      threshold !== null &&
      totalAdvisoryHours > threshold + MINUTE_EPSILON
    ) {
      rate = rules.reducedRateGbp;
      reducedApplied = true;
    } else {
      rate = rules.baseRateGbp;
    }
  }

  const tierChips = rules
    ? tierProvenance(reducedApplied, totalAdvisoryHours, rules, billing.clauseLabel)
    : [];

  // --- Base line: the calendar time block -----------------------------------
  const qty = baseQuant ? round2(baseQuant.hours) : baseLineQuantity(block.durationHours, unit);
  const baseAmount = round2(qty * rate);
  const unitLabel = unit === 'DAY' ? 'day' : unit === 'FIXED' ? 'fixed' : 'hour';
  const baseProvenance: LineProvenance[] = [
    {
      kind: ProvenanceKind.CALENDAR_BLOCK,
      label: block.label,
      detail: `${round2(block.durationHours)}h calendar block`,
      source_ref: block.meetingId,
    },
    ...rateProvenance(billing),
    ...(rules && baseQuant ? quantisationProvenance(baseQuant, rules, billing.clauseLabel) : []),
    ...tierChips,
  ];
  // With rules the description shows the billed (quantised) hours; without,
  // the raw calendar hours exactly as before.
  const shownHours = rules ? qty : round2(block.durationHours);
  lines.push({
    description: `Consulting, ${block.label} (${shownHours}h @ ${
      rules ? rate : billing.rate ?? '?'
    } ${currency}/${unitLabel})`,
    quantity: qty,
    unit_amount: round2(rate),
    line_amount: baseAmount,
    account_code: input.accountCode,
    provenance: baseProvenance,
  });

  // --- Scope lines: billable extras caught in the transcript ----------------
  const hasTranscriptScope = billableScope.length > 0;
  const hourly = rules ? rate : effectiveHourly(rate, unit);
  billableScope.forEach((item, i) => {
    const q = scopeQuants ? scopeQuants[i] : null;
    const scopeQty = q ? round2(q.hours) : round2(item.estHours);
    const amount = round2(scopeQty * hourly);
    lines.push({
      description: `${item.description} (${scopeQty}h extra scope)`,
      quantity: scopeQty,
      unit_amount: round2(hourly),
      line_amount: amount,
      account_code: input.accountCode,
      provenance: [
        {
          kind: ProvenanceKind.TRANSCRIPT_QUOTE,
          label: 'Transcript',
          detail: item.evidenceQuote,
        },
        ...rateProvenance(billing),
        ...(rules && q ? quantisationProvenance(q, rules, billing.clauseLabel) : []),
        ...tierChips,
      ],
    });
  });

  const subtotal = round2(lines.reduce((s, l) => s + l.line_amount, 0));
  const taxTotal = round2((subtotal * taxRatePct) / 100);
  const total = round2(subtotal + taxTotal);

  // Every amount above came straight from contract data when either the
  // structured rules priced it, or a clause-cited contract rate did. If the
  // contract could not price a line (no rate, no rules), a human must.
  const pricedFromContract =
    billing.hasContract &&
    (rules !== null || (billing.rate !== null && billing.clauseLabel !== null));

  return { lines, subtotal, taxTotal, total, currency, hasTranscriptScope, pricedFromContract };
}
