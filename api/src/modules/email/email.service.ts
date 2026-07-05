import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import {
  PotentialClient,
  PotentialClientState,
  Task,
  TaskType,
  TaskState,
  TaskRefType,
  ConnectionState,
  ConnectionKind,
  ConnectionStatus,
  AuditActor,
  AgreementEvidence,
} from '../../entities';
import { GoogleConnection } from '../../entities/google-connection.entity';
import { LlmService } from '../llm/llm.service';
import { AuditService } from '../audit/audit.service';
import { ClientsService } from '../clients/clients.service';
import { loadConfig } from '../../config/env';
import { EmailPollResultDto, DetectedAgreementDto } from './dto/email-poll.dto';

// A normalised inbound message — the same shape whether it came from live
// IMAP, the fixture mailbox or the Gmail sync (Google module), so the classify
// path never branches on source. `attachments` carries PDF attachments only
// and only the Gmail path populates it (capped at 3 per message, 5MB each);
// the IMAP and fixture paths simply leave it undefined.
export interface InboundMessage {
  from: string;
  subject: string;
  body: string;
  date: string | null; // ISO if known
  messageId: string;
  attachments?: { filename: string; mimeType: string; data: Buffer }[];
}

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Loop 2 DETECT. Reads NEW messages FROM queued potential-client addresses ONLY
// (IMAP when configured, else the seeded fixture mailbox), classifies each for
// agreement via the LLM edge, and on agreement flips the PotentialClient to
// AGREEMENT_DETECTED + raises a CONFIRM_AGREEMENT task. It never promotes a
// client and never reads a non-queued sender — that scope widening is a bug.
@Injectable()
export class EmailService {
  private readonly log = new Logger('EmailService');

  constructor(
    @InjectRepository(PotentialClient)
    private readonly pcRepo: Repository<PotentialClient>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(ConnectionState)
    private readonly connRepo: Repository<ConnectionState>,
    @InjectRepository(GoogleConnection)
    private readonly googleConnRepo: Repository<GoogleConnection>,
    private readonly llm: LlmService,
    private readonly audit: AuditService,
    // Reused for the agreement-PDF auto-onboard: the SAME promotion and
    // contract-upsert paths the human confirm endpoints call.
    private readonly clients: ClientsService,
  ) {}

