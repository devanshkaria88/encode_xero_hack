import { EmailService, InboundMessage } from './email.service';
import { ConnectionStatus, PotentialClient, PotentialClientState } from '../../entities';
import type { LlmService } from '../llm/llm.service';
import type { AuditService } from '../audit/audit.service';
import type { ClientsService } from '../clients/clients.service';

// The PDF-vs-text fork in processInboundMessages. Pinned here:
// - a PDF attachment that parses as an agreement AUTO-onboards through the
//   reused ClientsService paths (promotion + contract upsert), raising NO
//   CONFIRM_AGREEMENT task;
// - a PDF that is NOT an agreement falls back to text classification, which
//   still needs the human confirm task;
// - a text-only message never touches the PDF parser.

function makePc(): PotentialClient {
  return {
    id: 'pc-1',
    displayName: 'devansh8801',
    emails: ['devansh8801@gmail.com'],
    state: PotentialClientState.QUEUED,
    evidence: null,
    firstSeenMeetingId: null,
    promotedClientId: null,
    lastPolledAt: null,
  } as unknown as PotentialClient;
}

function makeMsg(withPdf: boolean): InboundMessage {
  return {
    from: 'devansh8801@gmail.com',
    subject: 'Signed agreement attached',
    body: 'Hi, please find the agreement attached.',
    date: '2026-07-05T10:00:00.000Z',
    messageId: 'msg-1',
    ...(withPdf
      ? {
          attachments: [
            {
              filename: 'Technical Advisory Agreement.pdf',
              mimeType: 'application/pdf',
              data: Buffer.from('%PDF-1.4 fake'),
            },
          ],
        }
      : {}),
  };
}

interface Stubs {
  service: EmailService;
  llm: { parseAgreementPdf: jest.Mock; classifyAgreement: jest.Mock };
  clients: { confirmPotentialClient: jest.Mock; upsertContract: jest.Mock };
  taskSave: jest.Mock;
  pcSave: jest.Mock;
}

