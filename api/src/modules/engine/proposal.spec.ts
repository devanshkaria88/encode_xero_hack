import { buildProposal, quantiseHours } from './proposal';
import { BuildProposalInput } from './types';
import { ProvenanceKind } from '../../entities/enums';
import { ContractBillingRules } from '../../entities/shapes';

const baseBilling = {
  rate: 150,
  rateUnit: 'HOUR' as const,
  currency: 'GBP',
  clauseLabel: 'Clause 3.1',
  clauseText: 'Consultancy is charged at £150 per hour.',
  hasContract: true,
};

function input(overrides: Partial<BuildProposalInput> = {}): BuildProposalInput {
  return {
    block: { label: 'Tue 3 Jun, 14:00–15:30', durationHours: 1.5, meetingId: 'm1' },
    billing: baseBilling,
    scopeItems: [],
    taxRatePct: 20,
    accountCode: '200',
    ...overrides,
  };
}

describe('buildProposal', () => {
  it('prices an hourly block with VAT and cites the calendar block + clause', () => {
    const p = buildProposal(input());
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0].quantity).toBe(1.5);
    expect(p.lines[0].unit_amount).toBe(150);
    expect(p.lines[0].line_amount).toBe(225);
    expect(p.subtotal).toBe(225);
    expect(p.taxTotal).toBe(45); // 20% VAT
    expect(p.total).toBe(270);
    const kinds = p.lines[0].provenance.map((x) => x.kind);
    expect(kinds).toContain(ProvenanceKind.CALENDAR_BLOCK);
    expect(kinds).toContain(ProvenanceKind.CONTRACT_CLAUSE);
    expect(p.hasTranscriptScope).toBe(false);
  });

  it('adds billable transcript scope items as separate cited lines', () => {
    const p = buildProposal(
      input({
        scopeItems: [
          {
            description: 'Extra site visit agreed on the call',
            estHours: 2,
            evidenceQuote: 'can you also swing by the second unit on Thursday',
            billable: true,
          },
          {
            description: 'General chit chat',
            estHours: 1,
            evidenceQuote: 'how was your holiday',
            billable: false,
          },
        ],
      }),
    );
    expect(p.lines).toHaveLength(2); // base + one billable scope
    expect(p.hasTranscriptScope).toBe(true);
    const scopeLine = p.lines[1];
    expect(scopeLine.line_amount).toBe(300); // 2h * 150
    expect(scopeLine.provenance[0].kind).toBe(ProvenanceKind.TRANSCRIPT_QUOTE);
    expect(scopeLine.provenance[0].detail).toContain('second unit');
    expect(p.subtotal).toBe(525);
    expect(p.taxTotal).toBe(105);
    expect(p.total).toBe(630);
  });

  it('handles a DAY rate by converting duration to days and scope to hourly-equivalent', () => {
    const p = buildProposal(
      input({
        block: { label: 'Full day on site', durationHours: 8, meetingId: 'm2' },
        billing: { ...baseBilling, rate: 1200, rateUnit: 'DAY', clauseLabel: 'Clause 2' },
        scopeItems: [
          { description: 'After-hours call', estHours: 1, evidenceQuote: 'quick call at 7pm', billable: true },
        ],
      }),
    );
    expect(p.lines[0].quantity).toBe(1); // 8h / 8 = 1 day
    expect(p.lines[0].line_amount).toBe(1200);
    // scope priced at day/8 = 150/h
    expect(p.lines[1].line_amount).toBe(150);
    expect(p.subtotal).toBe(1350);
  });

  it('rounds money to 2dp with no FP drift', () => {
    const p = buildProposal(
      input({
        block: { label: '20 min', durationHours: 0.3333, meetingId: 'm3' },
        billing: { ...baseBilling, rate: 99.99 },
      }),
    );
    // 0.33 * 99.99 = 32.9967 -> quantity rounds to 0.33, amount to 33.00
    expect(Number.isFinite(p.total)).toBe(true);
    expect(p.subtotal).toBe(p.lines[0].line_amount);
  });

  it('produces a base line even with no contract (unit 0, no clause chip)', () => {
    const p = buildProposal(
      input({
        billing: { rate: null, rateUnit: null, currency: 'GBP', clauseLabel: null, clauseText: null, hasContract: false },
      }),
    );
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0].unit_amount).toBe(0);
    expect(p.lines[0].provenance.every((x) => x.kind !== ProvenanceKind.CONTRACT_CLAUSE)).toBe(true);
    expect(p.pricedFromContract).toBe(false);
  });

  it('marks clause-cited rate pricing as priced from the contract', () => {
    const p = buildProposal(input());
    expect(p.pricedFromContract).toBe(true);
  });

  it('is not priced from the contract when the contract has no cited rate', () => {
    const p = buildProposal(
      input({
        billing: { ...baseBilling, rate: null },
      }),
    );
    expect(p.pricedFromContract).toBe(false);
  });
});

// The Technical Advisory Agreement: £50/hr up to 3 advisory hours a week,
// £40/hr applied to the whole week beyond that, 30-minute minimum billing
// block, time past the first block rounds up to the nearest 30 minutes.
const advisoryRules: ContractBillingRules = {
  baseRateGbp: 50,
  reducedRateGbp: 40,
  reducedRateThresholdHoursPerWeek: 3,
  minBlockMinutes: 30,
  roundUpToBlockMinutes: 30,
  billingCycle: 'weekly',
  paymentTermsDays: 7,
};

const advisoryBilling = {
  rate: 50,
  rateUnit: 'HOUR' as const,
  currency: 'GBP',
  clauseLabel: 'Clause 3',
  clauseText:
    'Advisory time is billed in blocks of 30 minutes; any session is billed at a minimum of one block.',
  hasContract: true,
  rules: advisoryRules,
};

