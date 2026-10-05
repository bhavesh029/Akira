import { ExtractionService } from './extraction.service';
import {
  Document,
  DocumentStatus,
  ReconciliationStatus,
} from '../entities/document.entity';

// Mock the pdf-parse PDFParse class so tests control extracted text without a
// real PDF file. Mock variable names must be prefixed with "mock" — Jest's
// module-factory hoisting only allows referencing out-of-scope variables that
// follow this convention.
const mockGetText = jest.fn();
const mockDestroy = jest.fn();
jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: mockGetText,
    destroy: mockDestroy,
  })),
}));

describe('ExtractionService', () => {
  let service: ExtractionService;
  let documentsRepository: any;
  let transactionsRepository: any;
  let storageService: any;
  let geminiService: any;
  let aiInsightsCache: any;
  let parserFactory: any;
  let documentChunksService: any;
  let mockManagerSave: jest.Mock;
  let mockManagerUpdate: jest.Mock;

  const baseDocument = {
    id: 1,
    userId: 10,
    accountId: 100,
    title: 'Statement.pdf',
    file_url: 'user/statement.pdf',
  } as any;

  // >= MIN_TEXT_LENGTH (50) so the deterministic-parser path is taken.
  const longEnoughText = 'X'.repeat(200);

  const sampleTx = {
    transaction_date: '2026-03-01',
    amount: 500,
    type: 'DEBIT',
    description: 'Coffee Shop',
    category: 'Food',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetText.mockResolvedValue({ text: longEnoughText });
    mockDestroy.mockResolvedValue(undefined);

    documentsRepository = { update: jest.fn().mockResolvedValue(undefined) };

    mockManagerSave = jest.fn().mockResolvedValue(undefined);
    mockManagerUpdate = jest.fn().mockResolvedValue(undefined);
    transactionsRepository = {
      find: jest.fn().mockResolvedValue([]), // no pre-existing transactions to dedup against
      create: jest.fn((tx) => tx),
      manager: {
        // Mirrors TypeORM's EntityManager.transaction(cb): runs the callback
        // with a manager exposing save/update, and propagates its rejection.
        transaction: jest.fn(async (cb: (manager: any) => Promise<void>) =>
          cb({ save: mockManagerSave, update: mockManagerUpdate }),
        ),
      },
    };
    storageService = {
      download: jest.fn().mockResolvedValue(Buffer.from('fake-pdf-bytes')),
    };
    geminiService = {
      extractTransactionsFromText: jest.fn(),
      extractTransactionsFromFile: jest.fn(),
      extractDocumentBalances: jest
        .fn()
        .mockResolvedValue({ opening_balance: null, closing_balance: null }),
      embedBatch: jest.fn().mockResolvedValue([]),
    };
    aiInsightsCache = { invalidateForUser: jest.fn() };
    parserFactory = { parseText: jest.fn() };
    documentChunksService = {
      insertChunks: jest.fn().mockResolvedValue(undefined),
    };

    service = new ExtractionService(
      documentsRepository,
      transactionsRepository,
      storageService,
      geminiService,
      aiInsightsCache,
      parserFactory,
      documentChunksService,
    );
  });

  it('saves transactions from the deterministic parser and never calls Gemini when the parser succeeds', async () => {
    parserFactory.parseText.mockReturnValue([sampleTx]);

    await service.process(baseDocument);

    expect(parserFactory.parseText).toHaveBeenCalledWith(longEnoughText);
    expect(geminiService.extractTransactionsFromText).not.toHaveBeenCalled();
    expect(geminiService.extractTransactionsFromFile).not.toHaveBeenCalled();
    expect(mockManagerSave).toHaveBeenCalledTimes(1);
    expect(mockManagerSave).toHaveBeenCalledWith([
      expect.objectContaining({
        amount: 500,
        description: 'Coffee Shop',
        accountId: 100,
        userId: 10,
      }),
    ]);
    expect(aiInsightsCache.invalidateForUser).toHaveBeenCalledWith(10);
    expect(mockManagerUpdate).toHaveBeenCalledWith(Document, 1, {
      status: DocumentStatus.COMPLETED,
      raw_text: longEnoughText,
      opening_balance: null,
      closing_balance: null,
      reconciliation_status: ReconciliationStatus.NOT_APPLICABLE,
      reconciled_delta: null,
    });
  });

  it('[Phase 0 fix] falls back to Gemini text extraction when the matched parser returns zero transactions', async () => {
    // Simulates one of the 5 stub bank parsers matching a bank name but
    // returning [] — this must not silently complete with zero transactions.
    parserFactory.parseText.mockReturnValue([]);
    geminiService.extractTransactionsFromText.mockResolvedValue([sampleTx]);

    await service.process(baseDocument);

    expect(parserFactory.parseText).toHaveBeenCalled();
    expect(geminiService.extractTransactionsFromText).toHaveBeenCalledWith(
      longEnoughText,
    );
    expect(geminiService.extractTransactionsFromFile).not.toHaveBeenCalled();
    expect(mockManagerSave).toHaveBeenCalledWith([
      expect.objectContaining({ description: 'Coffee Shop' }),
    ]);
    expect(mockManagerUpdate).toHaveBeenCalledWith(Document, 1, {
      status: DocumentStatus.COMPLETED,
      raw_text: longEnoughText,
      opening_balance: null,
      closing_balance: null,
      reconciliation_status: ReconciliationStatus.NOT_APPLICABLE,
      reconciled_delta: null,
    });
  });

  it('[Phase 0 fix] falls back to Gemini text extraction when the parser throws for an unsupported bank', async () => {
    parserFactory.parseText.mockImplementation(() => {
      throw new Error('Unsupported Bank Format');
    });
    geminiService.extractTransactionsFromText.mockResolvedValue([sampleTx]);

    await service.process(baseDocument);

    expect(geminiService.extractTransactionsFromText).toHaveBeenCalledWith(
      longEnoughText,
    );
    expect(mockManagerSave).toHaveBeenCalledTimes(1);
    // An unsupported bank must no longer fail the whole document outright.
    expect(mockManagerUpdate).toHaveBeenCalledWith(Document, 1, {
      status: DocumentStatus.COMPLETED,
      raw_text: longEnoughText,
      opening_balance: null,
      closing_balance: null,
      reconciliation_status: ReconciliationStatus.NOT_APPLICABLE,
      reconciled_delta: null,
    });
  });

  it('uses vision extraction directly (never the deterministic parser) when the PDF has little/no text', async () => {
    mockGetText.mockResolvedValue({ text: 'short' }); // below MIN_TEXT_LENGTH
    geminiService.extractTransactionsFromFile.mockResolvedValue([sampleTx]);

    await service.process(baseDocument);

    expect(parserFactory.parseText).not.toHaveBeenCalled();
    expect(geminiService.extractTransactionsFromText).not.toHaveBeenCalled();
    expect(geminiService.extractTransactionsFromFile).toHaveBeenCalled();
    expect(mockManagerSave).toHaveBeenCalledTimes(1);
  });

  it('[Bug #3 fix] routes a CSV upload through text extraction, never the vision/inlineData path', async () => {
    const csvDocument = {
      ...baseDocument,
      file_url: 'user/statement.csv',
      title: 'Statement.csv',
    };
    const csvContent =
      'date,amount,type,description\n2026-03-01,500,DEBIT,Coffee Shop\n';
    storageService.download.mockResolvedValue(Buffer.from(csvContent, 'utf-8'));
    geminiService.extractTransactionsFromText.mockResolvedValue([sampleTx]);

    await service.process(csvDocument);

    // A CSV is plain text — it must never be sent down the vision/image path.
    expect(geminiService.extractTransactionsFromFile).not.toHaveBeenCalled();
    expect(parserFactory.parseText).not.toHaveBeenCalled();
    expect(geminiService.extractTransactionsFromText).toHaveBeenCalledWith(
      csvContent.trim(),
    );
    expect(mockManagerSave).toHaveBeenCalledWith([
      expect.objectContaining({ description: 'Coffee Shop' }),
    ]);
  });

  it('does not re-save a transaction that already exists for that account/date/amount/type/description', async () => {
    parserFactory.parseText.mockReturnValue([sampleTx]);
    transactionsRepository.find.mockResolvedValue([
      {
        transaction_date: '2026-03-01',
        amount: 500,
        type: 'DEBIT',
        description: 'Coffee Shop',
      },
    ]);

    await service.process(baseDocument);

    // Nothing to save -> the transaction wrapper is skipped entirely, and the
    // document is marked COMPLETED via a plain (single-write) update instead.
    expect(mockManagerSave).not.toHaveBeenCalled();
    expect(documentsRepository.update).toHaveBeenLastCalledWith(1, {
      status: DocumentStatus.COMPLETED,
      raw_text: longEnoughText,
      opening_balance: null,
      closing_balance: null,
      reconciliation_status: ReconciliationStatus.NOT_APPLICABLE,
      reconciled_delta: null,
    });
  });

  it('marks the document FAILED if an unexpected error occurs during extraction', async () => {
    parserFactory.parseText.mockReturnValue([sampleTx]);
    mockManagerSave.mockRejectedValue(new Error('DB is down'));

    await service.process(baseDocument);

    expect(documentsRepository.update).toHaveBeenLastCalledWith(1, {
      status: DocumentStatus.FAILED,
      error_message: 'DB is down',
    });
  });

  it('[Bug #2 fix] saves transactions and marks the document COMPLETED atomically in one DB transaction', async () => {
    parserFactory.parseText.mockReturnValue([sampleTx]);

    await service.process(baseDocument);

    // Both writes happen inside a single transaction() call, not as two
    // independently-failable awaits.
    expect(transactionsRepository.manager.transaction).toHaveBeenCalledTimes(1);
    expect(mockManagerSave).toHaveBeenCalled();
    expect(mockManagerUpdate).toHaveBeenCalledWith(Document, 1, {
      status: DocumentStatus.COMPLETED,
      raw_text: longEnoughText,
      opening_balance: null,
      closing_balance: null,
      reconciliation_status: ReconciliationStatus.NOT_APPLICABLE,
      reconciled_delta: null,
    });
  });

  it('[Bug #2 fix] marks the document FAILED, not partially COMPLETED, if the atomic save+status-update transaction fails', async () => {
    parserFactory.parseText.mockReturnValue([sampleTx]);
    // Simulate the transaction itself failing (e.g. the status update inside
    // it throws) — the whole unit must roll back and the document must land
    // on FAILED, never on a half-applied COMPLETED state.
    transactionsRepository.manager.transaction.mockRejectedValue(
      new Error('transaction aborted'),
    );

    await service.process(baseDocument);

    expect(documentsRepository.update).toHaveBeenLastCalledWith(1, {
      status: DocumentStatus.FAILED,
      error_message: 'transaction aborted',
    });
    expect(documentsRepository.update).not.toHaveBeenCalledWith(1, {
      status: DocumentStatus.COMPLETED,
    });
  });

  describe('[Phase 1] reconciliation', () => {
    it('marks MATCHED when the extracted sum reconciles against the stated closing balance within tolerance', async () => {
      parserFactory.parseText.mockReturnValue([sampleTx]); // DEBIT 500
      geminiService.extractDocumentBalances.mockResolvedValue({
        opening_balance: 1000,
        closing_balance: 500, // 1000 - 500 (debit) = 500, exact match
      });

      await service.process(baseDocument);

      expect(mockManagerUpdate).toHaveBeenCalledWith(Document, 1, {
        status: DocumentStatus.COMPLETED,
        raw_text: longEnoughText,
        opening_balance: 1000,
        closing_balance: 500,
        reconciliation_status: ReconciliationStatus.MATCHED,
        reconciled_delta: 0,
      });
    });

    it('stays MATCHED when the delta is within the ₹5 tolerance', async () => {
      parserFactory.parseText.mockReturnValue([sampleTx]); // DEBIT 500
      geminiService.extractDocumentBalances.mockResolvedValue({
        opening_balance: 1000,
        closing_balance: 504, // computed 500 vs stated 504 => delta -4
      });

      await service.process(baseDocument);

      expect(mockManagerUpdate).toHaveBeenCalledWith(Document, 1, {
        status: DocumentStatus.COMPLETED,
        raw_text: longEnoughText,
        opening_balance: 1000,
        closing_balance: 504,
        reconciliation_status: ReconciliationStatus.MATCHED,
        reconciled_delta: -4,
      });
    });

    it('marks MISMATCH when the delta exceeds the ₹5 tolerance', async () => {
      parserFactory.parseText.mockReturnValue([sampleTx]); // DEBIT 500
      geminiService.extractDocumentBalances.mockResolvedValue({
        opening_balance: 1000,
        closing_balance: 100, // computed 500 vs stated 100 => delta 400
      });

      await service.process(baseDocument);

      expect(mockManagerUpdate).toHaveBeenCalledWith(Document, 1, {
        status: DocumentStatus.COMPLETED,
        raw_text: longEnoughText,
        opening_balance: 1000,
        closing_balance: 100,
        reconciliation_status: ReconciliationStatus.MISMATCH,
        reconciled_delta: 400,
      });
    });

    it('marks NOT_APPLICABLE when no balance is found on the statement, never a false MISMATCH', async () => {
      parserFactory.parseText.mockReturnValue([sampleTx]);
      geminiService.extractDocumentBalances.mockResolvedValue({
        opening_balance: null,
        closing_balance: null,
      });

      await service.process(baseDocument);

      expect(mockManagerUpdate).toHaveBeenCalledWith(Document, 1, {
        status: DocumentStatus.COMPLETED,
        raw_text: longEnoughText,
        opening_balance: null,
        closing_balance: null,
        reconciliation_status: ReconciliationStatus.NOT_APPLICABLE,
        reconciled_delta: null,
      });
    });

    it('never calls extractDocumentBalances on the vision (image) path, which has no raw text', async () => {
      mockGetText.mockResolvedValue({ text: 'short' }); // below MIN_TEXT_LENGTH
      geminiService.extractTransactionsFromFile.mockResolvedValue([sampleTx]);

      await service.process(baseDocument);

      expect(geminiService.extractDocumentBalances).not.toHaveBeenCalled();
      expect(mockManagerUpdate).toHaveBeenCalledWith(Document, 1, {
        status: DocumentStatus.COMPLETED,
        raw_text: null,
        opening_balance: null,
        closing_balance: null,
        reconciliation_status: ReconciliationStatus.NOT_APPLICABLE,
        reconciled_delta: null,
      });
    });
  });

  describe('[Phase 3] chunk indexing', () => {
    it('chunks the raw text, embeds every chunk, and inserts them for the document', async () => {
      parserFactory.parseText.mockReturnValue([sampleTx]);
      geminiService.embedBatch.mockResolvedValue([[0.1, 0.2]]);

      await service.process(baseDocument);

      expect(geminiService.embedBatch).toHaveBeenCalledWith([longEnoughText]);
      expect(documentChunksService.insertChunks).toHaveBeenCalledWith(1, [
        { content: longEnoughText, embedding: [0.1, 0.2] },
      ]);
    });

    it('never indexes on the vision (image) path, which has no raw text', async () => {
      mockGetText.mockResolvedValue({ text: 'short' }); // below MIN_TEXT_LENGTH
      geminiService.extractTransactionsFromFile.mockResolvedValue([sampleTx]);

      await service.process(baseDocument);

      expect(geminiService.embedBatch).not.toHaveBeenCalled();
      expect(documentChunksService.insertChunks).not.toHaveBeenCalled();
    });

    it('drops a chunk whose embedding failed (e.g. a batch returning fewer results than requested) instead of inserting it with an undefined embedding', async () => {
      parserFactory.parseText.mockReturnValue([sampleTx]);
      geminiService.embedBatch.mockResolvedValue([]); // fewer than 1 requested chunk

      await service.process(baseDocument);

      expect(documentChunksService.insertChunks).not.toHaveBeenCalled();
    });

    it('does not fail the document when embedding throws — extraction still completes', async () => {
      parserFactory.parseText.mockReturnValue([sampleTx]);
      geminiService.embedBatch.mockRejectedValue(
        new Error('embedding API down'),
      );

      await service.process(baseDocument);

      expect(documentChunksService.insertChunks).not.toHaveBeenCalled();
      expect(mockManagerUpdate).toHaveBeenCalledWith(
        Document,
        1,
        expect.objectContaining({ status: DocumentStatus.COMPLETED }),
      );
    });

    it('does not fail the document when insertChunks throws', async () => {
      parserFactory.parseText.mockReturnValue([sampleTx]);
      geminiService.embedBatch.mockResolvedValue([[0.1, 0.2]]);
      documentChunksService.insertChunks.mockRejectedValue(
        new Error('DB write failed'),
      );

      await service.process(baseDocument);

      expect(mockManagerUpdate).toHaveBeenCalledWith(
        Document,
        1,
        expect.objectContaining({ status: DocumentStatus.COMPLETED }),
      );
    });
  });
});
