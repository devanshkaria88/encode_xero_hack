import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as nodeIcal from 'node-ical';

import {
  Meeting,
  MeetingAttendee,
  Transcript,
  Client,
  Contract,
  PotentialClient,
  Task,
  InvoiceProposal,
  ConnectionState,
  AuditEvent,
  MeetingState,
  InvoiceProposalState,
  PotentialClientState,
  TaskType,
  TaskState,
  TaskRefType,
  TranscriptSource,
  ConnectionKind,
  ConnectionStatus,
  AuditActor,
  ProvenanceKind,
} from '../../entities';
import {
  ProposalLine,
  MatchProposal,
  TranscriptParsed,
  BillingProfile,
  ClauseRef,
} from '../../entities/shapes';
import { EngineService } from '../engine/engine.service';
import { LlmService } from '../llm/llm.service';
import { XeroService } from '../xero/xero.service';
import { AuditService } from '../audit/audit.service';
import { EngineClient, MatchKind, ScopeItemInput } from '../engine/types';
import { loadConfig } from '../../config/env';
import {
  MeetingListItemDto,
  MeetingDetailDto,
  MeetingProposalDto,
  MeetingActionResultDto,
  SyncResultDto,
} from './dto/meeting-response.dto';

// Robyn's own address(es). External attendees are everyone else — a block with
// only owner attendees reads as PERSONAL and is auto-skipped.
const OWNER_EMAILS: string[] = [
  'me@robyn.dev',
  ...(process.env.OWNER_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
];

const TAX_RATE_PCT = 20; // UK VAT

interface NormalizedEvent {
  gcalEventId: string;
  title: string;
  start: Date;
  end: Date;
  attendees: MeetingAttendee[];
}

interface CalendarIngest {
  events: NormalizedEvent[];
  source: 'google' | 'ics';
  status: ConnectionStatus;
  label: string;
  detail: string;
}

interface Loop1Outcome {
  meeting: Meeting;
  proposal: InvoiceProposal | null;
  xeroError: string | null;
}

@Injectable()
export class MeetingsService {
  private readonly log = new Logger('MeetingsService');

  constructor(
    @InjectRepository(Meeting) private readonly meetingRepo: Repository<Meeting>,
    @InjectRepository(Transcript) private readonly transcriptRepo: Repository<Transcript>,
    @InjectRepository(Client) private readonly clientRepo: Repository<Client>,
    @InjectRepository(Contract) private readonly contractRepo: Repository<Contract>,
    @InjectRepository(PotentialClient) private readonly pcRepo: Repository<PotentialClient>,
    @InjectRepository(Task) private readonly taskRepo: Repository<Task>,
    @InjectRepository(InvoiceProposal) private readonly proposalRepo: Repository<InvoiceProposal>,
    @InjectRepository(ConnectionState) private readonly connRepo: Repository<ConnectionState>,
    private readonly engine: EngineService,
    private readonly llm: LlmService,
    private readonly xero: XeroService,
    private readonly audit: AuditService,
  ) {}

  // =========================================================================
  // Loop 1 — the heart. Deterministic; the engine decides, the LLM only parses.
  // =========================================================================

  async runLoop1(meeting: Meeting): Promise<Loop1Outcome> {
    const clients = await this.clientRepo.find();
    const contracts = await this.contractRepo.find();
    const contractByClient = new Map<string, Contract>();
    for (const c of contracts) if (!contractByClient.has(c.clientId)) contractByClient.set(c.clientId, c);
    const engineClients: EngineClient[] = clients.map((c) => ({
      id: c.id,
      name: c.name,
      emails: c.emails ?? [],
      autonomyEnabled: c.autonomyEnabled,
      hasContractOnFile: contractByClient.has(c.id),
    }));
    const clientById = new Map(clients.map((c) => [c.id, c]));

    // 1-2. Deterministic classification. LLM fuzzy proposals ONLY for the human
    // (unknown/ambiguous). The LLM never sets clientId.
    const match = this.engine.classify(meeting.attendees ?? [], engineClients, OWNER_EMAILS);
    if (match.kind === 'UNKNOWN' || match.kind === 'AMBIGUOUS') {
      try {
        const res = await this.llm.proposeClientMatches(
          (meeting.attendees ?? []).map((a) => ({ email: a.email, name: a.name })),
          clients.map((c) => ({ id: c.id, name: c.name, emails: c.emails ?? [] })),
        );
        meeting.matchProposals = res.proposals as MatchProposal[];
        await this.audit.record({
          actor: AuditActor.LLM,
          action: 'meeting.match_proposed',
          summary: `LLM proposed ${res.proposals.length} client match(es) for "${meeting.title}".`,
          subjectType: 'meeting',
          subjectId: meeting.id,
        });
      } catch (e) {
        await this.audit.record({
          actor: AuditActor.LLM,
          action: 'meeting.match_propose_failed',
          summary: `LLM match proposal unavailable: ${String(e).slice(0, 160)}`,
          subjectType: 'meeting',
          subjectId: meeting.id,
        });
      }
    }

    // A human-confirmed clientId overrides the classifier (confirm-client flow).
    let matchKind: MatchKind = match.kind;
    let clientId: string | null = match.matchedClientId;
    if (meeting.clientId) {
      matchKind = 'MATCHED';
      clientId = meeting.clientId;
    } else if (match.kind === 'MATCHED') {
      meeting.clientId = match.matchedClientId;
      clientId = match.matchedClientId;
    }

    const hasTranscript = !!meeting.transcriptId;

    // 3. Pre-proposal decision. Non-proposal branches (skip / queue / raise task)
    // finish here. Only MATCHED + transcript proceeds to build a proposal.
    const pre = this.engine.step({ isPersonal: meeting.isPersonal, hasTranscript, matchKind, policyAuto: null });

    if (!pre.buildProposal) {
      meeting.state = pre.state;
      if (pre.queuePotentialClient) {
        const unknowns = match.unknownAttendees.length ? match.unknownAttendees : match.externalAttendees;
        await this.queuePotentialClients(meeting, unknowns);
      }
      await this.meetingRepo.save(meeting);
      if (pre.raiseTask) {
        const client = clientId ? clientById.get(clientId) ?? null : null;
        await this.raiseTask(
          pre.raiseTask.type,
          TaskRefType.MEETING,
          meeting.id,
          pre.raiseTask.title,
          pre.raiseTask.summary,
          this.preTaskContext(meeting, client, match.candidateClientIds, pre.raiseTask.type),
        );
      }
      await this.audit.record({
        actor: AuditActor.ROBYN,
        action: `meeting.${pre.state.toLowerCase()}`,
        summary: this.transitionSummary(meeting, pre.state),
        subjectType: 'meeting',
        subjectId: meeting.id,
      });
      return { meeting, proposal: null, xeroError: null };
    }

    // 4. MATCHED + transcript => build the priced proposal with full provenance.
    const client = clientId ? clientById.get(clientId) : undefined;
    if (!client) {
      await this.audit.record({
        actor: AuditActor.ROBYN,
        action: 'meeting.client_missing',
        summary: `Matched client ${clientId} no longer exists — cannot build a proposal for "${meeting.title}".`,
        subjectType: 'meeting',
        subjectId: meeting.id,
      });
      return { meeting, proposal: null, xeroError: 'Matched client not found' };
    }
    const contract = contractByClient.get(client.id) ?? null;
    const hasContractOnFile = !!contract;
    const transcript = meeting.transcriptId
      ? await this.transcriptRepo.findOne({ where: { id: meeting.transcriptId } })
      : null;
    const clause = this.pickClause(contract, client.billingProfile);
    const bp = client.billingProfile;

    const billing = {
      rate: bp?.rate ?? contract?.parsed?.rate ?? null,
      rateUnit: bp?.rate_unit ?? contract?.parsed?.rate_unit ?? 'HOUR',
      currency: bp?.currency ?? contract?.parsed?.currency ?? 'GBP',
      clauseLabel: clause?.ref ?? bp?.provenance ?? null,
      clauseText: clause?.text ?? null,
      hasContract: hasContractOnFile,
    };

    const scopeItems: ScopeItemInput[] = (transcript?.parsed?.scope_items ?? []).map((s) => ({
      description: s.description,
      estHours: Number(s.est_hours),
      evidenceQuote: s.evidence_quote,
      billable: s.billable,
    }));

    let accountCode = '200';
    try {
      accountCode = await this.xero.defaultSalesAccountCode();
    } catch {
      /* Xero may not be live; the engine still prices with the default code. */
    }

    const block = {
      label: this.blockLabel(new Date(meeting.start), new Date(meeting.end)),
      durationHours: Number(meeting.durationHours),
      meetingId: meeting.id,
    };
    const built = this.engine.buildProposal({ block, billing, scopeItems, taxRatePct: TAX_RATE_PCT, accountCode });

    const policyResult = this.engine.policy({
      autonomyEnabled: client.autonomyEnabled,
      hasContractOnFile,
      matchKind: 'MATCHED',
      amount: built.total,
      contractTermsMaxAmount: null,
      hasUnreviewedScope: built.hasTranscriptScope,
    });
    await this.audit.record({
      actor: AuditActor.ROBYN,
      action: 'policy.decided',
      summary: `Policy for "${meeting.title}": ${policyResult.auto ? 'AUTO-SEND cleared' : 'review required'}. ${policyResult.reasons.join(' ')}`.slice(0, 900),
      subjectType: 'meeting',
      subjectId: meeting.id,
      inputs: { policyResult },
    });

    // Persist the proposal idempotently by its stable Reference.
    const reference = `ROBYN-${meeting.id.slice(0, 8)}`;
    let proposal = await this.proposalRepo.findOne({ where: { reference } });
    if (proposal && proposal.state === InvoiceProposalState.SENT) {
      meeting.state = MeetingState.SENT;
      await this.meetingRepo.save(meeting);
      return { meeting, proposal, xeroError: null };
    }
    if (!proposal) proposal = this.proposalRepo.create({ reference, meetingId: meeting.id, detectionId: null });
    proposal.clientId = client.id;
    proposal.lines = built.lines;
    proposal.currency = built.currency;
    proposal.subtotal = built.subtotal;
    proposal.taxTotal = built.taxTotal;
    proposal.total = built.total;
    proposal.policyResult = policyResult;
    proposal.state = InvoiceProposalState.DRAFT;
    proposal = await this.proposalRepo.save(proposal);

    // 5. Re-run the step with the real policy verdict: auto-send or review.
    const decision = this.engine.step({
      isPersonal: meeting.isPersonal,
      hasTranscript: true,
      matchKind: 'MATCHED',
      policyAuto: policyResult.auto,
    });

    if (decision.autoSend) {
      const decisionNote = this.decisionNote(client.name, block.label, policyResult, built, true);
      const evidence = this.buildEvidence(transcript, clause);
      try {
        const result = await this.xero.writeInvoice({
          clientName: client.name,
          clientEmail: client.emails?.[0],
          existingContactId: client.xeroContactId ?? undefined,
          reference,
          lines: this.toXeroLines(built.lines),
          currency: built.currency,
          authorise: true,
          decisionNote,
          evidence,
        });
        proposal.state = InvoiceProposalState.SENT;
        proposal.xeroInvoiceId = result.invoiceId;
        proposal.xeroInvoiceNumber = result.invoiceNumber;
        proposal.xeroDeepLink = result.deepLink;
        proposal.autoSent = true;
        proposal = await this.proposalRepo.save(proposal);
        if (!client.xeroContactId && result.contactId) {
          client.xeroContactId = result.contactId;
          await this.clientRepo.save(client);
        }
        meeting.state = MeetingState.SENT;
        await this.meetingRepo.save(meeting);
        await this.audit.record({
          actor: AuditActor.XERO,
          action: 'xero.invoice.sent',
          summary: `Auto-sent invoice ${result.invoiceNumber ?? result.invoiceId} to ${client.name} for ${built.currency} ${built.total}.`,
          subjectType: 'proposal',
          subjectId: proposal.id,
          inputs: { reference, invoiceId: result.invoiceId, decisionNote },
        });
        return { meeting, proposal, xeroError: null };
      } catch (e) {
        const msg = String((e as { message?: string })?.message ?? e).slice(0, 300);
        proposal.state = InvoiceProposalState.IN_REVIEW;
        proposal = await this.proposalRepo.save(proposal);
        meeting.state = MeetingState.INVOICE_PROPOSED;
        await this.meetingRepo.save(meeting);
        await this.raiseTask(
          TaskType.REVIEW_INVOICE,
          TaskRefType.PROPOSAL,
          proposal.id,
          'Review the invoice',
          `Auto-send to ${client.name} failed (${msg}). Review and approve manually.`,
          this.proposalTaskContext(meeting, client, proposal, built, msg),
        );
        await this.audit.record({
          actor: AuditActor.XERO,
          action: 'xero.invoice.send_failed',
          summary: `Auto-send to ${client.name} failed: ${msg}. Proposal held for review.`,
          subjectType: 'proposal',
          subjectId: proposal.id,
        });
        return { meeting, proposal, xeroError: msg };
      }
    }

    // Not auto — hold for human review.
    proposal.state = InvoiceProposalState.IN_REVIEW;
    proposal = await this.proposalRepo.save(proposal);
    meeting.state = MeetingState.INVOICE_PROPOSED;
    await this.meetingRepo.save(meeting);
    await this.raiseTask(
      TaskType.REVIEW_INVOICE,
      TaskRefType.PROPOSAL,
      proposal.id,
      'Review the invoice',
      `Robyn built an invoice proposal for ${client.name} (${built.currency} ${built.total}). Approve or edit.`,
      this.proposalTaskContext(meeting, client, proposal, built, null),
    );
    await this.audit.record({
      actor: AuditActor.ROBYN,
      action: 'meeting.invoice_proposed',
      summary: `Proposed invoice for ${client.name}: ${built.currency} ${built.total} across ${built.lines.length} line(s).`,
      subjectType: 'proposal',
      subjectId: proposal.id,
      inputs: { reference },
    });
    return { meeting, proposal, xeroError: null };
  }

  // =========================================================================
  // Endpoints
  // =========================================================================

  async list(state?: string): Promise<MeetingListItemDto[]> {
    const meetings = await this.meetingRepo.find({
      where: state ? { state: state as MeetingState } : {},
      order: { start: 'DESC' },
    });
    const clients = await this.clientRepo.find();
    const clientName = new Map(clients.map((c) => [c.id, c.name]));
    const proposals = await this.proposalRepo.find();
    const proposalByMeeting = new Map<string, string>();
    for (const p of proposals) if (p.meetingId && !proposalByMeeting.has(p.meetingId)) proposalByMeeting.set(p.meetingId, p.id);
    return meetings.map((m) =>
      this.mapListItem(
        m,
        m.clientId ? clientName.get(m.clientId) ?? null : null,
        proposalByMeeting.get(m.id) ?? null,
      ),
    );
  }

  async detail(id: string): Promise<MeetingDetailDto> {
    const m = await this.getMeetingOrThrow(id);
    return this.buildDetail(m);
  }

  async sync(): Promise<SyncResultDto> {
    const ingest = await this.ingestCalendar();
    const { imported, updated } = await this.upsertMeetings(ingest.events, ingest.source);
    await this.upsertCalendarConnection(ingest.status, ingest.label, ingest.detail);
    const processed = await this.runEligible();
    await this.audit.record({
      actor: AuditActor.ROBYN,
      action: 'calendar.synced',
      summary: `Calendar sync (${ingest.source}): +${imported} new, ${updated} refreshed, ${processed} processed.`,
      subjectType: 'connection',
    });
    return {
      source: ingest.source,
      status: ingest.status,
      label: ingest.label,
      detail: ingest.detail,
      imported,
      updated,
      processed,
      lastSyncAt: new Date().toISOString(),
    };
  }

  async importIcs(icsText: string): Promise<SyncResultDto> {
    const events = this.parseIcs(icsText);
    const { imported, updated } = await this.upsertMeetings(events, 'ics');
    const detail = `Imported ${events.length} event(s) from uploaded .ics.`;
    await this.upsertCalendarConnection(ConnectionStatus.FALLBACK, 'calendar.ics (uploaded)', detail);
    const processed = await this.runEligible();
    await this.audit.record({
      actor: AuditActor.HUMAN,
      action: 'calendar.ics_imported',
      summary: `.ics import: +${imported} new, ${updated} refreshed, ${processed} processed.`,
      subjectType: 'connection',
    });
    return {
      source: 'ics',
      status: ConnectionStatus.FALLBACK,
      label: 'calendar.ics (uploaded)',
      detail,
      imported,
      updated,
      processed,
      lastSyncAt: new Date().toISOString(),
    };
  }

  async attachTranscript(id: string, rawText: string, source?: TranscriptSource): Promise<MeetingActionResultDto> {
    const meeting = await this.getMeetingOrThrow(id);
    const transcript = this.transcriptRepo.create({
      meetingId: meeting.id,
      rawText,
      source: source ?? TranscriptSource.PASTED,
      parsed: null,
    });
    let parsedCount = 0;
    try {
      const parsed = await this.llm.parseTranscript(rawText);
      transcript.parsed = parsed as TranscriptParsed;
      parsedCount = parsed.scope_items.length;
    } catch (e) {
      await this.audit.record({
        actor: AuditActor.LLM,
        action: 'transcript.parse_failed',
        summary: `Transcript parse failed for "${meeting.title}": ${String(e).slice(0, 160)}. Proceeding with base billing only.`,
        subjectType: 'meeting',
        subjectId: meeting.id,
      });
    }
    const saved = await this.transcriptRepo.save(transcript);
    meeting.transcriptId = saved.id;
    meeting.state = MeetingState.TRANSCRIPT_ATTACHED;
    await this.meetingRepo.save(meeting);
    await this.audit.record({
      actor: AuditActor.HUMAN,
      action: 'meeting.transcript_attached',
      summary: `Transcript attached to "${meeting.title}" — ${parsedCount} scope item(s) parsed.`,
      subjectType: 'meeting',
      subjectId: meeting.id,
    });
    await this.resolveTask(TaskType.PROVIDE_TRANSCRIPT, meeting.id, 'Transcript provided', AuditActor.HUMAN);
    const outcome = await this.runLoop1(meeting);
    return this.actionResult(outcome);
  }

  async confirmClient(id: string, clientId: string): Promise<MeetingActionResultDto> {
    const meeting = await this.getMeetingOrThrow(id);
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);
    meeting.clientId = clientId;
    if (
      meeting.state === MeetingState.UNKNOWN_ATTENDEE ||
      meeting.state === MeetingState.DETECTED ||
      meeting.state === MeetingState.AWAITING_TRANSCRIPT ||
      meeting.state === MeetingState.TRANSCRIPT_ATTACHED
    ) {
      meeting.state = MeetingState.CLIENT_MATCHED;
    }
    await this.meetingRepo.save(meeting);
    await this.audit.record({
      actor: AuditActor.HUMAN,
      action: 'meeting.client_confirmed',
      summary: `Client confirmed as ${client.name} for "${meeting.title}".`,
      subjectType: 'meeting',
      subjectId: meeting.id,
    });
    await this.resolveTask(
      TaskType.CONFIRM_CLIENT_MATCH,
      meeting.id,
      `Confirmed client ${client.name}`,
      AuditActor.HUMAN,
    );
    const outcome = await this.runLoop1(meeting);
    return this.actionResult(outcome);
  }

  async skip(id: string, reason?: string): Promise<MeetingDetailDto> {
    const meeting = await this.getMeetingOrThrow(id);
    meeting.state = MeetingState.SKIPPED;
    meeting.skipReason = reason ?? 'Skipped by user';
    await this.meetingRepo.save(meeting);
    await this.resolveTask(TaskType.PROVIDE_TRANSCRIPT, meeting.id, `Skipped: ${meeting.skipReason}`, AuditActor.HUMAN);
    await this.resolveTask(TaskType.CONFIRM_CLIENT_MATCH, meeting.id, `Skipped: ${meeting.skipReason}`, AuditActor.HUMAN);
    await this.audit.record({
      actor: AuditActor.HUMAN,
      action: 'meeting.skipped',
      summary: `Meeting "${meeting.title}" skipped: ${meeting.skipReason}.`,
      subjectType: 'meeting',
      subjectId: meeting.id,
    });
    return this.buildDetail(meeting);
  }

  /** Run the Loop-1 step on every meeting that has not yet progressed. */
  private async runEligible(): Promise<number> {
    const eligible = await this.meetingRepo.find({
      where: [
        { state: MeetingState.DETECTED },
        { state: MeetingState.AWAITING_TRANSCRIPT },
        { state: MeetingState.UNKNOWN_ATTENDEE },
      ],
      order: { start: 'ASC' },
    });
    let processed = 0;
    for (const m of eligible) {
      try {
        await this.runLoop1(m);
        processed++;
      } catch (e) {
        this.log.warn(`Loop-1 failed for meeting ${m.id}: ${String(e).slice(0, 200)}`);
        await this.audit.record({
          actor: AuditActor.ROBYN,
          action: 'meeting.loop_error',
          summary: `Loop-1 step failed for "${m.title}": ${String(e).slice(0, 160)}`,
          subjectType: 'meeting',
          subjectId: m.id,
        });
      }
    }
    return processed;
  }

  // =========================================================================
  // Calendar ingest — Google read-only if configured, else the .ics fixture.
  // =========================================================================

  private async ingestCalendar(): Promise<CalendarIngest> {
    const cfg = loadConfig();
    if (cfg.google.configured) {
      try {
        const events = await this.loadGoogleEvents();
        return {
          events,
          source: 'google',
          status: ConnectionStatus.LIVE,
          label: 'Google Calendar',
          detail: `Live: ${events.length} event(s) via the Google Calendar API.`,
        };
      } catch (e) {
        const ics = this.ingestIcsFile();
        ics.detail = `Google Calendar unavailable (${String(e).slice(0, 120)}) — using .ics fallback. ${ics.detail}`;
        return ics;
      }
    }
    return this.ingestIcsFile();
  }

  private ingestIcsFile(): CalendarIngest {
    const file = this.readIcsFile();
    if (!file) {
      return {
        events: [],
        source: 'ics',
        status: ConnectionStatus.DOWN,
        label: 'calendar.ics',
        detail: 'No seed/data/calendar.ics found. Upload one via POST /meetings/import-ics.',
      };
    }
    const events = this.parseIcs(file.text);
    return {
      events,
      source: 'ics',
      status: ConnectionStatus.FALLBACK,
      label: 'calendar.ics',
      detail: `Fallback: parsed ${events.length} event(s) from ${file.path}.`,
    };
  }

  private readIcsFile(): { text: string; path: string } | null {
    const cwd = process.cwd();
    const candidates = [
      path.resolve(cwd, 'seed/data/calendar.ics'),
      path.resolve(cwd, '../seed/data/calendar.ics'),
      path.resolve(__dirname, '../../../../seed/data/calendar.ics'),
      path.resolve(__dirname, '../../../../../seed/data/calendar.ics'),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return { text: fs.readFileSync(p, 'utf8'), path: p };
      } catch {
        /* keep trying candidates */
      }
    }
    return null;
  }

  private parseIcs(text: string): NormalizedEvent[] {
    // node-ical's typings don't expose `sync` cleanly under CJS; use it loosely.
    const ical: any = nodeIcal;
    const data = ical.sync.parseICS(text);
    const events: NormalizedEvent[] = [];
    for (const key of Object.keys(data)) {
      const ev: any = data[key];
      if (!ev || ev.type !== 'VEVENT') continue;
      const start = new Date(ev.start);
      const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + 3600000);
      const attendees = this.extractIcsAttendees(ev);
      events.push({
        gcalEventId: String(ev.uid ?? `${ev.summary ?? 'event'}-${start.toISOString()}`),
        title: String(ev.summary ?? 'Untitled meeting'),
        start,
        end,
        attendees,
      });
    }
    return events;
  }

  private extractIcsAttendees(ev: any): MeetingAttendee[] {
    const out: MeetingAttendee[] = [];
    const push = (raw: any, organizer = false) => {
      if (!raw) return;
      let email = '';
      let name: string | undefined;
      if (typeof raw === 'string') {
        email = raw;
      } else if (typeof raw === 'object') {
        email = raw.val ?? raw.email ?? '';
        name = raw.params?.CN ?? raw.params?.cn ?? undefined;
      }
      email = String(email).replace(/^mailto:/i, '').trim();
      if (!email) return;
      if (!out.some((a) => a.email.toLowerCase() === email.toLowerCase())) out.push({ email, name, organizer });
    };
    const at = ev.attendee;
    if (Array.isArray(at)) at.forEach((a) => push(a));
    else push(at);
    push(ev.organizer, true);
    return out;
  }

  private async loadGoogleEvents(): Promise<NormalizedEvent[]> {
    const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!accessToken && !refreshToken) {
      throw new Error('No Google OAuth token available (set GOOGLE_ACCESS_TOKEN / GOOGLE_REFRESH_TOKEN)');
    }
    // Dynamic import so the build stays green even when googleapis is absent
    // (the .ics fallback is the demo path). The Function indirection stops
    // TypeScript from statically resolving the optional dependency.
    const dynImport = new Function('m', 'return import(m)') as unknown as (m: string) => Promise<any>;
    const mod = await dynImport('googleapis');
    const google = mod.google ?? mod.default?.google;
    const cfg = loadConfig();
    const oauth2 = new google.auth.OAuth2(cfg.google.clientId, cfg.google.clientSecret);
    oauth2.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2 });
    const calId = process.env.GOOGLE_CALENDAR_ID ?? 'primary';
    const now = new Date();
    const timeMin = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString();
    const timeMax = new Date(now.getFullYear(), now.getMonth() + 2, 1).toISOString();
    const res = await calendar.events.list({
      calendarId: calId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });
    const items: any[] = res.data.items ?? [];
    return items
      .filter((it) => it.start)
      .map((it) => {
        const start = new Date(it.start.dateTime ?? it.start.date);
        const end = new Date(it.end?.dateTime ?? it.end?.date ?? start);
        const attendees: MeetingAttendee[] = (it.attendees ?? []).map((a: any) => ({
          email: a.email,
          name: a.displayName,
          organizer: !!a.organizer,
        }));
        if (it.organizer?.email && !attendees.some((x) => x.email?.toLowerCase() === it.organizer.email.toLowerCase())) {
          attendees.push({ email: it.organizer.email, name: it.organizer.displayName, organizer: true });
        }
        return {
          gcalEventId: String(it.id),
          title: String(it.summary ?? 'Untitled meeting'),
          start,
          end,
          attendees,
        };
      });
  }

  private async upsertMeetings(events: NormalizedEvent[], source: string): Promise<{ imported: number; updated: number }> {
    let imported = 0;
    let updated = 0;
    for (const ev of events) {
      const durationHours = round2((ev.end.getTime() - ev.start.getTime()) / 3600000);
      const isPersonal = this.isPersonalMeeting(ev.attendees);
      let m = await this.meetingRepo.findOne({ where: { gcalEventId: ev.gcalEventId } });
      if (m) {
        m.title = ev.title;
        m.start = ev.start;
        m.end = ev.end;
        m.durationHours = durationHours;
        m.attendees = ev.attendees;
        m.isPersonal = isPersonal;
        m.source = source;
        await this.meetingRepo.save(m);
        updated++;
      } else {
        m = this.meetingRepo.create({
          gcalEventId: ev.gcalEventId,
          title: ev.title,
          start: ev.start,
          end: ev.end,
          durationHours,
          attendees: ev.attendees,
          isPersonal,
          source,
          state: MeetingState.DETECTED,
          clientId: null,
          transcriptId: null,
          matchProposals: null,
          skipReason: null,
        });
        await this.meetingRepo.save(m);
        imported++;
      }
    }
    return { imported, updated };
  }

  private isPersonalMeeting(attendees: MeetingAttendee[]): boolean {
    const owner = new Set(OWNER_EMAILS.map((e) => e.toLowerCase()));
    const external = attendees.filter((a) => a.email && !owner.has(a.email.toLowerCase()));
    return external.length === 0;
  }

  // =========================================================================
  // Tasks (owned here) + potential-client queue
  // =========================================================================

  private async raiseTask(
    type: TaskType,
    refType: TaskRefType,
    refId: string,
    title: string,
    summary: string,
    context: Record<string, unknown>,
  ): Promise<Task> {
    const dedupeKey = `${type}:${refId}`;
    let task = await this.taskRepo.findOne({ where: { dedupeKey } });
    if (task) {
      const wasResolved = task.state === TaskState.RESOLVED;
      task.state = TaskState.OPEN;
      task.resolvedAt = null;
      task.resolution = null;
      task.title = title;
      task.summary = summary;
      task.context = context;
      task = await this.taskRepo.save(task);
      if (wasResolved) {
        await this.audit.record({
          actor: AuditActor.ROBYN,
          action: 'task.reopened',
          summary: `Task re-opened: ${title}.`,
          subjectType: 'task',
          subjectId: task.id,
        });
      }
      return task;
    }
    task = this.taskRepo.create({
      type,
      refType,
      refId,
      dedupeKey,
      title,
      summary,
      context,
      state: TaskState.OPEN,
    });
    task = await this.taskRepo.save(task);
    await this.audit.record({
      actor: AuditActor.ROBYN,
      action: 'task.raised',
      summary: `Task raised: ${title}.`,
      subjectType: 'task',
      subjectId: task.id,
      inputs: { type, refType, refId },
    });
    return task;
  }

  private async resolveTask(type: TaskType, refId: string, resolution: string, actor: AuditActor): Promise<void> {
    const dedupeKey = `${type}:${refId}`;
    const task = await this.taskRepo.findOne({ where: { dedupeKey, state: TaskState.OPEN } });
    if (!task) return;
    task.state = TaskState.RESOLVED;
    task.resolvedAt = new Date();
    task.resolution = resolution;
    await this.taskRepo.save(task);
    await this.audit.record({
      actor,
      action: 'task.resolved',
      summary: `Task resolved: ${task.title} — ${resolution}.`,
      subjectType: 'task',
      subjectId: task.id,
    });
  }

  private async queuePotentialClients(meeting: Meeting, attendees: MeetingAttendee[]): Promise<void> {
    const existing = await this.pcRepo.find();
    const known = new Set(existing.flatMap((p) => (p.emails ?? []).map((e) => e.toLowerCase())));
    for (const a of attendees) {
      if (!a.email) continue;
      const email = a.email.toLowerCase();
      if (known.has(email)) continue;
      known.add(email);
      const pc = this.pcRepo.create({
        emails: [a.email],
        displayName: a.name || a.email.split('@')[0],
        firstSeenMeetingId: meeting.id,
        state: PotentialClientState.QUEUED,
        lastPolledAt: null,
      });
      const saved = await this.pcRepo.save(pc);
      await this.audit.record({
        actor: AuditActor.ROBYN,
        action: 'potential_client.queued',
        summary: `Queued potential client ${saved.displayName} (${a.email}) from "${meeting.title}".`,
        subjectType: 'potential_client',
        subjectId: saved.id,
      });
    }
  }

  private preTaskContext(
    meeting: Meeting,
    client: Client | null,
    candidateClientIds: string[],
    type: TaskType,
  ): Record<string, unknown> {
    const ctx: Record<string, unknown> = {
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      start: meeting.start,
      end: meeting.end,
      durationHours: Number(meeting.durationHours),
      clientId: meeting.clientId,
      clientName: client?.name ?? null,
      attendees: meeting.attendees,
    };
    if (type === TaskType.PROVIDE_TRANSCRIPT) {
      ctx.actionEndpoint = `/meetings/${meeting.id}/transcript`;
    } else if (type === TaskType.CONFIRM_CLIENT_MATCH) {
      ctx.actionEndpoint = `/meetings/${meeting.id}/confirm-client`;
      ctx.matchProposals = meeting.matchProposals;
      ctx.candidateClientIds = candidateClientIds;
    }
    return ctx;
  }

  private proposalTaskContext(
    meeting: Meeting,
    client: Client,
    proposal: InvoiceProposal,
    built: { subtotal: number; taxTotal: number; total: number; currency: string; lines: ProposalLine[] },
    xeroError: string | null,
  ): Record<string, unknown> {
    return {
      proposalId: proposal.id,
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      clientId: client.id,
      clientName: client.name,
      currency: built.currency,
      subtotal: built.subtotal,
      taxTotal: built.taxTotal,
      total: built.total,
      lineCount: built.lines.length,
      xeroError,
      actionEndpoint: `/proposals/${proposal.id}/approve`,
    };
  }

  // =========================================================================
  // Connection state
  // =========================================================================

  private async upsertCalendarConnection(status: ConnectionStatus, label: string, detail: string): Promise<void> {
    let row = await this.connRepo.findOne({ where: { kind: ConnectionKind.CALENDAR } });
    if (!row) row = this.connRepo.create({ kind: ConnectionKind.CALENDAR });
    row.status = status;
    row.label = label;
    row.detail = detail;
    row.lastSyncAt = new Date();
    await this.connRepo.save(row);
  }

  // =========================================================================
  // Proposal helpers
  // =========================================================================

  private pickClause(contract: Contract | null, billingProfile: BillingProfile | null): ClauseRef | null {
    const clauses = contract?.parsed?.clauses ?? [];
    if (!clauses.length) return null;
    const prov = billingProfile?.provenance ?? '';
    const found = prov ? clauses.find((c) => prov.includes(c.ref) || c.ref.includes(prov)) : undefined;
    return found ?? clauses[0];
  }

  private toXeroLines(lines: ProposalLine[]) {
    return lines.map((l) => ({
      Description: l.description,
      Quantity: Number(l.quantity),
      UnitAmount: Number(l.unit_amount),
      AccountCode: l.account_code,
    }));
  }

  private decisionNote(
    clientName: string,
    blockLabel: string,
    policy: { reasons: string[] },
    built: { lines: ProposalLine[]; subtotal: number; taxTotal: number; total: number; currency: string },
    auto: boolean,
  ): string {
    const prov = built.lines.flatMap((l) => l.provenance.map((p) => `${p.label}: ${p.detail}`));
    const parts = [
      `Robyn invoice proposal for ${clientName} — ${blockLabel}.`,
      `Lines: ${built.lines.map((l) => l.description).join('; ')}.`,
      `Subtotal ${built.currency} ${built.subtotal}, tax ${built.taxTotal}, total ${built.total}.`,
      `Provenance — ${prov.join(' | ')}.`,
      `Policy: ${policy.reasons.join(' ')}`,
      auto ? 'Autonomy ON, within terms -> auto-sent.' : 'Autonomy OFF -> human approved.',
    ];
    return parts.join(' ').slice(0, 2400);
  }

  private buildEvidence(transcript: Transcript | null, clause: ClauseRef | null) {
    const evidence: { filename: string; text: string }[] = [];
    if (transcript) {
      const quotes = (transcript.parsed?.scope_items ?? [])
        .map((s) => `- ${s.description}: "${s.evidence_quote}"`)
        .join('\n');
      const text = quotes || (transcript.rawText ?? '').slice(0, 2000);
      evidence.push({ filename: 'robyn-transcript-evidence.txt', text: `Transcript evidence (Robyn):\n${text}` });
    }
    if (clause) {
      evidence.push({ filename: 'robyn-contract-clause.txt', text: `Contract ${clause.ref}:\n${clause.text}` });
    }
    return evidence;
  }

  private blockLabel(start: Date, end: Date): string {
    const datePart = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Europe/London',
    }).format(start);
    const time = (x: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Europe/London',
      }).format(x);
    return `${datePart}, ${time(start)}–${time(end)}`;
  }

  // =========================================================================
  // Mappers
  // =========================================================================

  private transitionSummary(meeting: Meeting, state: MeetingState): string {
    switch (state) {
      case MeetingState.SKIPPED:
        return `Meeting "${meeting.title}" skipped — no external attendees (personal).`;
      case MeetingState.UNKNOWN_ATTENDEE:
        return `Unknown attendee on "${meeting.title}" — queued to the potential-client pipeline.`;
      case MeetingState.AWAITING_TRANSCRIPT:
        return `Meeting "${meeting.title}" is billable but has no transcript — raised PROVIDE_TRANSCRIPT.`;
      case MeetingState.TRANSCRIPT_ATTACHED:
        return `Meeting "${meeting.title}" has a transcript but an ambiguous client — raised CONFIRM_CLIENT_MATCH.`;
      default:
        return `Meeting "${meeting.title}" -> ${state}.`;
    }
  }

  private async getMeetingOrThrow(id: string): Promise<Meeting> {
    const m = await this.meetingRepo.findOne({ where: { id } });
    if (!m) throw new NotFoundException(`Meeting ${id} not found`);
    return m;
  }

  private mapListItem(m: Meeting, clientName: string | null, proposalId: string | null): MeetingListItemDto {
    return {
      id: m.id,
      gcalEventId: m.gcalEventId,
      title: m.title,
      start: new Date(m.start).toISOString(),
      end: new Date(m.end).toISOString(),
      durationHours: Number(m.durationHours),
      state: m.state,
      clientId: m.clientId,
      clientName,
      attendees: m.attendees ?? [],
      isPersonal: m.isPersonal,
      hasTranscript: !!m.transcriptId,
      proposalId,
      source: m.source,
    };
  }

  private mapProposal(p: InvoiceProposal): MeetingProposalDto {
    return {
      id: p.id,
      state: p.state,
      reference: p.reference,
      currency: p.currency,
      subtotal: Number(p.subtotal),
      taxTotal: Number(p.taxTotal),
      total: Number(p.total),
      autoSent: p.autoSent,
      xeroInvoiceId: p.xeroInvoiceId,
      xeroInvoiceNumber: p.xeroInvoiceNumber,
      xeroDeepLink: p.xeroDeepLink,
      policyResult: p.policyResult,
      lines: (p.lines ?? []).map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unit_amount: Number(l.unit_amount),
        line_amount: Number(l.line_amount),
        account_code: l.account_code,
        tax_type: l.tax_type,
        provenance: (l.provenance ?? []).map((pr) => ({
          kind: pr.kind as ProvenanceKind,
          label: pr.label,
          detail: pr.detail,
          source_ref: pr.source_ref,
        })),
      })),
    };
  }

  private async buildDetail(m: Meeting): Promise<MeetingDetailDto> {
    const clientName = m.clientId
      ? (await this.clientRepo.findOne({ where: { id: m.clientId } }))?.name ?? null
      : null;
    const transcript = m.transcriptId
      ? await this.transcriptRepo.findOne({ where: { id: m.transcriptId } })
      : null;
    const proposal = await this.proposalRepo.findOne({
      where: { meetingId: m.id },
      order: { createdAt: 'DESC' },
    });

    const meetingAudits = await this.audit.listForSubject(m.id, 60);
    let trail: AuditEvent[] = meetingAudits;
    if (proposal) {
      const proposalAudits = await this.audit.listForSubject(proposal.id, 60);
      trail = [...meetingAudits, ...proposalAudits];
    }
    trail = trail
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 60);

    const base = this.mapListItem(m, clientName, proposal?.id ?? null);
    return {
      ...base,
      skipReason: m.skipReason,
      transcript: transcript
        ? {
            id: transcript.id,
            source: transcript.source,
            rawText: transcript.rawText,
            parsed: transcript.parsed
              ? {
                  summary: transcript.parsed.summary,
                  action_points: transcript.parsed.action_points,
                  scope_items: transcript.parsed.scope_items,
                }
              : null,
          }
        : null,
      matchProposals: (m.matchProposals as MatchProposal[] | null) ?? null,
      proposal: proposal ? this.mapProposal(proposal) : null,
      auditTrail: trail.map((e) => ({
        id: e.id,
        actor: e.actor,
        action: e.action,
        summary: e.summary,
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        createdAt: new Date(e.createdAt).toISOString(),
      })),
    };
  }

  private async actionResult(outcome: Loop1Outcome): Promise<MeetingActionResultDto> {
    const meeting = await this.buildDetail(outcome.meeting);
    return {
      meeting,
      proposal: outcome.proposal ? this.mapProposal(outcome.proposal) : null,
      xeroError: outcome.xeroError,
    };
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