  // --- Public entry: run one poll cycle ------------------------------------
  async poll(): Promise<EmailPollResultDto> {
    const cfg = loadConfig();
    const now = new Date();
    const nextPollAt = new Date(now.getTime() + POLL_INTERVAL_MS);

    // When a Google connection holds the gmail scope, the Gmail sync (Google
    // module) owns the email surface — this poll must stand down COMPLETELY.
    // Running both did two kinds of damage: the fixture poll flipped the
    // EMAIL connection row to FALLBACK twice an hour over Gmail's LIVE row,
    // and it advanced every watched sender's lastPolledAt after reading only
    // fixture files, which silently skipped any real email that arrived
    // between two Gmail polls (the Gmail query is `after:lastPolledAt`).
    const googleConn = (await this.googleConnRepo.find({ take: 1 }))[0];
    if (googleConn && (googleConn.grantedScopes ?? '').includes('/auth/gmail.readonly')) {
      return {
        mode: ConnectionStatus.LIVE,
        detail:
          'Gmail owns the email surface; the IMAP/fixture poll stood down without touching any state.',
        polledCount: 0,
        messagesRead: 0,
        agreementsDetected: 0,
        tasksRaised: 0,
        detected: [],
        polledAt: now.toISOString(),
        nextPollAt: nextPollAt.toISOString(),
      };
    }

    const queued = await this.pcRepo.find({
      where: {
        state: In([PotentialClientState.QUEUED, PotentialClientState.WATCHING]),
      },
    });

    let mode: ConnectionStatus = cfg.imap.configured
      ? ConnectionStatus.LIVE
      : ConnectionStatus.FALLBACK;
    let messagesRead = 0;
    let agreementsDetected = 0;
    let tasksRaised = 0;
    const detected: DetectedAgreementDto[] = [];

    // In fallback we read every fixture file once, then filter per potential
    // client to the queued senders. This never touches a non-queued address.
    let fixtureMessages: InboundMessage[] | null = null;
    if (!cfg.imap.configured) {
      fixtureMessages = await this.readFixtureMailbox();
    }

    for (const pc of queued) {
      const addrs = (pc.emails ?? [])
        .map((e) => this.normaliseAddress(e))
        .filter((e) => e.length > 0);
      if (addrs.length === 0) {
        pc.lastPolledAt = now;
        await this.pcRepo.save(pc);
        continue;
      }

      let msgs: InboundMessage[] = [];
      if (cfg.imap.configured) {
        try {
          msgs = await this.readImapForSenders(cfg, addrs, pc.lastPolledAt);
        } catch (err) {
          // IMAP was configured but unreachable — keep local state, surface the
          // reason on the connection row, do NOT crash the poll.
          mode = ConnectionStatus.DOWN;
          const reason = err instanceof Error ? err.message : String(err);
          this.log.warn(`IMAP read failed for potential-client ${pc.id}: ${reason}`);
          await this.audit.record({
            actor: AuditActor.SYSTEM,
            action: 'email.imap_error',
            summary: `IMAP read failed while polling ${pc.displayName}: ${reason.slice(0, 200)}`,
            subjectType: 'potential_client',
            subjectId: pc.id,
          });
          msgs = [];
        }
      } else {
        msgs = (fixtureMessages ?? [])
          .filter((m) => addrs.includes(this.normaliseAddress(m.from)))
          .filter((m) => this.isNewMessage(m, pc.lastPolledAt));
      }

      messagesRead += msgs.length;

      const res = await this.processInboundMessages(pc, msgs, mode);
      agreementsDetected += res.agreementsDetected;
      tasksRaised += res.tasksRaised;
      detected.push(...res.detected);

      pc.lastPolledAt = now;
      await this.pcRepo.save(pc);
    }

    const detail = this.connectionDetail(cfg, mode);
    await this.upsertEmailConnection(mode, cfg, detail, now, nextPollAt);

    await this.audit.record({
      actor: AuditActor.ROBYN,
      action: 'email.poll',
      summary:
        `Email poll (${mode}): ${queued.length} queued, ${messagesRead} message(s) read, ` +
        `${agreementsDetected} agreement(s), ${tasksRaised} task(s) raised.`,
      subjectType: 'connection_state',
      inputs: {
        mode,
        polledCount: queued.length,
        messagesRead,
        agreementsDetected,
        tasksRaised,
      },
    });

    return {
      mode,
      detail,
      polledCount: queued.length,
      messagesRead,
      agreementsDetected,
      tasksRaised,
      detected,
      polledAt: now.toISOString(),
      nextPollAt: nextPollAt.toISOString(),
    };
  }

