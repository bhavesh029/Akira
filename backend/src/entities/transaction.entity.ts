import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';
import { Account } from './account.entity';
import { Document } from './document.entity';
import { DecimalTransformer } from './transformers/decimal.transformer';

export enum TransactionType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, user => user.transactions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => Account, account => account.transactions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ name: 'account_id' })
  accountId: number;

  @ManyToOne(() => Document, document => document.transactions, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  @Column({ name: 'document_id', nullable: true })
  documentId: number | null;

  @Column({ type: 'date' })
  transaction_date: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, transformer: new DecimalTransformer() })
  amount: number;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({ type: 'varchar', nullable: true })
  category: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  // Extracted transactions always land unreviewed and are excluded from
  // every analytics/budget/net-worth calculation (AnalyticsService.baseFilteredQuery)
  // until the user explicitly confirms them via the review workflow.
  @Column({ type: 'boolean', default: false })
  reviewed: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}
