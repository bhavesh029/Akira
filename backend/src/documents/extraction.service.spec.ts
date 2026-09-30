import { ExtractionService } from './extraction.service';
import { DocumentStatus } from '../entities/document.entity';

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
    transactionsRepository = {
      find: jest.fn().mockResolvedValue([]), // no pre-existing transactions to dedup against
      create: jest.fn((tx) => tx),
      save: jest.fn().mockResolvedValue(undefined),
    };
    storageService = { download: jest.fn().mockResolvedValue(Buffer.from('fake-pdf-bytes')) };
    geminiService = {
      extractTransactionsFromText: jest.fn(),
      extractTransactionsFromFile: jest.fn(),
    };
    aiInsightsCache = { invalidateForUser: jest.fn() };
    parserFactory = { parseText: jest.fn() };

    service = new ExtractionService(
      documentsRepository,
      transactionsRepository,
      storageService,
      geminiService,
      aiInsightsCache,
      parserFactory,
    );
  });

  it('saves transactions from the deterministic parser and never calls Gemini when the parser succeeds', async () => {
    parserFactory.parseText.mockReturnValue([sampleTx]);

    await service.process(baseDocument);

    expect(parserFactory.parseText).toHaveBeenCalledWith(longEnoughText);
    expect(geminiService.extractTransactionsFromText).not.toHaveBeenCalled();
    expect(geminiService.extractTransactionsFromFile).not.toHaveBeenCalled();
    expect(transactionsRepository.save).toHaveBeenCalledTimes(1);
    expect(transactionsRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({ amount: 500, description: 'Coffee Shop', accountId: 100, userId: 10 }),
    ]);
    expect(aiInsightsCache.invalidateForUser).toHaveBeenCalledWith(10);
    expect(documentsRepository.update).toHaveBeenLastCalledWith(1, { status: DocumentStatus.COMPLETED });
  });

  it('[Phase 0 fix] falls back to Gemini text extraction when the matched parser returns zero transactions', async () => {
    // Simulates one of the 5 stub bank parsers matching a bank name but
    // returning [] — this must not silently complete with zero transactions.
    parserFactory.parseText.mockReturnValue([]);
    geminiService.extractTransactionsFromText.mockResolvedValue([sampleTx]);

    await service.process(baseDocument);

    expect(parserFactory.parseText).toHaveBeenCalled();
    expect(geminiService.extractTransactionsFromText).toHaveBeenCalledWith(longEnoughText);
    expect(geminiService.extractTransactionsFromFile).not.toHaveBeenCalled();
    expect(transactionsRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({ description: 'Coffee Shop' }),
    ]);
    expect(documentsRepository.update).toHaveBeenLastCalledWith(1, { status: DocumentStatus.COMPLETED });
  });

  it('[Phase 0 fix] falls back to Gemini text extraction when the parser throws for an unsupported bank', async () => {
    parserFactory.parseText.mockImplementation(() => {
      throw new Error('Unsupported Bank Format');
    });
    geminiService.extractTransactionsFromText.mockResolvedValue([sampleTx]);

    await service.process(baseDocument);

    expect(geminiService.extractTransactionsFromText).toHaveBeenCalledWith(longEnoughText);
    expect(transactionsRepository.save).toHaveBeenCalledTimes(1);
    // An unsupported bank must no longer fail the whole document outright.
    expect(documentsRepository.update).toHaveBeenLastCalledWith(1, { status: DocumentStatus.COMPLETED });
  });

  it('uses vision extraction directly (never the deterministic parser) when the PDF has little/no text', async () => {
    mockGetText.mockResolvedValue({ text: 'short' }); // below MIN_TEXT_LENGTH
    geminiService.extractTransactionsFromFile.mockResolvedValue([sampleTx]);

    await service.process(baseDocument);

    expect(parserFactory.parseText).not.toHaveBeenCalled();
    expect(geminiService.extractTransactionsFromText).not.toHaveBeenCalled();
    expect(geminiService.extractTransactionsFromFile).toHaveBeenCalled();
    expect(transactionsRepository.save).toHaveBeenCalledTimes(1);
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

    expect(transactionsRepository.save).not.toHaveBeenCalled();
    expect(documentsRepository.update).toHaveBeenLastCalledWith(1, { status: DocumentStatus.COMPLETED });
  });

  it('marks the document FAILED if an unexpected error occurs during extraction', async () => {
    parserFactory.parseText.mockReturnValue([sampleTx]);
    transactionsRepository.save.mockRejectedValue(new Error('DB is down'));

    await service.process(baseDocument);

    expect(documentsRepository.update).toHaveBeenLastCalledWith(1, { status: DocumentStatus.FAILED });
  });
});