  // --- Shared classify path --------------------------------------------------
  // Used by the IMAP/fixture poll above AND by the Gmail sync in the Google
  // module, so every inbound message is judged by the exact same rules:
  // classify via the LLM edge (never guess on failure), and on agreement flip
  // the PotentialClient, raise the CONFIRM_AGREEMENT task idempotently and
  // audit both edges. Callers own the queued-sender filter and lastPolledAt.
  async processInboundMessages(
    pc: PotentialClient,
    msgs: InboundMessage[],
    mode: ConnectionStatus,
  ): Promise<{ agreementsDetected: number; tasksRaised: number; detected: DetectedAgreementDto[] }> {
    const now = new Date();
    let agreementsDetected = 0;
    let tasksRaised = 0;
    const detected: DetectedAgreementDto[] = [];

    for (const m of msgs) {
      // PDF-vs-text fork: a message carrying a PDF attachment (Gmail path
      // only) may BE the agreement itself — if the parsed PDF is an
      // agreement, Robyn auto-onboards with zero human clicks. If none of
      // the PDFs is an agreement (or the parse fails), fall through to the
      // existing text classification, which still needs a human confirm.
      if (m.attachments && m.attachments.length > 0) {
        const onboarded = await this.tryAgreementPdfOnboard(pc, m, mode);
        if (onboarded) {
          agreementsDetected += 1;
          detected.push(onboarded);
          break; // one agreement per potential client is enough
        }
      }

      let cls;
      try {
        cls = await this.llm.classifyAgreement(m.from, m.subject, m.body);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.log.warn(`Agreement classification failed for ${pc.id}: ${reason}`);
        await this.audit.record({
          actor: AuditActor.LLM,
          action: 'email.classify_error',
          summary: `Agreement classification failed for ${pc.displayName}: ${reason.slice(0, 200)}`,
          subjectType: 'potential_client',
          subjectId: pc.id,
          inputs: { from: m.from, subject: m.subject },
        });
        continue; // never guess — skip this message
      }

      if (!cls.agreement) {
        await this.audit.record({
          actor: AuditActor.LLM,
          action: 'email.classified_no_agreement',
          summary: `No agreement in message from ${pc.displayName} ("${m.subject}").`,
          subjectType: 'potential_client',
          subjectId: pc.id,
          inputs: { from: m.from, subject: m.subject, reasoning: cls.reasoning },
        });
        continue;
      }

      // Agreement detected — the money-adjacent transition. Record evidence,
      // flip state, raise the confirm task (idempotent), audit both edges.
      const quote =
        cls.evidence_quote && cls.evidence_quote.trim().length > 0
          ? cls.evidence_quote.trim()
          : m.subject || 'Agreement indicated in email';
      const evidence: AgreementEvidence = {
        email_msg_id: m.messageId,
        quote,
        from: m.from,
        subject: m.subject,
        received_at: m.date ?? now.toISOString(),
      };

      pc.state = PotentialClientState.AGREEMENT_DETECTED;
      pc.evidence = evidence;
      await this.pcRepo.save(pc);
      agreementsDetected += 1;

      await this.audit.record({
        actor: AuditActor.ROBYN,
        action: 'email.agreement_detected',
        summary: `Agreement detected from ${pc.displayName}: "${quote}"`,
        subjectType: 'potential_client',
        subjectId: pc.id,
        inputs: {
          from: m.from,
          subject: m.subject,
          quote,
          reasoning: cls.reasoning,
          mode,
        },
      });

      const taskId = await this.raiseConfirmAgreementTask(pc, evidence);
      if (taskId) tasksRaised += 1;

      detected.push({
        potentialClientId: pc.id,
        displayName: pc.displayName,
        from: m.from,
        subject: m.subject,
        quote,
        taskId: taskId ?? undefined,
      });

      break; // one agreement per potential client is enough
    }

    return { agreementsDetected, tasksRaised, detected };
  }

