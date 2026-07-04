// Deterministic attendee -> client matching. Exact email match is strongest;
// a non-freemail domain match counts as exact too (per architecture: "exact
// email/domain"). Fuzzy, name-based proposals come from the LLM elsewhere and
// are surfaced as a CONFIRM_CLIENT_MATCH task — the engine never guesses.

import { EngineAttendee, EngineClient, MatchResult } from './types';

// Shared consumer domains never count as a client domain match.
const FREEMAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'yahoo.com',
  'yahoo.co.uk',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
]);

function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase().trim() : '';
}

function norm(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Classify a meeting's attendees against known clients.
 * ownerEmails identify the freelancer's own address(es) — excluded from
 * "external attendees" so a solo calendar block reads as PERSONAL.
 */
export function classifyMeeting(
  attendees: EngineAttendee[],
  clients: EngineClient[],
  ownerEmails: string[],
): MatchResult {
  const owner = new Set(ownerEmails.map(norm));
  const external = attendees.filter((a) => a.email && !owner.has(norm(a.email)));

  if (external.length === 0) {
    return {
      kind: 'PERSONAL',
      matchedClientId: null,
      candidateClientIds: [],
      externalAttendees: [],
      unknownAttendees: [],
    };
  }

  // Build lookup: email -> clientId, and non-freemail domain -> clientId.
  const emailToClient = new Map<string, string>();
  const domainToClients = new Map<string, Set<string>>();
  for (const c of clients) {
    for (const e of c.emails) {
      const ne = norm(e);
      if (ne) emailToClient.set(ne, c.id);
      const d = domainOf(ne);
      if (d && !FREEMAIL.has(d)) {
        if (!domainToClients.has(d)) domainToClients.set(d, new Set());
        domainToClients.get(d)!.add(c.id);
      }
    }
  }

  const matchedClientIds = new Set<string>();
  const unknownAttendees: EngineAttendee[] = [];

  for (const a of external) {
    const ne = norm(a.email);
    const exact = emailToClient.get(ne);
    if (exact) {
      matchedClientIds.add(exact);
      continue;
    }
    const d = domainOf(ne);
    const byDomain = d && !FREEMAIL.has(d) ? domainToClients.get(d) : undefined;
    if (byDomain && byDomain.size === 1) {
      matchedClientIds.add([...byDomain][0]);
      continue;
    }
    // domain maps to >1 client => ambiguous contributor; still not "unknown"
    if (byDomain && byDomain.size > 1) {
      for (const id of byDomain) matchedClientIds.add(id);
      continue;
    }
    unknownAttendees.push(a);
  }

  const candidateClientIds = [...matchedClientIds];

  if (candidateClientIds.length === 1) {
    return {
      kind: 'MATCHED',
      matchedClientId: candidateClientIds[0],
      candidateClientIds,
      externalAttendees: external,
      unknownAttendees,
    };
  }
  if (candidateClientIds.length > 1) {
    return {
      kind: 'AMBIGUOUS',
      matchedClientId: null,
      candidateClientIds,
      externalAttendees: external,
      unknownAttendees,
    };
  }
  // No client matched at all — every external attendee is unknown -> pipeline.
  return {
    kind: 'UNKNOWN',
    matchedClientId: null,
    candidateClientIds: [],
    externalAttendees: external,
    unknownAttendees,
  };
}
