import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document, DocumentStatus } from '../entities/document.entity';
import { Transaction } from '../entities/transaction.entity';
import { SupabaseStorageService } from './supabase-storage.service';
import { GeminiService, ExtractedTransaction } from './gemini.service';
import { PDFParse } from 'pdf-parse';

// Minimum characters to consider a PDF as having usable text
const MIN_TEXT_LENGTH = 50;

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
  ) {}

  /**
   * Process a document: download → extract text → LLM extraction → save transactions.
   * Called asynchronously after upload (fire-and-forget).
   */
  async process(document: Document, password?: string): Promise<void> {
    this.logger.log(`Starting extraction for document ${document.id} (${document.title})`);

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

      if (mimeType === 'application/pdf') {
        // Try text extraction first
        const parser = new PDFParse({ data: fileBuffer, password });
        const pdfData = await parser.getText();
        const text = pdfData.text?.trim() || '';

        if (text.length >= MIN_TEXT_LENGTH) {
          this.logger.log(`PDF has ${text.length} chars of text, using text extraction`);
          extracted = await this.geminiService.extractTransactionsFromText(text);
        } else {
          this.logger.log('PDF has little/no text, using multimodal vision extraction');
          extracted = await this.geminiService.extractTransactionsFromFile(fileBuffer, mimeType);
        }
      } else {
        // Images (PNG, JPG) — always use vision
        extracted = await this.geminiService.extractTransactionsFromFile(fileBuffer, mimeType);
      }

      this.logger.log(`Extracted ${extracted.length} transactions from document ${document.id}`);

      // 4. Save transactions to DB
      if (extracted.length > 0) {
        const transactions = extracted.map((tx) =>
          this.transactionsRepository.create({
            transaction_date: tx.transaction_date,
            amount: tx.amount,
            type: tx.type as any,
            description: tx.description,
            category: tx.category,
            userId: document.userId,
            accountId: document.accountId,
            documentId: document.id,
          }),
        );

        await this.transactionsRepository.save(transactions);
        this.logger.log(`Saved ${transactions.length} transactions for document ${document.id}`);
      }

      // 5. Mark as COMPLETED
      await this.documentsRepository.update(document.id, {
        status: DocumentStatus.COMPLETED,
      });

      this.logger.log(`Document ${document.id} extraction completed successfully`);
    } catch (err) {
      this.logger.error(`Extraction failed for document ${document.id}: ${err}`);

      // Mark as FAILED
      await this.documentsRepository.update(document.id, {
        status: DocumentStatus.FAILED,
      });
    }
  }

  private guessMimeType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'pdf': return 'application/pdf';
      case 'png': return 'image/png';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'csv': return 'text/csv';
      default: return 'application/octet-stream';
    }
  }
}
