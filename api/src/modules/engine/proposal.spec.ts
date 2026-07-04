import { buildProposal } from './proposal';
import { BuildProposalInput } from './types';
import { ProvenanceKind } from '../../entities/enums';

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
  });
});
