import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ContractParsed } from './shapes';

@Entity('contracts')
export class Contract extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  clientId!: string;

  @Column({ type: 'varchar' })
  fileRef!: string; // path / filename of the source contract document

  @Column({ type: 'varchar', nullable: true })
  title!: string | null;

  // Raw contract text (so the clause viewer can highlight in place).
  @Column({ type: 'text', nullable: true })
  rawText!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  parsed!: ContractParsed | null;
}
