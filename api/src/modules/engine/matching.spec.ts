import { classifyMeeting } from './matching';
import { EngineClient } from './types';

const owner = ['me@robyn.dev'];
const clients: EngineClient[] = [
  {
    id: 'c-acme',
    name: 'Acme Builders',
    emails: ['jo@acmebuilders.co.uk'],
    autonomyEnabled: false,
    hasContractOnFile: true,
  },
  {
    id: 'c-brook',
    name: 'Brook & Sons',
    emails: ['sam@brookandsons.com', 'pat@brookandsons.com'],
    autonomyEnabled: true,
    hasContractOnFile: true,
  },
];

describe('classifyMeeting', () => {
  it('classifies a solo (owner-only) block as PERSONAL', () => {
    const r = classifyMeeting([{ email: 'me@robyn.dev', organizer: true }], clients, owner);
    expect(r.kind).toBe('PERSONAL');
    expect(r.matchedClientId).toBeNull();
    expect(r.externalAttendees).toHaveLength(0);
  });

  it('classifies a block with no attendees as PERSONAL', () => {
    expect(classifyMeeting([], clients, owner).kind).toBe('PERSONAL');
  });

  it('matches on an exact email', () => {
    const r = classifyMeeting(
      [{ email: 'me@robyn.dev' }, { email: 'jo@acmebuilders.co.uk' }],
      clients,
      owner,
    );
    expect(r.kind).toBe('MATCHED');
    expect(r.matchedClientId).toBe('c-acme');
  });

  it('is case-insensitive on emails', () => {
    const r = classifyMeeting([{ email: 'JO@AcmeBuilders.CO.UK' }], clients, owner);
    expect(r.kind).toBe('MATCHED');
    expect(r.matchedClientId).toBe('c-acme');
  });

  it('matches on a non-freemail domain when the exact email is unknown', () => {
    const r = classifyMeeting([{ email: 'newperson@brookandsons.com' }], clients, owner);
    expect(r.kind).toBe('MATCHED');
    expect(r.matchedClientId).toBe('c-brook');
  });

  it('does NOT domain-match freemail addresses — they are unknown', () => {
    const r = classifyMeeting([{ email: 'someone@gmail.com' }], clients, owner);
    expect(r.kind).toBe('UNKNOWN');
    expect(r.unknownAttendees.map((a) => a.email)).toContain('someone@gmail.com');
  });

  it('flags two different clients on one call as AMBIGUOUS', () => {
    const r = classifyMeeting(
      [{ email: 'jo@acmebuilders.co.uk' }, { email: 'sam@brookandsons.com' }],
      clients,
      owner,
    );
    expect(r.kind).toBe('AMBIGUOUS');
    expect(r.matchedClientId).toBeNull();
    expect(r.candidateClientIds.sort()).toEqual(['c-acme', 'c-brook']);
  });

  it('returns UNKNOWN when an external attendee matches no client', () => {
    const r = classifyMeeting(
      [{ email: 'me@robyn.dev' }, { email: 'lead@newprospect.io' }],
      clients,
      owner,
    );
    expect(r.kind).toBe('UNKNOWN');
    expect(r.unknownAttendees.map((a) => a.email)).toEqual(['lead@newprospect.io']);
  });

  it('treats a shared domain across two clients as AMBIGUOUS (both candidates)', () => {
    const shared: EngineClient[] = [
      { id: 'a', name: 'A', emails: ['a@shared.com'], autonomyEnabled: false, hasContractOnFile: true },
      { id: 'b', name: 'B', emails: ['b@shared.com'], autonomyEnabled: false, hasContractOnFile: true },
    ];
    const r = classifyMeeting([{ email: 'c@shared.com' }], shared, owner);
    expect(r.kind).toBe('AMBIGUOUS');
    expect(r.candidateClientIds.sort()).toEqual(['a', 'b']);
  });
});
