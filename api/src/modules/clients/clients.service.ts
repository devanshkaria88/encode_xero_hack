import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Client,
  Contract,
  PotentialClient,
  Task,
  InvoiceProposal,
  AuditActor,
  BillingSource,
  InvoiceProposalState,
  PotentialClientState,
  TaskType,
  TaskState,
  TaskRefType,
  BillingProfile,
} from '../../entities';
import { LlmService } from '../llm/llm.service';
import { XeroService } from '../xero/xero.service';
import { AuditService } from '../audit/audit.service';
import {
  BillingProfileDto,
  ClientDetailDto,
  ClientListItemDto,
  ContractDto,
  ContractSummaryDto,
  InvoiceHistoryItemDto,
  PotentialClientDto,
  PromoteResultDto,
} from './dto/responses.dto';
import { UpsertContractDto } from './dto/requests.dto';

// Clients, contracts, autonomy toggle and the potential-client queue. Owns the
// ATTACH_CONTRACT and CONFIRM_AGREEMENT task lifecycle. Every mutation writes an
// AuditEvent; the LLM only parses contracts, it never decides billing.
@Injectable()
export class ClientsService {
  private readonly log = new Logger('ClientsService');

  constructor(
    @InjectRepository(Client) private readonly clients: Repository<Client>,
    @InjectRepository(Contract) private readonly contracts: Repository<Contract>,
    @InjectRepository(PotentialClient) private readonly potentials: Repository<PotentialClient>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(InvoiceProposal) private readonly proposals: Repository<InvoiceProposal>,
    private readonly llm: LlmService,
    private readonly xero: XeroService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- Clients

  async listClients(): Promise<ClientListItemDto[]> {
    const clients = await this.clients.find({ order: { name: 'ASC' } });
    if (clients.length === 0) return [];
    const ids = clients.map((c) => c.id);
    const [contracts, proposals] = await Promise.all([
      this.contracts.find(),
      this.proposals.find(),
    ]);
    const contractByClient = this.latestContractByClient(contracts, ids);
    return clients.map((c) => {
      const clientProposals = proposals.filter((p) => p.clientId === c.id);
      return this.toListItem(c, contractByClient.get(c.id) ?? null, clientProposals);
    });
  }

  async getClient(id: string): Promise<ClientDetailDto> {
    const client = await this.mustFindClient(id);
    const contract = await this.latestContract(id);
    const proposals = await this.proposals.find({
      where: { clientId: id },
      order: { createdAt: 'DESC' },
    });
    const history = proposals
      .filter((p) => p.state === InvoiceProposalState.SENT)
      .map((p) => this.toHistoryItem(p));
    return {
      id: client.id,
      name: client.name,
      emails: client.emails ?? [],
      xeroContactId: client.xeroContactId,
      autonomyEnabled: client.autonomyEnabled,
      billingProfile: this.toBillingProfileDto(client.billingProfile),
      contract: contract ? this.toContractDto(contract) : null,
      invoiceHistory: history,
      unbilledExposureGbp: this.unbilledExposure(proposals),
      createdAt: client.createdAt.toISOString(),
    };
  }

  async setAutonomy(id: string, enabled: boolean): Promise<ClientListItemDto> {
    const client = await this.mustFindClient(id);
    const previous = client.autonomyEnabled;
    client.autonomyEnabled = enabled;
    await this.clients.save(client);
    await this.audit.record({
      actor: AuditActor.HUMAN,
      action: 'client.autonomy.toggled',
      summary: `Autonomy for ${client.name} turned ${enabled ? 'ON' : 'OFF'} (was ${previous ? 'ON' : 'OFF'}).`,
      subjectType: 'client',
      subjectId: client.id,
      inputs: { enabled, previous },
    });
    const contract = await this.latestContract(id);
    const proposals = await this.proposals.find({ where: { clientId: id } });
    return this.toListItem(client, contract, proposals);
  }

  // POST /clients/:id/contract — parse and file a contract, set the billing
  // profile from its clauses, and resolve any ATTACH_CONTRACT task.
  async upsertContract(id: string, body: UpsertContractDto): Promise<ContractDto> {
    const client = await this.mustFindClient(id);

    // LLM edge: parse the contract into strict, zod-validated JSON. On failure
    // we do NOT guess — the error propagates and the ATTACH_CONTRACT task stays
    // open for the human to retry.
    const parsed = await this.llm.parseContract(body.rawText);
    await this.audit.record({
      actor: AuditActor.LLM,
      action: 'client.contract.parsed',
      summary: `Parsed contract for ${client.name}: rate ${parsed.rate ?? 'n/a'} ${parsed.rate_unit ?? ''}, ${parsed.clauses.length} clause(s).`,
      subjectType: 'client',
      subjectId: client.id,
      inputs: { title: body.title ?? null, clauses: parsed.clauses.length },
    });

    let contract = await this.latestContract(id);
    if (!contract) {
      contract = this.contracts.create({ clientId: id });
    }
    contract.title = body.title ?? contract.title ?? null;
    contract.fileRef = body.title ?? contract.fileRef ?? 'pasted-contract';
    contract.rawText = body.rawText;
    contract.parsed = {
      rate: parsed.rate,
      rate_unit: parsed.rate_unit,
      currency: parsed.currency,
      payment_terms: parsed.payment_terms,
      scope_summary: parsed.scope_summary,
      clauses: parsed.clauses,
    };
    contract = await this.contracts.save(contract);

    // Set the client's billing profile from the contract (source = CONTRACT).
    const provenance = parsed.clauses.length ? parsed.clauses[0].ref : 'Contract';
    const profile: BillingProfile = {
      rate: parsed.rate,
      rate_unit: parsed.rate_unit,
      currency: parsed.currency,
      cadence: client.billingProfile?.cadence ?? null,
      terms: parsed.payment_terms,
      source: BillingSource.CONTRACT,
      provenance,
    };
    client.billingProfile = profile;
    await this.clients.save(client);

    await this.audit.record({
      actor: AuditActor.ROBYN,
      action: 'client.contract.attached',
      summary: `Contract filed for ${client.name}. Billing profile set from ${provenance}.`,
      subjectType: 'client',
      subjectId: client.id,
      inputs: { contractId: contract.id, provenance },
    });

    // Resolve the ATTACH_CONTRACT task now that a contract is on file.
    await this.resolveTasks(TaskType.ATTACH_CONTRACT, client.id, `Contract filed (${provenance}).`);

    return this.toContractDto(contract);
  }

  async getContract(id: string): Promise<ContractDto | null> {
    await this.mustFindClient(id);
    const contract = await this.latestContract(id);
    return contract ? this.toContractDto(contract) : null;
  }

  // ------------------------------------------------------- Potential clients

  async listPotentialClients(): Promise<PotentialClientDto[]> {
    const rows = await this.potentials.find({ order: { createdAt: 'DESC' } });
    return rows.map((p) => this.toPotentialDto(p));
  }

  // POST /potential-clients/:id/confirm — the Loop-2 finish. Promote the
  // prospect into a real Client (creating the Xero contact), raise
  // ATTACH_CONTRACT, and resolve the CONFIRM_AGREEMENT task.
  async confirmPotentialClient(id: string): Promise<PromoteResultDto> {
    const pc = await this.potentials.findOne({ where: { id } });
    if (!pc) throw new NotFoundException(`Potential client ${id} not found`);

    // If already promoted, return the existing linkage idempotently.
    if (pc.state === PotentialClientState.PROMOTED && pc.promotedClientId) {
      const existing = await this.clients.findOne({ where: { id: pc.promotedClientId } });
      return {
        clientId: pc.promotedClientId,
        clientName: existing?.name ?? pc.displayName,
        xeroContactId: existing?.xeroContactId ?? null,
        xeroContactCreated: false,
        xeroError: null,
        attachContractTaskId: null,
        potentialClient: this.toPotentialDto(pc),
      };
    }

    const primaryEmail = pc.emails?.[0];

    // Xero write (idempotent ensureContact). Xero may not be live — on failure
    // keep the local promotion and surface the error, never crash.
    let xeroContactId: string | null = null;
    let xeroCreated = false;
    let xeroError: string | null = null;
    try {
      const { contact, created } = await this.xero.ensureContact(pc.displayName, primaryEmail);
      xeroContactId = contact.ContactID;
      xeroCreated = created;
      await this.audit.record({
        actor: AuditActor.XERO,
        action: 'xero.contact.ensured',
        summary: `Xero contact ${created ? 'created' : 'reused'} for ${pc.displayName} (${xeroContactId}).`,
        subjectType: 'potential_client',
        subjectId: pc.id,
        inputs: { contactId: xeroContactId, created, email: primaryEmail ?? null },
      });
    } catch (e) {
      xeroError = e instanceof Error ? e.message : String(e);
      this.log.warn(`ensureContact failed for ${pc.displayName}: ${xeroError}`);
      await this.audit.record({
        actor: AuditActor.XERO,
        action: 'xero.contact.failed',
        summary: `Could not create Xero contact for ${pc.displayName}: ${xeroError}. Promoted locally; will backfill when Xero is live.`,
        subjectType: 'potential_client',
        subjectId: pc.id,
        inputs: { error: xeroError },
      });
    }

    // Create the real Client (local promotion completes regardless of Xero).
    const client = await this.clients.save(
      this.clients.create({
        name: pc.displayName,
        emails: pc.emails ?? [],
        xeroContactId,
        autonomyEnabled: false,
        billingProfile: null,
        unbilledExposureGbp: 0,
      }),
    );

    pc.state = PotentialClientState.PROMOTED;
    pc.promotedClientId = client.id;
    await this.potentials.save(pc);

    await this.audit.record({
      actor: AuditActor.HUMAN,
      action: 'potential_client.promoted',
      summary: `${pc.displayName} promoted to a client. Rule 1 (calendar → invoice) now applies to them.`,
      subjectType: 'client',
      subjectId: client.id,
      inputs: { potentialClientId: pc.id, xeroContactId, xeroError },
    });

    // Raise ATTACH_CONTRACT for the new client so a contract gets filed.
    const attachTask = await this.raiseTask(
      TaskType.ATTACH_CONTRACT,
      TaskRefType.CLIENT,
      client.id,
      `File a contract for ${client.name}`,
      `Robyn onboarded ${client.name} from an agreement email. Attach their contract so rates and terms are cited on every invoice.`,
      { clientId: client.id, clientName: client.name },
    );

    // Resolve the CONFIRM_AGREEMENT task raised by the Email module.
    await this.resolveTasks(
      TaskType.CONFIRM_AGREEMENT,
      pc.id,
      `Confirmed — promoted to client ${client.name}.`,
    );

    return {
      clientId: client.id,
      clientName: client.name,
      xeroContactId,
      xeroContactCreated: xeroCreated,
      xeroError,
      attachContractTaskId: attachTask?.id ?? null,
      potentialClient: this.toPotentialDto(pc),
    };
  }

  async dismissPotentialClient(id: string, reason?: string): Promise<PotentialClientDto> {
    const pc = await this.potentials.findOne({ where: { id } });
    if (!pc) throw new NotFoundException(`Potential client ${id} not found`);
    pc.state = PotentialClientState.DISMISSED;
    await this.potentials.save(pc);
    await this.resolveTasks(
      TaskType.CONFIRM_AGREEMENT,
      pc.id,
      `Dismissed${reason ? `: ${reason}` : ''}.`,
    );
    await this.audit.record({
      actor: AuditActor.HUMAN,
      action: 'potential_client.dismissed',
      summary: `${pc.displayName} dismissed from the pipeline${reason ? `: ${reason}` : ''}.`,
      subjectType: 'potential_client',
      subjectId: pc.id,
      inputs: { reason: reason ?? null },
    });
    return this.toPotentialDto(pc);
  }

  // -------------------------------------------------------------- Task helpers

  // Idempotent: at most one OPEN task per (type, refId). Re-opens a resolved one
  // rather than violating the unique dedupeKey constraint.
  private async raiseTask(
    type: TaskType,
    refType: TaskRefType,
    refId: string,
    title: string,
    summary: string,
    context: Record<string, unknown>,
  ): Promise<Task> {
    const dedupeKey = `${type}:${refId}`;
    const existing = await this.tasks.findOne({ where: { dedupeKey } });
    if (existing) {
      if (existing.state === TaskState.OPEN) return existing;
      existing.state = TaskState.OPEN;
      existing.resolvedAt = null;
      existing.resolution = null;
      existing.title = title;
      existing.summary = summary;
      existing.context = context;
      return this.tasks.save(existing);
    }
    const task = this.tasks.create({
      type,
      refType,
      refId,
      state: TaskState.OPEN,
      title,
      summary,
      context,
      dedupeKey,
    });
    const saved = await this.tasks.save(task);
    await this.audit.record({
      actor: AuditActor.ROBYN,
      action: 'task.raised',
      summary: `Task raised: ${title}.`,
      subjectType: 'task',
      subjectId: saved.id,
      inputs: { type, refType, refId },
    });
    return saved;
  }

  private async resolveTasks(type: TaskType, refId: string, resolution: string): Promise<number> {
    const open = await this.tasks.find({ where: { type, refId, state: TaskState.OPEN } });
    for (const t of open) {
      t.state = TaskState.RESOLVED;
      t.resolvedAt = new Date();
      t.resolution = resolution;
      await this.tasks.save(t);
      await this.audit.record({
        actor: AuditActor.ROBYN,
        action: 'task.resolved',
        summary: `Task resolved (${type}): ${resolution}`,
        subjectType: 'task',
        subjectId: t.id,
        inputs: { type, refId },
      });
    }
    return open.length;
  }

  // -------------------------------------------------------------- Mappers

  private async mustFindClient(id: string): Promise<Client> {
    const client = await this.clients.findOne({ where: { id } });
    if (!client) throw new NotFoundException(`Client ${id} not found`);
    return client;
  }

  private async latestContract(clientId: string): Promise<Contract | null> {
    return this.contracts.findOne({ where: { clientId }, order: { createdAt: 'DESC' } });
  }

  private latestContractByClient(contracts: Contract[], clientIds: string[]): Map<string, Contract> {
    const map = new Map<string, Contract>();
    const wanted = new Set(clientIds);
    for (const c of contracts) {
      if (!wanted.has(c.clientId)) continue;
      const current = map.get(c.clientId);
      if (!current || c.createdAt.getTime() > current.createdAt.getTime()) {
        map.set(c.clientId, c);
      }
    }
    return map;
  }

  private unbilledExposure(proposals: InvoiceProposal[]): number {
    const sum = proposals
      .filter(
        (p) =>
          p.state === InvoiceProposalState.DRAFT || p.state === InvoiceProposalState.IN_REVIEW,
      )
      .reduce((acc, p) => acc + Number(p.total), 0);
    return Math.round(sum * 100) / 100;
  }

  private toListItem(
    client: Client,
    contract: Contract | null,
    proposals: InvoiceProposal[],
  ): ClientListItemDto {
    const sentCount = proposals.filter((p) => p.state === InvoiceProposalState.SENT).length;
    return {
      id: client.id,
      name: client.name,
      emails: client.emails ?? [],
      xeroContactId: client.xeroContactId,
      autonomyEnabled: client.autonomyEnabled,
      billingProfile: this.toBillingProfileDto(client.billingProfile),
      contract: this.toContractSummary(client, contract),
      unbilledExposureGbp: this.unbilledExposure(proposals),
      invoiceHistoryCount: sentCount,
    };
  }

  private toContractSummary(client: Client, contract: Contract | null): ContractSummaryDto {
    const profile = client.billingProfile;
    const parsed = contract?.parsed ?? null;
    return {
      hasContract: !!contract,
      title: contract?.title ?? null,
      rate: profile?.rate ?? parsed?.rate ?? null,
      rateUnit: profile?.rate_unit ?? parsed?.rate_unit ?? null,
      currency: profile?.currency ?? parsed?.currency ?? null,
      terms: profile?.terms ?? parsed?.payment_terms ?? null,
      source: profile?.source ?? (contract ? BillingSource.CONTRACT : null),
    };
  }

  private toBillingProfileDto(profile: BillingProfile | null): BillingProfileDto | null {
    if (!profile) return null;
    return {
      rate: profile.rate,
      rateUnit: profile.rate_unit,
      currency: profile.currency,
      cadence: profile.cadence,
      terms: profile.terms,
      source: profile.source,
      provenance: profile.provenance,
    };
  }

  private toContractDto(contract: Contract): ContractDto {
    const parsed = contract.parsed;
    return {
      id: contract.id,
      clientId: contract.clientId,
      title: contract.title,
      fileRef: contract.fileRef,
      rawText: contract.rawText,
      rate: parsed?.rate ?? null,
      rateUnit: parsed?.rate_unit ?? null,
      currency: parsed?.currency ?? 'GBP',
      paymentTerms: parsed?.payment_terms ?? null,
      scopeSummary: parsed?.scope_summary ?? null,
      clauses: parsed?.clauses ?? [],
      createdAt: contract.createdAt.toISOString(),
      updatedAt: contract.updatedAt.toISOString(),
    };
  }

  private toHistoryItem(p: InvoiceProposal): InvoiceHistoryItemDto {
    return {
      id: p.id,
      state: p.state,
      total: Number(p.total),
      currency: p.currency,
      reference: p.reference,
      xeroInvoiceNumber: p.xeroInvoiceNumber,
      xeroDeepLink: p.xeroDeepLink,
      autoSent: p.autoSent,
      createdAt: p.createdAt.toISOString(),
    };
  }

  private toPotentialDto(p: PotentialClient): PotentialClientDto {
    return {
      id: p.id,
      displayName: p.displayName,
      emails: p.emails ?? [],
      state: p.state,
      firstSeenMeetingId: p.firstSeenMeetingId,
      evidenceQuote: p.evidence?.quote ?? null,
      evidenceFrom: p.evidence?.from ?? null,
      promotedClientId: p.promotedClientId,
      lastPolledAt: p.lastPolledAt ? p.lastPolledAt.toISOString() : null,
    };
  }
}
