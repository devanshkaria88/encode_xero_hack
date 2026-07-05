// The autonomy policy — CODE, never LLM. AUTO_SEND iff ALL hold:
//   client.autonomy_enabled AND contract on file AND exact match AND
//   amount within contract terms AND no un-reviewed transcript scope.
// Every reason (pass or fail) is logged and rendered on the card.

import { PolicyResult } from '../../entities/shapes';
import { PolicyInput } from './types';

export function policyDecision(input: PolicyInput): PolicyResult {
  const reasons: string[] = [];
  let auto = true;

  if (!input.autonomyEnabled) {
    auto = false;
    reasons.push('Autonomy is off for this client, so everything goes to review.');
  } else {
    reasons.push('Autonomy is on for this client.');
  }

  if (!input.hasContractOnFile) {
    auto = false;
    reasons.push('No contract on file. Cannot auto-send without a cited rate.');
  } else {
    reasons.push('Contract on file with a cited rate.');
  }

  if (input.matchKind !== 'MATCHED') {
    auto = false;
    reasons.push(`Client match is ${input.matchKind}, not an exact match.`);
  } else {
    reasons.push('Exact client match.');
  }

  if (input.contractTermsMaxAmount !== null && input.amount > input.contractTermsMaxAmount) {
    auto = false;
    reasons.push(
      `Amount ${input.amount} exceeds the contract cap ${input.contractTermsMaxAmount}.`,
    );
  } else if (input.contractTermsMaxAmount !== null) {
    reasons.push(`Amount ${input.amount} is within the contract cap ${input.contractTermsMaxAmount}.`);
  } else {
    reasons.push('Amount is within contract terms (rate-derived).');
  }

  if (input.hasUnreviewedScope) {
    auto = false;
    reasons.push('Transcript contains extra scope. A human must review it before sending.');
  } else {
    reasons.push('No un-reviewed transcript scope.');
  }

  return { auto, reasons };
}
