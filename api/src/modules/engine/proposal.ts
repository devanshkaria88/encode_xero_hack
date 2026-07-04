// Deterministic invoice-proposal maths. Given a calendar block, the client's
// billing profile (rate cited from a contract clause) and the transcript's
// billable scope items (each with a verbatim quote), build the invoice lines
// with full provenance and totals. Zero LLM: the LLM already produced the
// scope items upstream; here we only price and cite.

import { ProposalLine, LineProvenance } from '../../entities/shapes';
import { ProvenanceKind } from '../../entities/enums';
import { BuildProposalInput, BuiltProposal, RateUnit } from './types';

export function round2(n: number): number {
  // Avoid binary FP drift on money.
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const HOURS_PER_DAY = 8;

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

export function buildProposal(input: BuildProposalInput): BuiltProposal {
  const { block, billing, scopeItems, taxRatePct } = input;
  const currency = billing.currency || 'GBP';
  const lines: ProposalLine[] = [];

  const rate = billing.rate ?? 0;
  const unit = billing.rateUnit ?? 'HOUR';

  // --- Base line: the calendar time block -----------------------------------
  const qty = baseLineQuantity(block.durationHours, unit);
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
  ];
  lines.push({
    description: `Consulting — ${block.label} (${round2(block.durationHours)}h @ ${
      billing.rate ?? '?'
    } ${currency}/${unitLabel})`,
    quantity: qty,
    unit_amount: round2(rate),
    line_amount: baseAmount,
    account_code: input.accountCode,
    provenance: baseProvenance,
  });

  // --- Scope lines: billable extras caught in the transcript ----------------
  let hasTranscriptScope = false;
  const hourly = effectiveHourly(rate, unit);
  for (const item of scopeItems) {
    if (!item.billable) continue;
    hasTranscriptScope = true;
    const amount = round2(item.estHours * hourly);
    lines.push({
      description: `${item.description} (${round2(item.estHours)}h — extra scope)`,
      quantity: round2(item.estHours),
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
      ],
    });
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.line_amount, 0));
  const taxTotal = round2((subtotal * taxRatePct) / 100);
  const total = round2(subtotal + taxTotal);

  return { lines, subtotal, taxTotal, total, currency, hasTranscriptScope };
}
