import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as pgvector from 'pgvector';
import { DocumentChunk } from '../entities/document-chunk.entity';

export interface ChunkToInsert {
  content: string;
  embedding: number[];
}

export interface ChunkSearchResult {
  id: number;
  documentId: number;
  documentTitle: string;
  content: string;
  distance: number;
}

/**
 * Raw `.query()` access to `document_chunks` — the repository/QueryBuilder
 * layer doesn't speak pgvector's `vector` type or its `<=>` cosine-distance
 * operator, so inserts and similarity search both go through parameterized
 * raw SQL instead (the `pgvector` npm package only formats the literal; it's
 * never asked to parse one back, so there's no need to register its custom
 * type parser against the driver).
 */
@Injectable()
export class DocumentChunksService {
  constructor(
    @InjectRepository(DocumentChunk)
    private readonly documentChunksRepository: Repository<DocumentChunk>,
  ) {}

  async insertChunks(
    documentId: number,
    chunks: ChunkToInsert[],
  ): Promise<void> {
    if (chunks.length === 0) return;

    const values: string[] = [];
    const params: unknown[] = [];
    chunks.forEach((chunk, i) => {
      const base = i * 3;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}::vector)`);
      params.push(documentId, chunk.content, pgvector.toSql(chunk.embedding));
    });

    await this.documentChunksRepository.manager.query(
      `INSERT INTO document_chunks (document_id, content, embedding) VALUES ${values.join(', ')}`,
      params,
    );
  }

  /**
   * Cosine-similarity search (pgvector's `<=>` operator — smaller distance is
   * more similar) scoped to this user's own documents via the join, never a
   * separate `userId` filter a caller could forget to apply.
   */
  async searchSimilar(
    userId: number,
    queryEmbedding: number[],
    limit = 5,
  ): Promise<ChunkSearchResult[]> {
    const embeddingLiteral = pgvector.toSql(queryEmbedding) as string;
    return this.documentChunksRepository.manager.query<ChunkSearchResult[]>(
      `SELECT dc.id AS "id",
              dc.document_id AS "documentId",
              d.title AS "documentTitle",
              dc.content AS "content",
              dc.embedding <=> $1::vector AS "distance"
       FROM document_chunks dc
       INNER JOIN documents d ON d.id = dc.document_id
       WHERE d.user_id = $2
       ORDER BY dc.embedding <=> $1::vector ASC
       LIMIT $3`,
      [embeddingLiteral, userId, limit],
    );
  }
}
