import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEvent, AuditActor } from '../../entities';

export interface RecordAudit {
  actor: AuditActor;
  action: string;
  summary: string;
  subjectType?: string;
  subjectId?: string;
  inputs?: Record<string, unknown>;
}

// Every state change, Xero write, policy decision and poll result goes through
// here. No silent mutations anywhere in the codebase.
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditEvent)
    private readonly repo: Repository<AuditEvent>,
  ) {}

  async record(e: RecordAudit): Promise<AuditEvent> {
    const ev = this.repo.create({
      actor: e.actor,
      action: e.action,
      summary: e.summary,
      subjectType: e.subjectType ?? null,
      subjectId: e.subjectId ?? null,
      inputs: e.inputs ?? null,
    });
    return this.repo.save(ev);
  }

  async list(limit = 200): Promise<AuditEvent[]> {
    return this.repo.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  async listForSubject(subjectId: string, limit = 100): Promise<AuditEvent[]> {
    return this.repo.find({
      where: { subjectId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
