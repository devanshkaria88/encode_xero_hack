// The Loop-1 deterministic state machine. Given a meeting's facts it returns
// the next state and the single side effect: raise a Task, queue a pipeline
// entry, build a proposal, or auto-send. No silent third path.

import { MeetingState, TaskType } from '../../entities/enums';
import { MatchKind } from './types';

export interface StepInput {
  isPersonal: boolean;
  hasTranscript: boolean;
  matchKind: MatchKind;
  // Whether the policy cleared an auto-send. Only meaningful for
  // MATCHED + hasTranscript (the only branch that builds a proposal).
  // null everywhere else.
  policyAuto: boolean | null;
}

export interface RaisedTask {
  type: TaskType;
  title: string;
  summary: string;
}

export interface StepDecision {
  state: MeetingState;
  raiseTask: RaisedTask | null;
  queuePotentialClient: boolean;
  buildProposal: boolean;
  autoSend: boolean;
}

export function nextMeetingStep(input: StepInput): StepDecision {
  const none: StepDecision = {
    state: MeetingState.DETECTED,
    raiseTask: null,
    queuePotentialClient: false,
    buildProposal: false,
    autoSend: false,
  };

  // Personal / no external attendees — nothing to bill.
  if (input.isPersonal) {
    return { ...none, state: MeetingState.SKIPPED };
  }

  // Unknown attendee (no known client) — hand to the pipeline (Loop 2).
  if (input.matchKind === 'UNKNOWN') {
    return { ...none, state: MeetingState.UNKNOWN_ATTENDEE, queuePotentialClient: true };
  }

  // A known client is involved (MATCHED or AMBIGUOUS). Transcript gate first.
  if (!input.hasTranscript) {
    return {
      ...none,
      state: MeetingState.AWAITING_TRANSCRIPT,
      raiseTask: {
        type: TaskType.PROVIDE_TRANSCRIPT,
        title: 'Provide the transcript',
        summary:
          'This meeting looks billable but has no transcript. Paste it, or tell Robyn to skip.',
      },
    };
  }

  // Transcript attached. Resolve the match.
  if (input.matchKind === 'AMBIGUOUS') {
    return {
      ...none,
      state: MeetingState.TRANSCRIPT_ATTACHED,
      raiseTask: {
        type: TaskType.CONFIRM_CLIENT_MATCH,
        title: 'Confirm the client',
        summary: 'More than one client could be on this meeting. Confirm which one to bill.',
      },
    };
  }

  // MATCHED + transcript => build the proposal. Policy decides send vs review.
  if (input.policyAuto === true) {
    return {
      state: MeetingState.SENT,
      raiseTask: null,
      queuePotentialClient: false,
      buildProposal: true,
      autoSend: true,
    };
  }
  return {
    state: MeetingState.INVOICE_PROPOSED,
    raiseTask: {
      type: TaskType.REVIEW_INVOICE,
      title: 'Review the invoice',
      summary: 'Robyn built an invoice proposal with line-by-line provenance. Approve or edit.',
    },
    queuePotentialClient: false,
    buildProposal: true,
    autoSend: false,
  };
}