function build(): Stubs {
  // save() tracks the latest row so findOne() returns what was persisted
  // (the auto-onboard renames displayName BEFORE promoting, and re-reads the
  // row AFTER the promotion path flips it to PROMOTED).
  let persisted: Record<string, unknown> | null = null;
  const pcSave = jest.fn(async (x: PotentialClient) => {
    persisted = { ...x };
    return x;
  });
  const pcRepo = {
    save: pcSave,
    findOne: jest.fn(async () => ({
      ...(persisted ?? makePc()),
      state: PotentialClientState.PROMOTED,
      promotedClientId: 'client-1',
    })),
  };
  const taskSave = jest.fn(async (x: Record<string, unknown>) => ({ ...x, id: 'task-1' }));
  const taskRepo = {
    findOne: jest.fn(async () => null),
    create: jest.fn((x: unknown) => x),
    save: taskSave,
  };
  const llm = {
    parseAgreementPdf: jest.fn(),
    classifyAgreement: jest.fn(),
  };
  const clients = {
    confirmPotentialClient: jest.fn(async () => ({
      clientId: 'client-1',
      clientName: 'Northbeam-DKaria',
      xeroContactId: null,
      xeroContactCreated: false,
      xeroError: 'rate limit exceeded',
      attachContractTaskId: 'task-attach',
      potentialClient: {},
    })),
    upsertContract: jest.fn(async () => ({ id: 'contract-1' })),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new EmailService(
    pcRepo as never,
    taskRepo as never,
    null as never, // connRepo — unused by processInboundMessages
    null as never, // googleConnRepo — only poll() reads it
    llm as unknown as LlmService,
    audit as unknown as AuditService,
    clients as unknown as ClientsService,
  );
  return { service, llm, clients, taskSave, pcSave };
}

describe('processInboundMessages agreement-PDF auto-onboard', () => {
  it('auto-onboards on an agreement PDF: promotes, files the contract, raises no confirm task', async () => {
    const { service, llm, clients, taskSave } = build();
    llm.parseAgreementPdf.mockResolvedValue({
      isAgreement: true,
      contactName: 'Northbeam-DKaria',
      rawText: 'TECHNICAL ADVISORY AGREEMENT\nClause 1. ...',
      summary: 'Technical advisory agreement between Northbeam-DKaria and the freelancer.',
    });
    const pc = makePc();

    const res = await service.processInboundMessages(pc, [makeMsg(true)], ConnectionStatus.LIVE);

    expect(llm.parseAgreementPdf).toHaveBeenCalledTimes(1);
    expect(llm.classifyAgreement).not.toHaveBeenCalled(); // PDF path won
    expect(clients.confirmPotentialClient).toHaveBeenCalledWith('pc-1');
    expect(clients.upsertContract).toHaveBeenCalledWith('client-1', {
      title: 'Technical Advisory Agreement.pdf',
      rawText: 'TECHNICAL ADVISORY AGREEMENT\nClause 1. ...',
    });
    expect(taskSave).not.toHaveBeenCalled(); // zero human clicks
    expect(res.agreementsDetected).toBe(1);
    expect(res.tasksRaised).toBe(0);
    expect(res.detected[0].displayName).toBe('Northbeam-DKaria');
    // The reused promotion path names the client from the PC row.
    expect(pc.displayName).toBe('Northbeam-DKaria');
    // Refreshed after promotion so the caller's lastPolledAt save cannot
    // write the stale AGREEMENT_DETECTED state back over PROMOTED.
    expect(pc.state).toBe(PotentialClientState.PROMOTED);
  });

  it('falls back to text classification when the PDF is not an agreement', async () => {
    const { service, llm, clients, taskSave } = build();
    llm.parseAgreementPdf.mockResolvedValue({
      isAgreement: false,
      contactName: null,
      rawText: 'Some brochure text',
      summary: 'A marketing brochure.',
    });
    llm.classifyAgreement.mockResolvedValue({
      agreement: true,
      evidence_quote: 'please find the agreement attached',
      reasoning: 'sender commits to proceed',
    });
    const pc = makePc();

    const res = await service.processInboundMessages(pc, [makeMsg(true)], ConnectionStatus.LIVE);

    expect(llm.classifyAgreement).toHaveBeenCalledTimes(1);
    expect(clients.confirmPotentialClient).not.toHaveBeenCalled();
    expect(taskSave).toHaveBeenCalledTimes(1); // CONFIRM_AGREEMENT still human
    expect(res.agreementsDetected).toBe(1);
    expect(res.tasksRaised).toBe(1);
    expect(pc.state).toBe(PotentialClientState.AGREEMENT_DETECTED);
  });

  it('never calls the PDF parser for a text-only message', async () => {
    const { service, llm, clients } = build();
    llm.classifyAgreement.mockResolvedValue({
      agreement: false,
      evidence_quote: '',
      reasoning: 'just a question',
    });
    const pc = makePc();

    const res = await service.processInboundMessages(pc, [makeMsg(false)], ConnectionStatus.LIVE);

    expect(llm.parseAgreementPdf).not.toHaveBeenCalled();
    expect(clients.confirmPotentialClient).not.toHaveBeenCalled();
    expect(res.agreementsDetected).toBe(0);
    expect(pc.state).toBe(PotentialClientState.QUEUED);
  });

  it('falls back to the human confirm task when the promotion itself fails', async () => {
    const { service, llm, clients, taskSave } = build();
    llm.parseAgreementPdf.mockResolvedValue({
      isAgreement: true,
      contactName: 'Northbeam-DKaria',
      rawText: 'AGREEMENT ...',
      summary: 'An advisory agreement.',
    });
    clients.confirmPotentialClient.mockRejectedValue(new Error('db down'));
    const pc = makePc();

    const res = await service.processInboundMessages(pc, [makeMsg(true)], ConnectionStatus.LIVE);

    expect(taskSave).toHaveBeenCalledTimes(1); // CONFIRM_AGREEMENT raised instead
    expect(res.agreementsDetected).toBe(1);
    expect(res.tasksRaised).toBe(0); // raised via fallback, reported through detected[].taskId
    expect(res.detected[0].taskId).toBe('task-1');
  });
});
