import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { User } from './user.entity';
import { Account } from './account.entity';
import { Transaction } from './transaction.entity';
import { DocumentChunk } from './document-chunk.entity';
import { DecimalTransformer } from './transformers/decimal.transformer';

export enum DocumentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum ReconciliationStatus {
  NOT_APPLICABLE = 'NOT_APPLICABLE',
  MATCHED = 'MATCHED',
  MISMATCH = 'MISMATCH',
}

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, user => user.documents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => Account, account => account.documents, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ name: 'account_id', nullable: true })
  accountId: number | null;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'enum', enum: DocumentStatus, default: DocumentStatus.PENDING })
  status: DocumentStatus;

  @Column({ type: 'varchar', nullable: true })
  file_url: string;

  // Reason a FAILED document failed — surfaced to the user instead of a bare status.
  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  // Persisted extracted text (text-based PDFs/CSVs only — null for scanned/image
  // documents, which never produce extractable text). Source for Phase 3's
  // chunking/embedding and for citation snippets in grounded chat answers.
  @Column({ type: 'text', nullable: true })
  raw_text: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true, transformer: new DecimalTransformer() })
  opening_balance: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true, transformer: new DecimalTransformer() })
  closing_balance: number | null;

  // opening_balance + sum(CREDIT) - sum(DEBIT) - closing_balance, within the
  // tolerance applied in extraction.service.ts — kept for display, not re-derived.
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true, transformer: new DecimalTransformer() })
  reconciled_delta: number | null;

  @Column({ type: 'enum', enum: ReconciliationStatus, default: ReconciliationStatus.NOT_APPLICABLE })
  reconciliation_status: ReconciliationStatus;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @OneToMany(() => Transaction, transaction => transaction.document)
  transactions: Transaction[];

  @OneToMany(() => DocumentChunk, chunk => chunk.document)
  chunks: DocumentChunk[];
}
