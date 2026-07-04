import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import {
  Task,
  Meeting,
  InvoiceProposal,
  PotentialClient,
  Client,
  TaskState,
  TaskType,
  TaskRefType,
} from '../../entities';
import { TaskDto } from './dto/task.dto';
import { TaskCountsDto } from './dto/task-counts.dto';

// Lookup maps used to enrich a batch of tasks without N+1 queries.
interface EnrichMaps {
  meetingById: Map<string, Meeting>;
  proposalById: Map<string, InvoiceProposal>;
  pcById: Map<string, PotentialClient>;
  clientById: Map<string, Client>;
}

// The Tasks inbox is READ-ONLY. It lists tasks and enriches the render context;
// it never resolves anything — each card calls the owning module's endpoint,
// which flips the task. Resolution logic deliberately lives nowhere in here.
@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(Meeting)
    private readonly meetings: Repository<Meeting>,
    @InjectRepository(InvoiceProposal)
    private readonly proposals: Repository<InvoiceProposal>,
    @InjectRepository(PotentialClient)
    private readonly potentialClients: Repository<PotentialClient>,
    @InjectRepository(Client)
    private readonly clients: Repository<Client>,
  ) {}

  // GET /tasks — OPEN tasks, newest first.
  async listOpen(): Promise<TaskDto[]> {
    const rows = await this.tasks.find({
      where: { state: TaskState.OPEN },
      order: { createdAt: 'DESC' },
    });
    return this.enrichMany(rows);
  }

  // GET /tasks/all — every task (optionally filtered by state), newest first.
  async listAll(state?: TaskState): Promise<TaskDto[]> {
    const where: FindOptionsWhere<Task> = state ? { state } : {};
    const rows = await this.tasks.find({ where, order: { createdAt: 'DESC' } });
    return this.enrichMany(rows);
  }

  // GET /tasks/counts — OPEN task counts by type (inbox badges). Every type is
  // present with a count (0 when none) so badges are stable.
  async counts(): Promise<TaskCountsDto> {
    const open = await this.tasks.find({ where: { state: TaskState.OPEN } });
    const byTypeMap = new Map<TaskType, number>();
    for (const t of Object.values(TaskType)) byTypeMap.set(t, 0);
    for (const row of open) byTypeMap.set(row.type, (byTypeMap.get(row.type) ?? 0) + 1);
    return {
      total: open.length,
      byType: [...byTypeMap.entries()].map(([type, count]) => ({ type, count })),
    };
  }

  // ---- enrichment ----------------------------------------------------------

  private isEmptyContext(ctx: Record<string, unknown> | null): boolean {
    return !ctx || Object.keys(ctx).length === 0;
  }

  // Deterministic action hint: which endpoint resolves this task type. The
  // owning module may store its own `action` in context; this is the fallback
  // so a card always knows where to POST even if context was minimal.
  private actionFor(task: Task): { method: string; path: string } | null {
    switch (task.type) {
      case TaskType.PROVIDE_TRANSCRIPT:
        return { method: 'POST', path: `/meetings/${task.refId}/transcript` };
      case TaskType.CONFIRM_CLIENT_MATCH:
        return { method: 'POST', path: `/meetings/${task.refId}/confirm-client` };
      case TaskType.REVIEW_INVOICE:
        return { method: 'POST', path: `/proposals/${task.refId}/approve` };
      case TaskType.CONFIRM_AGREEMENT:
        return { method: 'POST', path: `/potential-clients/${task.refId}/confirm` };
      case TaskType.ATTACH_CONTRACT:
        return { method: 'POST', path: `/clients/${task.refId}/contract` };
      default:
        return null;
    }
  }

  private async enrichMany(rows: Task[]): Promise<TaskDto[]> {
    // Only look up entities for tasks whose stored context is missing — we
    // prefer the stored Task.context and fall back to the live entity.
    const need = rows.filter((t) => this.isEmptyContext(t.context));

    const meetingIds = new Set<string>();
    const proposalIds = new Set<string>();
    const pcIds = new Set<string>();
    const clientIds = new Set<string>();

    for (const t of need) {
      if (t.refType === TaskRefType.MEETING) meetingIds.add(t.refId);
      else if (t.refType === TaskRefType.PROPOSAL) proposalIds.add(t.refId);
      else if (t.refType === TaskRefType.POTENTIAL_CLIENT) pcIds.add(t.refId);
      else if (t.refType === TaskRefType.CLIENT) clientIds.add(t.refId);
    }

    const meetings = meetingIds.size
      ? await this.meetings.find({ where: { id: In([...meetingIds]) } })
      : [];
    const proposals = proposalIds.size
      ? await this.proposals.find({ where: { id: In([...proposalIds]) } })
      : [];
    const pcs = pcIds.size
      ? await this.potentialClients.find({ where: { id: In([...pcIds]) } })
      : [];

    // Meetings/proposals reference a client — resolve those names too.
    for (const m of meetings) if (m.clientId) clientIds.add(m.clientId);
    for (const p of proposals) if (p.clientId) clientIds.add(p.clientId);

    const clients = clientIds.size
      ? await this.clients.find({ where: { id: In([...clientIds]) } })
      : [];

    const maps: EnrichMaps = {
      meetingById: new Map(meetings.map((m) => [m.id, m])),
      proposalById: new Map(proposals.map((p) => [p.id, p])),
      pcById: new Map(pcs.map((p) => [p.id, p])),
      clientById: new Map(clients.map((c) => [c.id, c])),
    };

    return rows.map((t) => this.toDto(t, maps));
  }

  private toDto(task: Task, maps: EnrichMaps): TaskDto {
    const context: Record<string, unknown> = this.isEmptyContext(task.context)
      ? this.fallbackContext(task, maps)
      : { ...(task.context as Record<string, unknown>) };

    // Ensure the card always knows the resolution endpoint.
    if (!('action' in context)) {
      const action = this.actionFor(task);
      if (action) context.action = action;
    }

    return {
      id: task.id,
      type: task.type,
      refType: task.refType,
      refId: task.refId,
      state: task.state,
      title: task.title,
      summary: task.summary ?? null,
      context,
      resolution: task.resolution ?? null,
      resolvedAt: task.resolvedAt ? task.resolvedAt.toISOString() : null,
      createdAt: task.createdAt.toISOString(),
    };
  }

  // Build a minimal render context from the referenced entity when the task
  // stored none. Best-effort: missing entities just yield a thinner card.
  private fallbackContext(task: Task, maps: EnrichMaps): Record<string, unknown> {
    const ctx: Record<string, unknown> = {};

    if (task.refType === TaskRefType.MEETING) {
      const m = maps.meetingById.get(task.refId);
      if (m) {
        ctx.meetingTitle = m.title;
        ctx.start = m.start instanceof Date ? m.start.toISOString() : m.start;
        ctx.end = m.end instanceof Date ? m.end.toISOString() : m.end;
        ctx.durationHours = Number(m.durationHours);
        ctx.meetingState = m.state;
        ctx.attendees = m.attendees;
        if (m.clientId) {
          const c = maps.clientById.get(m.clientId);
          if (c) ctx.clientName = c.name;
        }
      }
    } else if (task.refType === TaskRefType.PROPOSAL) {
      const p = maps.proposalById.get(task.refId);
      if (p) {
        ctx.total = Number(p.total);
        ctx.currency = p.currency;
        ctx.proposalState = p.state;
        ctx.lineCount = Array.isArray(p.lines) ? p.lines.length : 0;
        const c = maps.clientById.get(p.clientId);
        if (c) ctx.clientName = c.name;
      }
    } else if (task.refType === TaskRefType.POTENTIAL_CLIENT) {
      const pc = maps.pcById.get(task.refId);
      if (pc) {
        ctx.displayName = pc.displayName;
        ctx.emails = pc.emails;
        ctx.potentialClientState = pc.state;
        if (pc.evidence?.quote) ctx.quote = pc.evidence.quote;
      }
    } else if (task.refType === TaskRefType.CLIENT) {
      const c = maps.clientById.get(task.refId);
      if (c) ctx.clientName = c.name;
    }
    // DETECTION and any unmatched refType rely on stored context only.

    return ctx;
  }
}