  // --- Agreement-PDF auto-onboard -------------------------------------------
  // A queued potential client emailed the agreement itself. Parse each PDF
  // (LLM at the edge, zod-validated); on isAgreement, promote via the SAME
  // ClientsService path the human confirm endpoint uses, file the contract
  // via the SAME upsert the POST /clients/:id/contract endpoint uses, and
  // audit every step. Zero human clicks. Returns null when no attachment is
  // an agreement — the caller falls back to text classification (which still
  // raises CONFIRM_AGREEMENT for a human).
  private async tryAgreementPdfOnboard(
    pc: PotentialClient,
    m: InboundMessage,
    mode: ConnectionStatus,
  ): Promise<DetectedAgreementDto | null> {
    const now = new Date();
    for (const att of m.attachments ?? []) {
      let parsed;
      try {
        parsed = await this.llm.parseAgreementPdf(att.data, att.filename);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.log.warn(`Agreement PDF parse failed for ${pc.id} (${att.filename}): ${reason}`);
        await this.audit.record({
          actor: AuditActor.LLM,
          action: 'email.pdf_parse_error',
          summary: `Could not parse attachment "${att.filename}" from ${pc.displayName}: ${reason.slice(0, 200)}`,
          subjectType: 'potential_client',
          subjectId: pc.id,
          inputs: { from: m.from, subject: m.subject, filename: att.filename },
        });
        continue; // never guess — try the next PDF / fall back to text
      }

      if (!parsed.isAgreement) {
        await this.audit.record({
          actor: AuditActor.LLM,
          action: 'email.pdf_no_agreement',
          summary: `Attachment "${att.filename}" from ${pc.displayName} is not an agreement.`,
          subjectType: 'potential_client',
          subjectId: pc.id,
          inputs: { from: m.from, subject: m.subject, filename: att.filename, summary: parsed.summary },
        });
        continue;
      }

      // The client name comes from the document itself when stated (e.g.
      // "Northbeam-DKaria"), falling back to the queued display name. The
      // reused promotion path names the client from the PC row, so set it
      // there — a rename, not a new code path.
      const clientName = parsed.contactName ?? pc.displayName;
      const quote =
        parsed.summary.trim().length > 0
          ? parsed.summary.trim()
          : `Agreement received: ${att.filename}`;
      const evidence: AgreementEvidence = {
        email_msg_id: m.messageId,
        quote,
        from: m.from,
        subject: m.subject,
        received_at: m.date ?? now.toISOString(),
      };

      pc.state = PotentialClientState.AGREEMENT_DETECTED;
      pc.evidence = evidence;
      pc.displayName = clientName;
      await this.pcRepo.save(pc);

      await this.audit.record({
        actor: AuditActor.ROBYN,
        action: 'email.agreement_detected',
        summary: `Agreement PDF received from ${clientName}: "${att.filename}" — onboarding automatically.`,
        subjectType: 'potential_client',
        subjectId: pc.id,
        inputs: { from: m.from, subject: m.subject, filename: att.filename, quote, mode },
      });

      // Promote via the same path as POST /potential-clients/:id/confirm.
      // It creates the Xero contact (ensureContact, idempotent) and survives
      // Xero being down or rate-limited: the client is created locally with
      // xeroContactId null and writeInvoice's ensureContact backfills later.
      let promo;
      try {
        promo = await this.clients.confirmPotentialClient(pc.id);
      } catch (err) {
        // Promotion itself failed — never a silent dead end: fall back to
        // the human CONFIRM_AGREEMENT task with the evidence we captured.
        const reason = err instanceof Error ? err.message : String(err);
        this.log.warn(`Auto-onboard promotion failed for ${pc.id}: ${reason}`);
        await this.audit.record({
          actor: AuditActor.ROBYN,
          action: 'email.auto_onboard_failed',
          summary: `Could not auto-onboard ${clientName}: ${reason.slice(0, 200)}. Raised a confirm task instead.`,
          subjectType: 'potential_client',
          subjectId: pc.id,
          inputs: { from: m.from, filename: att.filename },
        });
        const taskId = await this.raiseConfirmAgreementTask(pc, evidence);
        return {
          potentialClientId: pc.id,
          displayName: clientName,
          from: m.from,
          subject: m.subject,
          quote,
          taskId: taskId ?? undefined,
        };
      }

      await this.audit.record({
        actor: AuditActor.ROBYN,
        action: 'email.auto_onboarded',
        summary: `Onboarded ${promo.clientName} from an agreement received by email ("${att.filename}" from ${m.from}).`,
        subjectType: 'client',
        subjectId: promo.clientId,
        inputs: {
          potentialClientId: pc.id,
          filename: att.filename,
          from: m.from,
          xeroContactId: promo.xeroContactId,
          xeroContactCreated: promo.xeroContactCreated,
        },
      });
      if (promo.xeroError) {
        await this.audit.record({
          actor: AuditActor.XERO,
          action: 'email.xero_contact_deferred',
          summary: `Xero contact creation deferred for ${promo.clientName} (${promo.xeroError.slice(0, 160)}). The first invoice write will create it.`,
          subjectType: 'client',
          subjectId: promo.clientId,
          inputs: { error: promo.xeroError },
        });
      }

      // File the contract through the SAME pipeline as POST
      // /clients/:id/contract — clause parsing and the billing profile live
      // there. On parse failure the ATTACH_CONTRACT task raised by the
      // promotion stays open, so a human can retry with the text.
      try {
        await this.clients.upsertContract(promo.clientId, {
          title: att.filename,
          rawText: parsed.rawText,
        });
        await this.audit.record({
          actor: AuditActor.ROBYN,
          action: 'email.contract_filed',
          summary: `Contract "${att.filename}" filed for ${promo.clientName} from the agreement email.`,
          subjectType: 'client',
          subjectId: promo.clientId,
          inputs: { potentialClientId: pc.id, filename: att.filename, emailMsgId: m.messageId },
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.log.warn(`Contract upsert failed for auto-onboarded ${promo.clientId}: ${reason}`);
        await this.audit.record({
          actor: AuditActor.ROBYN,
          action: 'email.contract_file_failed',
          summary: `Onboarded ${promo.clientName}, but filing the contract failed: ${reason.slice(0, 200)}. The ATTACH_CONTRACT task stays open.`,
          subjectType: 'client',
          subjectId: promo.clientId,
          inputs: { filename: att.filename },
        });
      }

      // The promotion path saved its own copy of this row (state PROMOTED).
      // Refresh the caller's in-memory entity so the poll loop's later
      // lastPolledAt save cannot write stale fields back over it.
      const freshPc = await this.pcRepo.findOne({ where: { id: pc.id } });
      if (freshPc) Object.assign(pc, freshPc);

      return {
        potentialClientId: pc.id,
        displayName: promo.clientName,
        from: m.from,
        subject: m.subject,
        quote,
      };
    }
    return null;
  }

  // --- Task raise (idempotent by dedupeKey) --------------------------------
  private async raiseConfirmAgreementTask(
    pc: PotentialClient,
    evidence: AgreementEvidence,
  ): Promise<string | null> {
    const dedupeKey = `${TaskType.CONFIRM_AGREEMENT}:${pc.id}`;
    const existing = await this.taskRepo.findOne({
      where: { dedupeKey, state: TaskState.OPEN },
    });
    if (existing) return null;

    const task = this.taskRepo.create({
      type: TaskType.CONFIRM_AGREEMENT,
      refType: TaskRefType.POTENTIAL_CLIENT,
      refId: pc.id,
      state: TaskState.OPEN,
      title: `Confirm new client: ${pc.displayName}`,
      summary: `${pc.displayName} agreed to proceed: "${evidence.quote}"`,
      context: {
        potentialClientId: pc.id,
        displayName: pc.displayName,
        quote: evidence.quote,
        from: evidence.from,
        subject: evidence.subject,
        emailMsgId: evidence.email_msg_id,
        receivedAt: evidence.received_at,
        actionEndpoint: `/api/potential-clients/${pc.id}/confirm`,
        dismissEndpoint: `/api/potential-clients/${pc.id}/dismiss`,
      },
      dedupeKey,
    });
    const saved = await this.taskRepo.save(task);

    await this.audit.record({
      actor: AuditActor.ROBYN,
      action: 'task.raised',
      summary: `Raised CONFIRM_AGREEMENT task for ${pc.displayName}.`,
      subjectType: 'task',
      subjectId: saved.id,
      inputs: { type: TaskType.CONFIRM_AGREEMENT, potentialClientId: pc.id },
    });
    return saved.id;
  }

  // --- ConnectionState upsert (one EMAIL row) ------------------------------
  private async upsertEmailConnection(
    status: ConnectionStatus,
    cfg: ReturnType<typeof loadConfig>,
    detail: string,
    lastSyncAt: Date,
    nextPollAt: Date,
  ): Promise<void> {
    let row = await this.connRepo.findOne({ where: { kind: ConnectionKind.EMAIL } });
    if (!row) {
      row = this.connRepo.create({ kind: ConnectionKind.EMAIL });
    }
    row.status = status;
    row.label = cfg.imap.configured ? cfg.imap.user : 'fixture mailbox';
    row.detail = detail;
    row.lastSyncAt = lastSyncAt;
    row.nextPollAt = nextPollAt;
    await this.connRepo.save(row);
  }

  private connectionDetail(
    cfg: ReturnType<typeof loadConfig>,
    status: ConnectionStatus,
  ): string {
    if (status === ConnectionStatus.LIVE) {
      return `Connected to IMAP mailbox ${cfg.imap.user}. Reads only queued client senders.`;
    }
    if (status === ConnectionStatus.DOWN) {
      return `IMAP configured for ${cfg.imap.user} but unreachable this poll. Local state kept; no messages read.`;
    }
    return 'No IMAP credentials. Reading the seeded fixture mailbox (seed/data/mailbox). Reads only queued client senders.';
  }

  // --- Fixture mailbox reader ----------------------------------------------
  // Each *.json file is either a single message object or an array of them.
  // Field names are read defensively so a hand-written fixture still loads.
  private async readFixtureMailbox(): Promise<InboundMessage[]> {
    const dir = await this.resolveFixtureDir();
    if (!dir) {
      this.log.warn('Fixture mailbox directory not found — treating as empty.');
      return [];
    }
    let files: string[];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.json'));
    } catch {
      return [];
    }

    const out: InboundMessage[] = [];
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        const raw = await fs.readFile(full, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        const records = Array.isArray(parsed) ? parsed : [parsed];
        for (const rec of records) {
          const msg = this.normaliseRecord(rec, f);
          if (msg) out.push(msg);
        }
      } catch (err) {
        this.log.warn(`Skipping unreadable fixture ${f}: ${String(err).slice(0, 160)}`);
      }
    }
    return out;
  }

