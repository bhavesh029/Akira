import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Document } from './document.entity';

@Entity('document_chunks')
export class DocumentChunk {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Document, document => document.chunks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  @Column({ name: 'document_id' })
  documentId: number;

  @Column({ type: 'text' })
  content: string;

  // We use 768 dimensions for Gemini embeddings
  @Column({ type: 'vector', length: 768 })
  embedding: string; // pgvector returns arrays or strings, we can treat it as a string or number[] depending on the driver

  @Column({ type: 'int', nullable: true })
  page_num: number;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}
