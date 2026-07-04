import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { MeetingState } from './enums';
import { MatchProposal } from './shapes';

export interface MeetingAttendee {
  email: string;
  name?: string;
  organizer?: boolean;
}

@Entity('meetings')
export class Meeting extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  gcalEventId!: string; // stable id from calendar (or synthesised for .ics)

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'timestamptz' })
  start!: Date;

  @Column({ type: 'timestamptz' })
  end!: Date;

  // Duration in hours (denormalised for the engine's maths).
  @Column({ type: 'numeric', precision: 6, scale: 2 })
  durationHours!: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  attendees!: MeetingAttendee[];

  @Index()
  @Column({ type: 'uuid', nullable: true })
  clientId!: string | null;

  @Index()
  @Column({ type: 'enum', enum: MeetingState, default: MeetingState.DETECTED })
  state!: MeetingState;

  @Column({ type: 'uuid', nullable: true })
  transcriptId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  skipReason!: string | null;

  // Fuzzy match proposals from the LLM (surfaced in CONFIRM_CLIENT_MATCH).
  @Column({ type: 'jsonb', nullable: true })
  matchProposals!: MatchProposal[] | null;

  // 'personal' meetings (no external attendees) are auto-skipped.
  @Column({ type: 'boolean', default: false })
  isPersonal!: boolean;

  @Column({ type: 'varchar', default: 'ics' })
  source!: string; // 'google' | 'ics'
}
