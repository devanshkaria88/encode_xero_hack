import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { TranscriptSource } from './enums';
import { TranscriptParsed } from './shapes';

@Entity('transcripts')
export class Transcript extends BaseEntity {
  @Index()
  @Column({ type: 'uuid', nullable: true })
  meetingId!: string | null;

  @Column({ type: 'text' })
  rawText!: string;

  @Column({ type: 'enum', enum: TranscriptSource, default: TranscriptSource.PASTED })
  source!: TranscriptSource;

  @Column({ type: 'jsonb', nullable: true })
  parsed!: TranscriptParsed | null;
}