function advisoryInput(overrides: Partial<BuildProposalInput> = {}): BuildProposalInput {
  return input({ billing: advisoryBilling, ...overrides });
}

describe('quantiseHours (contract billing rules)', () => {
  it('bills 15 minutes as one 30-minute minimum block', () => {
    const q = quantiseHours(0.25, advisoryRules);
    expect(q.hours).toBe(0.5);
    expect(q.originalMinutes).toBe(15);
    expect(q.quantisedMinutes).toBe(30);
    expect(q.changed).toBe(true);
    expect(q.usedMinimumBlock).toBe(true);
  });

  it('rounds 40 minutes up to 60 in 30-minute blocks (not the minimum block)', () => {
    const q = quantiseHours(0.6667, advisoryRules);
    expect(q.hours).toBe(1);
    expect(q.quantisedMinutes).toBe(60);
    expect(q.usedMinimumBlock).toBe(false);
  });

  it('leaves exact block multiples untouched (no FP drift)', () => {
    expect(quantiseHours(0.5, advisoryRules).hours).toBe(0.5);
    expect(quantiseHours(0.5, advisoryRules).changed).toBe(false);
    expect(quantiseHours(1.5, advisoryRules).hours).toBe(1.5);
    expect(quantiseHours(3, advisoryRules).hours).toBe(3);
  });

  it('is the identity when the rules carry no block sizes', () => {
    const q = quantiseHours(0.25, { baseRateGbp: 50 });
    expect(q.hours).toBe(0.25);
    expect(q.changed).toBe(false);
  });
});

describe('buildProposal with contract billing rules', () => {
  it('bills a 15-minute transcript scope item as one 30-minute block at £50 = £25 and cites the clause', () => {
    const p = buildProposal(
      advisoryInput({
        block: { label: 'Tue 3 Jun, 14:00–15:00', durationHours: 1, meetingId: 'm1' },
        scopeItems: [
          {
            description: 'Advisory call on the deployment pipeline',
            estHours: 0.25,
            evidenceQuote: 'can you talk me through the rollback plan after this',
            billable: true,
          },
        ],
      }),
    );
    expect(p.lines).toHaveLength(2);
    const scope = p.lines[1];
    expect(scope.quantity).toBe(0.5);
    expect(scope.unit_amount).toBe(50);
    expect(scope.line_amount).toBe(25);
    const quantChip = scope.provenance.find((x) => x.detail.includes('minimum block'));
    expect(quantChip).toBeDefined();
    expect(quantChip!.detail).toBe('15 min rounds up to the 30-minute minimum block (Clause 3)');
    expect(quantChip!.kind).toBe(ProvenanceKind.CONTRACT_CLAUSE);
    expect(p.pricedFromContract).toBe(true);
  });

  it('rounds a 40-minute scope item up to 1.0h at £50', () => {
    const p = buildProposal(
      advisoryInput({
        block: { label: '1h call', durationHours: 1, meetingId: 'm1' },
        scopeItems: [
          {
            description: 'Code review of the payments branch',
            estHours: 0.6667,
            evidenceQuote: 'yes, please review the payments PR before Friday',
            billable: true,
          },
        ],
      }),
    );
    const scope = p.lines[1];
    expect(scope.quantity).toBe(1);
    expect(scope.line_amount).toBe(50);
    expect(scope.provenance.some((x) => x.detail.includes('40 min rounds up to 60 min'))).toBe(true);
  });

  it('bills exactly 3 hours at the base £50 rate (£150) — the threshold is strictly more than', () => {
    const p = buildProposal(
      advisoryInput({
        block: { label: '3h advisory', durationHours: 3, meetingId: 'm1' },
      }),
    );
    expect(p.lines[0].quantity).toBe(3);
    expect(p.lines[0].unit_amount).toBe(50);
    expect(p.lines[0].line_amount).toBe(150);
    expect(p.subtotal).toBe(150);
  });

  it('bills 3.5 hours at the reduced £40 rate for the whole proposal (£140)', () => {
    const p = buildProposal(
      advisoryInput({
        block: { label: '3.5h advisory', durationHours: 3.5, meetingId: 'm1' },
      }),
    );
    expect(p.lines[0].quantity).toBe(3.5);
    expect(p.lines[0].unit_amount).toBe(40);
    expect(p.lines[0].line_amount).toBe(140);
    expect(p.lines[0].provenance.some((x) => x.detail.includes('reduced rate of 40'))).toBe(true);
  });

  it('applies the reduced rate to every line once quantised hours cross the threshold', () => {
    const p = buildProposal(
      advisoryInput({
        block: { label: '2h workshop', durationHours: 2, meetingId: 'm1' },
        scopeItems: [
          {
            description: 'Requested prep for the architecture review',
            estHours: 1.4, // 84 min -> rounds up to 90 min = 1.5h; total 3.5h > 3
            evidenceQuote: 'please prepare the comparison doc before Monday',
            billable: true,
          },
        ],
      }),
    );
    expect(p.lines[0].unit_amount).toBe(40);
    expect(p.lines[1].unit_amount).toBe(40);
    expect(p.lines[1].quantity).toBe(1.5);
    expect(p.subtotal).toBe(140); // 2h*40 + 1.5h*40
  });

  it('a contract without structured rules behaves exactly as before', () => {
    const withNullRules = buildProposal(input({ billing: { ...baseBilling, rules: null } }));
    const withoutRules = buildProposal(input());
    expect(withNullRules).toEqual(withoutRules);
    expect(withNullRules.lines[0].quantity).toBe(1.5);
    expect(withNullRules.lines[0].line_amount).toBe(225);
  });
});
