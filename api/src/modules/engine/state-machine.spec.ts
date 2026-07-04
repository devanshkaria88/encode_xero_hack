import { nextMeetingStep } from './state-machine';
import { MeetingState, TaskType } from '../../entities/enums';

describe('nextMeetingStep (Loop 1 state machine)', () => {
  it('skips a personal block with no task', () => {
    const d = nextMeetingStep({ isPersonal: true, hasTranscript: false, matchKind: 'PERSONAL', policyAuto: null });
    expect(d.state).toBe(MeetingState.SKIPPED);
    expect(d.raiseTask).toBeNull();
    expect(d.buildProposal).toBe(false);
  });

  it('queues an unknown attendee to the pipeline', () => {
    const d = nextMeetingStep({ isPersonal: false, hasTranscript: false, matchKind: 'UNKNOWN', policyAuto: null });
    expect(d.state).toBe(MeetingState.UNKNOWN_ATTENDEE);
    expect(d.queuePotentialClient).toBe(true);
    expect(d.raiseTask).toBeNull();
  });

  it('raises PROVIDE_TRANSCRIPT for a matched client with no transcript', () => {
    const d = nextMeetingStep({ isPersonal: false, hasTranscript: false, matchKind: 'MATCHED', policyAuto: null });
    expect(d.state).toBe(MeetingState.AWAITING_TRANSCRIPT);
    expect(d.raiseTask?.type).toBe(TaskType.PROVIDE_TRANSCRIPT);
  });

  it('raises PROVIDE_TRANSCRIPT even when the match is ambiguous but no transcript yet', () => {
    const d = nextMeetingStep({ isPersonal: false, hasTranscript: false, matchKind: 'AMBIGUOUS', policyAuto: null });
    expect(d.raiseTask?.type).toBe(TaskType.PROVIDE_TRANSCRIPT);
  });

  it('raises CONFIRM_CLIENT_MATCH for an ambiguous match with a transcript', () => {
    const d = nextMeetingStep({ isPersonal: false, hasTranscript: true, matchKind: 'AMBIGUOUS', policyAuto: null });
    expect(d.state).toBe(MeetingState.TRANSCRIPT_ATTACHED);
    expect(d.raiseTask?.type).toBe(TaskType.CONFIRM_CLIENT_MATCH);
    expect(d.buildProposal).toBe(false);
  });

  it('builds a proposal and raises REVIEW_INVOICE when policy does not clear auto-send', () => {
    const d = nextMeetingStep({ isPersonal: false, hasTranscript: true, matchKind: 'MATCHED', policyAuto: false });
    expect(d.state).toBe(MeetingState.INVOICE_PROPOSED);
    expect(d.buildProposal).toBe(true);
    expect(d.autoSend).toBe(false);
    expect(d.raiseTask?.type).toBe(TaskType.REVIEW_INVOICE);
  });

  it('builds a proposal and auto-sends with no task when policy clears it', () => {
    const d = nextMeetingStep({ isPersonal: false, hasTranscript: true, matchKind: 'MATCHED', policyAuto: true });
    expect(d.state).toBe(MeetingState.SENT);
    expect(d.buildProposal).toBe(true);
    expect(d.autoSend).toBe(true);
    expect(d.raiseTask).toBeNull();
  });
});