  private async resolveFixtureDir(): Promise<string | null> {
    const candidates = [
      path.resolve(process.cwd(), 'seed/data/mailbox'),
      path.resolve(process.cwd(), '../seed/data/mailbox'),
      path.resolve(__dirname, '../../../../seed/data/mailbox'),
      path.resolve(__dirname, '../../../../../seed/data/mailbox'),
    ];
    for (const c of candidates) {
      try {
        const st = await fs.stat(c);
        if (st.isDirectory()) return c;
      } catch {
        // try next
      }
    }
    return null;
  }

  private normaliseRecord(rec: unknown, file: string): InboundMessage | null {
    if (!rec || typeof rec !== 'object') return null;
    const r = rec as Record<string, unknown>;
    const str = (...keys: string[]): string => {
      for (const k of keys) {
        const v = r[k];
        if (typeof v === 'string' && v.trim().length > 0) return v;
      }
      return '';
    };
    const from = str('from', 'From', 'sender');
    if (!from) return null;
    const dateRaw = str('date', 'received_at', 'receivedAt', 'Date');
    return {
      from,
      subject: str('subject', 'Subject'),
      body: str('body', 'text', 'Body', 'html'),
      date: dateRaw ? this.toIso(dateRaw) : null,
      messageId: str('messageId', 'message_id', 'id', 'Message-ID') || `${file}:${from}`,
    };
  }

