import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import {
  Document,
  DocumentStatus,
  ReconciliationStatus,
} from '../entities/document.entity';
import { Transaction, TransactionType } from '../entities/transaction.entity';
import { SupabaseStorageService } from './supabase-storage.service';
import { GeminiService, ExtractedTransaction } from './gemini.service';
import { PDFParse } from 'pdf-parse';
import { AiInsightsCacheService } from '../analytics/ai-insights-cache.service';
import { ParserFactory } from './parsers/parser.factory';
import { categorizeTransaction } from './categorization.util';
import { DocumentChunksService } from './document-chunks.service';
import { chunkText } from './chunking.util';

// Minimum characters to consider a PDF as having usable text
const MIN_TEXT_LENGTH = 50;

/**
 * Creates a fingerprint for deduplication. Two transactions with the same
 * account, date, amount, type, and normalized description are considered duplicates.
 */
function transactionFingerprint(
  accountId: number,
  tx: {
    transaction_date: string;
    amount: number;
    type: string;
    description?: string;
  },
): string {
  const desc = (tx.description ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const amount = Number(tx.amount).toFixed(2);
  return `${accountId}|${tx.transaction_date}|${amount}|${tx.type}|${desc}`;
}

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  constructor(
    @InjectRepository(Document)
    private readonly documentsRepository: Repository<Document>,
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
    private readonly storageService: SupabaseStorageService,
    private readonly geminiService: GeminiService,
    private readonly aiInsightsCache: AiInsightsCacheService,
    private readonly parserFactory: ParserFactory,
    private readonly documentChunksService: DocumentChunksService,
  ) {}

  /**
   * Process a document: download → extract text → LLM extraction → save transactions.
   * Called asynchronously after upload (fire-and-forget).
   */
  async process(document: Document, password?: string): Promise<void> {
    this.logger.log(
      `Starting extraction for document ${document.id} (${document.title})`,
    );

    try {
      // 1. Mark as PROCESSING
      await this.documentsRepository.update(document.id, {
        status: DocumentStatus.PROCESSING,
      });

      // 2. Download file from Supabase Storage
      const fileBuffer = await this.storageService.download(document.file_url);
      const mimeType = this.guessMimeType(document.file_url);

      // 3. Extract transactions using appropriate method
      let extracted: ExtractedTransaction[] = [];
      // Raw text, when available, doubles as input for the reconciliation
      // balance check and Phase 3's chunk/embedding indexing below —
      // scanned PDFs/images (vision path) have no text, so those stay
      // NOT_APPLICABLE for reconciliation and unindexed for RAG.
      let rawDocumentText: string | null = null;

      if (mimeType === 'application/pdf') {
        // Try text extraction first for text-based PDFs
        const parser = new PDFParse({ data: fileBuffer, password });
        let text = '';
        try {
          const pdfData = await parser.getText();
          text = pdfData.text?.trim() || '';
        } finally {
          await parser.destroy();
        }

        if (text.length >= MIN_TEXT_LENGTH) {
          rawDocumentText = text;
          this.logger.log(
            `PDF has ${text.length} chars of text, using deterministic parser factory`,
          );
          try {
            extracted = this.parserFactory.parseText(text);
          } catch (err) {
            this.logger.warn(
              `No deterministic parser matched document ${document.id}, falling back to Gemini text extraction: ${err}`,
            );
          }
          // A matched-but-empty parser (several banks are stubs today) is
          // indistinguishable from "no transactions on this statement" unless
          // we fall back — so treat zero results the same as no parser match.
          if (extracted.length === 0) {
            this.logger.log(
              `Deterministic parser produced no transactions for document ${document.id}, falling back to Gemini text extraction`,
            );
            extracted =
              await this.geminiService.extractTransactionsFromText(text);
          }
        } else {
          this.logger.log(
            'PDF has little/no text, using multimodal vision extraction',
          );
          extracted = await this.geminiService.extractTransactionsFromFile(
            fileBuffer,
            mimeType,
          );
        }
      } else if (mimeType === 'text/csv') {
        // CSV is plain text, not an image — must go through text extraction,
        // never the vision/inlineData path (which expects an actual image).
        const csvText = fileBuffer.toString('utf-8').trim();
        rawDocumentText = csvText;
        this.logger.log(
          `CSV file with ${csvText.length} chars, using text extraction`,
        );
        extracted =
          await this.geminiService.extractTransactionsFromText(csvText);
      } else {
        // Images (PNG, JPG) — always use vision
        extracted = await this.geminiService.extractTransactionsFromFile(
          fileBuffer,
          mimeType,
        );
      }

      this.logger.log(
        `Extracted ${extracted.length} transactions from document ${document.id}`,
      );

      // 3b. Reconciliation: find the statement's own opening/closing balance
      // (when present) and check it against this document's extracted sum.
      // This informs — but never replaces — mandatory per-transaction review.
      const balances = rawDocumentText
        ? await this.geminiService.extractDocumentBalances(rawDocumentText)
        : { opening_balance: null, closing_balance: null };
      const reconciliation = this.computeReconciliation(
        balances.opening_balance,
        balances.closing_balance,
        extracted,
      );
      const documentUpdate = {
        status: DocumentStatus.COMPLETED,
        raw_text: rawDocumentText,
        ...reconciliation,
      };

      // 4. Deduplicate: filter out transactions that already exist for this account
      let toSave = extracted;
      if (extracted.length > 0 && document.accountId) {
        const dates = extracted.map((t) => t.transaction_date);
        const minDate = dates.reduce((a, b) => (a < b ? a : b));
        const maxDate = dates.reduce((a, b) => (a > b ? a : b));

        const existing = await this.transactionsRepository.find({
          where: {
            accountId: document.accountId,
            transaction_date: Between(minDate, maxDate),
          },
          select: ['transaction_date', 'amount', 'type', 'description'],
        });

        const existingFingerprints = new Set(
          existing.map((t) =>
            transactionFingerprint(document.accountId as number, {
              transaction_date: t.transaction_date,
              amount: t.amount,
              type: t.type,
              description: t.description ?? undefined,
            }),
          ),
        );

        toSave = extracted.filter(
          (tx) =>
            !existingFingerprints.has(
              transactionFingerprint(document.accountId as number, tx),
            ),
        );

        const duplicateCount = extracted.length - toSave.length;
        if (duplicateCount > 0) {
          this.logger.log(
            `Filtered out ${duplicateCount} duplicate transaction(s) for account ${document.accountId}`,
          );
        }
      }

      // 5. Save only new transactions to DB
      if (toSave.length === 0 && extracted.length > 0) {
        this.logger.log(
          `All ${extracted.length} extracted transactions were duplicates; none saved for document ${document.id}`,
        );
      }
      if (toSave.length > 0 && document.accountId == null) {
        this.logger.log(
          `Skipping transaction save: document ${document.id} has no linked account`,
        );
      }
      if (toSave.length > 0 && document.accountId != null) {
        const accountId = document.accountId;
        const transactions = toSave.map((tx) =>
          this.transactionsRepository.create({
            transaction_date: tx.transaction_date,
            amount: tx.amount,
            type: tx.type as TransactionType,
            description: tx.description,
            // Applied uniformly regardless of source (deterministic parser
            // or Gemini) — one consistent scheme across every bank, and it
            // keeps working even when the Gemini API is unavailable, unlike
            // whatever category a parser or Gemini may have guessed.
            category: categorizeTransaction(tx.description, tx.type),
            userId: document.userId,
            accountId,
            documentId: document.id,
          }),
        );

        // Save the new transactions and mark the document COMPLETED atomically
        // — these must not be two independently-failable writes. Without this,
        // a crash/error between them could leave transactions saved against a
        // document stuck on PROCESSING, or (if the status update itself fails)
        // a document marked FAILED whose transactions were already persisted.
        await this.transactionsRepository.manager.transaction(
          async (manager) => {
            await manager.save(transactions);
            await manager.update(Document, document.id, documentUpdate);
          },
        );

        this.aiInsightsCache.invalidateForUser(document.userId);
        this.logger.log(
          `Saved ${transactions.length} transactions for document ${document.id}`,
        );
      } else {
        // Nothing to save — a single write, no atomicity concern.
        await this.documentsRepository.update(document.id, documentUpdate);
      }

      // 6. Index chunks for Phase 3 RAG (grounded chat/semantic search). Own
      // try/catch inside indexDocumentChunks — an embedding failure must
      // never flip an otherwise-successful document to FAILED.
      if (rawDocumentText) {
        await this.indexDocumentChunks(document.id, rawDocumentText);
      }

      this.logger.log(
        `Document ${document.id} extraction completed successfully`,
      );
    } catch (err) {
      this.logger.error(
        `Extraction failed for document ${document.id}: ${err}`,
      );

      // Mark as FAILED
      await this.documentsRepository.update(document.id, {
        status: DocumentStatus.FAILED,
        error_message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Absolute tolerance (₹5) — bank ledgers are exact, so this only absorbs paise-level rounding. */
  private static readonly RECONCILIATION_TOLERANCE = 5;

  /**
   * Compares this document's own extracted transactions against its stated
   * opening/closing balance. NOT_APPLICABLE (rather than a false MISMATCH)
   * whenever either balance is missing — the per-row-review fallback already
   * covers that case safely, so there's no need to guess.
   */
  private computeReconciliation(
    openingBalance: number | null,
    closingBalance: number | null,
    transactions: ExtractedTransaction[],
  ): {
    opening_balance: number | null;
    closing_balance: number | null;
    reconciliation_status: ReconciliationStatus;
    reconciled_delta: number | null;
  } {
    if (openingBalance == null || closingBalance == null) {
      return {
        opening_balance: openingBalance,
        closing_balance: closingBalance,
        reconciliation_status: ReconciliationStatus.NOT_APPLICABLE,
        reconciled_delta: null,
      };
    }

    const credits = transactions
      .filter((t) => t.type === 'CREDIT')
      .reduce((sum, t) => sum + t.amount, 0);
    const debits = transactions
      .filter((t) => t.type === 'DEBIT')
      .reduce((sum, t) => sum + t.amount, 0);
    const computedClosing = openingBalance + credits - debits;
    const delta = Math.round((computedClosing - closingBalance) * 100) / 100;

    return {
      opening_balance: openingBalance,
      closing_balance: closingBalance,
      reconciliation_status:
        Math.abs(delta) <= ExtractionService.RECONCILIATION_TOLERANCE
          ? ReconciliationStatus.MATCHED
          : ReconciliationStatus.MISMATCH,
      reconciled_delta: delta,
    };
  }

  /**
   * Chunks and embeds a document's raw text for Phase 3's grounded chat/
   * semantic search. Never throws — an indexing failure (chunking bug,
   * Gemini embedding error, DB write failure) must not undo an otherwise-
   * successful extraction; it just means this document won't show up in
   * RAG results until re-processed.
   */
  private async indexDocumentChunks(
    documentId: number,
    text: string,
  ): Promise<void> {
    try {
      const chunks = chunkText(text);
      if (chunks.length === 0) return;

      const embeddings = await this.geminiService.embedBatch(
        chunks.map((c) => c.content),
      );
      const toInsert = chunks
        .map((chunk, i) => ({
          content: chunk.content,
          embedding: embeddings[i],
        }))
        .filter((c) => c.embedding && c.embedding.length > 0);

      if (toInsert.length === 0) return;

      await this.documentChunksService.insertChunks(documentId, toInsert);
      this.logger.log(
        `Indexed ${toInsert.length} chunk(s) for document ${documentId}`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to index chunks for document ${documentId}: ${err}`,
      );
    }
  }

  private guessMimeType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'pdf':
        return 'application/pdf';
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'csv':
        return 'text/csv';
      default:
        return 'application/octet-stream';
    }
  }
}
