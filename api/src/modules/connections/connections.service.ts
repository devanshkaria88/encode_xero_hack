import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConnectionState,
  ConnectionKind,
  ConnectionStatus,
  AuditActor,
} from '../../entities';
import { XeroService } from '../xero/xero.service';
import { AuditService } from '../audit/audit.service';
import { ConnectionRowDto } from './dto/connection-row.dto';

// The Connections panel. READ + refresh only. Owns the XERO row (computed live
// from Xero.health()) and surfaces the CALENDAR/EMAIL rows that their own
// modules upsert. It never triggers calendar/email jobs — those have their own
// "run now" endpoints (POST /meetings/sync, POST /email/poll).
@Injectable()
export class ConnectionsService {
  private readonly log = new Logger('ConnectionsService');

  constructor(
    @InjectRepository(ConnectionState)
    private readonly repo: Repository<ConnectionState>,
    private readonly xero: XeroService,
    private readonly audit: AuditService,
  ) {}

  // The Xero probe result is cached: two UI elements poll GET /connections at
  // 60s each, and an uncached probe per poll burns the tenant's daily API
  // budget (starter tier: 1,000 calls/day). Reads serve the cache; the
  // explicit recheck endpoint always probes fresh.
  private xeroProbeCache: { row: ConnectionRowDto; at: number } | null = null;
  private static readonly XERO_PROBE_TTL_MS = 300_000;

  // GET /connections — three rows in a stable order: XERO, CALENDAR, EMAIL.
  // XERO is probed live but rate-limited by the cache above; CALENDAR/EMAIL
  // are read from their ConnectionState rows, defaulting to DOWN if never run.
  async list(): Promise<ConnectionRowDto[]> {
    const xeroRow = await this.probeXeroCached();
    const calendarRow = await this.readRow(
      ConnectionKind.CALENDAR,
      'Calendar not yet connected. Run a sync to ingest meetings.',
    );
    const emailRow = await this.readRow(
      ConnectionKind.EMAIL,
      'Mailbox not yet polled. Run a poll to check for client agreements.',
    );
    return [xeroRow, calendarRow, emailRow];
  }

  // POST /connections/xero/recheck — force a fresh Xero health probe, persist the
  // XERO ConnectionState row, audit the probe, and return the refreshed row.
  async recheckXero(): Promise<ConnectionRowDto> {
    const row = await this.probeXero();
    this.xeroProbeCache = { row, at: Date.now() };

    // Upsert the XERO ConnectionState row (idempotent by unique `kind`).
    let entity = await this.repo.findOne({ where: { kind: ConnectionKind.XERO } });
    if (!entity) {
      entity = this.repo.create({ kind: ConnectionKind.XERO });
    }
    entity.status = row.status;
    entity.label = row.label;
    entity.detail = row.detail;
    entity.lastSyncAt = row.lastSyncAt ? new Date(row.lastSyncAt) : null;
    entity.nextPollAt = null;
    await this.repo.save(entity);

    await this.audit.record({
      actor: AuditActor.SYSTEM,
      action: 'connection.xero.recheck',
      summary:
        row.status === ConnectionStatus.LIVE
          ? `Xero health check: LIVE (${row.label ?? 'org'})`
          : `Xero health check: DOWN (${row.detail ?? 'unknown reason'})`,
      subjectType: 'ConnectionState',
      subjectId: entity.id,
      inputs: { status: row.status, label: row.label, detail: row.detail },
    });

    return row;
  }

  private async probeXeroCached(): Promise<ConnectionRowDto> {
    const cached = this.xeroProbeCache;
    if (cached && Date.now() - cached.at < ConnectionsService.XERO_PROBE_TTL_MS) {
      return cached.row;
    }
    const row = await this.probeXero();
    this.xeroProbeCache = { row, at: Date.now() };
    return row;
  }

  // Live Xero probe → a XERO row. Xero has no FALLBACK: it is LIVE (creds working)
  // or DOWN (creds pending / probe failed). Never crashes on a Xero outage.
  private async probeXero(): Promise<ConnectionRowDto> {
    const now = new Date();
    try {
      const h = await this.xero.health();
      if (h.ok) {
        return {
          kind: ConnectionKind.XERO,
          status: ConnectionStatus.LIVE,
          label: h.orgName ?? 'Xero organisation',
          detail: h.scope
            ? `Connected via Custom Connection. Scopes: ${h.scope}`
            : 'Connected via Custom Connection.',
          lastSyncAt: now.toISOString(),
          nextPollAt: null,
        };
      }
      return {
        kind: ConnectionKind.XERO,
        status: ConnectionStatus.DOWN,
        label: h.orgName,
        detail: h.reason ?? 'Xero not connected. Credentials pending.',
        lastSyncAt: null,
        nextPollAt: null,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log.warn(`Xero health probe threw: ${reason}`);
      return {
        kind: ConnectionKind.XERO,
        status: ConnectionStatus.DOWN,
        label: null,
        detail: `Xero health probe failed: ${reason}`,
        lastSyncAt: null,
        nextPollAt: null,
      };
    }
  }

  // Read a persisted ConnectionState row (CALENDAR/EMAIL). Defaults to a DOWN
  // row with a helpful detail when the owning module has never run its job.
  private async readRow(
    kind: ConnectionKind,
    neverRunDetail: string,
  ): Promise<ConnectionRowDto> {
    const row = await this.repo.findOne({ where: { kind } });
    if (!row) {
      return {
        kind,
        status: ConnectionStatus.DOWN,
        label: null,
        detail: neverRunDetail,
        lastSyncAt: null,
        nextPollAt: null,
      };
    }
    return {
      kind: row.kind,
      status: row.status,
      label: row.label,
      detail: row.detail,
      lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
      nextPollAt: row.nextPollAt ? row.nextPollAt.toISOString() : null,
    };
  }
}