  // --- IMAP reader (queued senders ONLY) -----------------------------------
  // Live path: one search per queued address, SINCE lastPolledAt. The search is
  // scoped to a specific sender so a non-queued address is never fetched.
  private async readImapForSenders(
    cfg: ReturnType<typeof loadConfig>,
    addrs: string[],
    since: Date | null,
  ): Promise<InboundMessage[]> {
    // Lazy imports so the OpenAPI export / non-IMAP boot never loads them.
    const { ImapFlow } = await import('imapflow');
    const { simpleParser } = await import('mailparser');

    const client = new ImapFlow({
      host: cfg.imap.host,
      port: cfg.imap.port,
      secure: true,
      auth: { user: cfg.imap.user, pass: cfg.imap.password },
      logger: false,
    });

    const out: InboundMessage[] = [];
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        for (const addr of addrs) {
          const query: { from: string; since?: Date } = { from: addr };
          if (since) query.since = since;
          const uids = await client.search(query, { uid: true });
          if (!uids || uids.length === 0) continue;
          for await (const msg of client.fetch(
            uids,
            { envelope: true, source: true },
            { uid: true },
          )) {
            let subject = msg.envelope?.subject ?? '';
            let body = '';
            let messageId = msg.envelope?.messageId ?? '';
            let date: string | null = msg.envelope?.date
              ? msg.envelope.date.toISOString()
              : null;
            if (msg.source) {
              const parsed = await simpleParser(msg.source);
              if (parsed.subject) subject = parsed.subject;
              body = parsed.text ?? '';
              if (parsed.messageId) messageId = parsed.messageId;
              if (parsed.date) date = parsed.date.toISOString();
            }
            if (!messageId) messageId = `${addr}:${msg.uid}`;
            out.push({ from: addr, subject, body, date, messageId });
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return out;
  }

  // --- helpers --------------------------------------------------------------
  // Public: the Google module normalises queued-sender addresses with the same
  // rule before building its Gmail query.
  normaliseAddress(raw: string): string {
    if (!raw) return '';
    const angled = raw.match(/<([^>]+)>/);
    const addr = angled ? angled[1] : raw;
    return addr.trim().toLowerCase();
  }

  private isNewMessage(m: InboundMessage, lastPolledAt: Date | null): boolean {
    if (!lastPolledAt) return true;
    if (!m.date) return true; // undateable fixture — treat as new
    const t = Date.parse(m.date);
    if (Number.isNaN(t)) return true;
    return t > lastPolledAt.getTime();
  }

  private toIso(raw: string): string {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? raw : new Date(t).toISOString();
  }
}
