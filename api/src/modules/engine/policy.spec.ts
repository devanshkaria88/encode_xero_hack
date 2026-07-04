import { policyDecision } from './policy';
import { PolicyInput } from './types';

function base(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    autonomyEnabled: true,
    hasContractOnFile: true,
    matchKind: 'MATCHED',
    amount: 500,
    contractTermsMaxAmount: null,
    hasUnreviewedScope: false,
    ...overrides,
  };
}

describe('policyDecision (autonomy gate)', () => {
  it('auto-sends only when every gate passes', () => {
    const r = policyDecision(base());
    expect(r.auto).toBe(true);
    expect(r.reasons.length).toBeGreaterThanOrEqual(5);
  });

  it('blocks when autonomy is OFF', () => {
    expect(policyDecision(base({ autonomyEnabled: false })).auto).toBe(false);
  });

  it('blocks when there is no contract on file', () => {
    expect(policyDecision(base({ hasContractOnFile: false })).auto).toBe(false);
  });

  it('blocks when the match is not exact', () => {
    expect(policyDecision(base({ matchKind: 'AMBIGUOUS' })).auto).toBe(false);
    expect(policyDecision(base({ matchKind: 'UNKNOWN' })).auto).toBe(false);
  });

  it('blocks when the amount exceeds the contract cap', () => {
    const r = policyDecision(base({ amount: 5000, contractTermsMaxAmount: 3000 }));
    expect(r.auto).toBe(false);
    expect(r.reasons.some((x) => x.includes('exceeds'))).toBe(true);
  });

  it('allows when the amount is within the contract cap', () => {
    expect(policyDecision(base({ amount: 2000, contractTermsMaxAmount: 3000 })).auto).toBe(true);
  });

  it('blocks when the transcript has un-reviewed extra scope', () => {
    const r = policyDecision(base({ hasUnreviewedScope: true }));
    expect(r.auto).toBe(false);
    expect(r.reasons.some((x) => x.toLowerCase().includes('extra scope'))).toBe(true);
  });

  it('records a reason for every gate even on success', () => {
    const r = policyDecision(base());
    expect(r.reasons.join(' ')).toMatch(/Autonomy is ON/);
    expect(r.reasons.join(' ')).toMatch(/Contract on file/);
    expect(r.reasons.join(' ')).toMatch(/Exact client match/);
  });
});
