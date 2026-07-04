import { Client } from './client.entity';
import { Contract } from './contract.entity';
import { PotentialClient } from './potential-client.entity';
import { Meeting } from './meeting.entity';
import { Transcript } from './transcript.entity';
import { InvoiceProposal } from './invoice-proposal.entity';
import { Detection } from './detection.entity';
import { Task } from './task.entity';
import { AuditEvent } from './audit-event.entity';
import { ConnectionState } from './connection-state.entity';

export * from './enums';
export * from './shapes';
export { Client } from './client.entity';
export { Contract } from './contract.entity';
export { PotentialClient } from './potential-client.entity';
export { Meeting, MeetingAttendee } from './meeting.entity';
export { Transcript } from './transcript.entity';
export { InvoiceProposal } from './invoice-proposal.entity';
export { Detection } from './detection.entity';
export { Task } from './task.entity';
export { AuditEvent } from './audit-event.entity';
export { ConnectionState } from './connection-state.entity';

// The full entity set — imported by TypeOrmModule.forRoot and test harnesses.
export const ALL_ENTITIES = [
  Client,
  Contract,
  PotentialClient,
  Meeting,
  Transcript,
  InvoiceProposal,
  Detection,
  Task,
  AuditEvent,
  ConnectionState,
];
