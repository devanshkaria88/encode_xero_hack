import { Injectable } from '@nestjs/common';
import { classifyMeeting } from './matching';
import { buildProposal } from './proposal';
import { policyDecision } from './policy';
import { nextMeetingStep, StepInput, StepDecision } from './state-machine';
import {
  EngineAttendee,
  EngineClient,
  MatchResult,
  BuildProposalInput,
  BuiltProposal,
  PolicyInput,
} from './types';
import { PolicyResult } from '../../entities/shapes';

// Injectable façade over the pure engine functions. Holds no state; every
// method delegates to a deterministic, unit-tested pure function so the DI
// wiring never dilutes testability.
@Injectable()
export class EngineService {
  classify(attendees: EngineAttendee[], clients: EngineClient[], ownerEmails: string[]): MatchResult {
    return classifyMeeting(attendees, clients, ownerEmails);
  }

  buildProposal(input: BuildProposalInput): BuiltProposal {
    return buildProposal(input);
  }

  policy(input: PolicyInput): PolicyResult {
    return policyDecision(input);
  }

  step(input: StepInput): StepDecision {
    return nextMeetingStep(input);
  }
}
