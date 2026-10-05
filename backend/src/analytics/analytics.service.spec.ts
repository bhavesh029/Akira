// `sumInvestmentLikeDebits` builds its query with real TypeORM `Brackets`
// objects, whose callback bodies only ever run when TypeORM actually
// generates SQL from them — which never happens against the fake query
// builder used below. Mock `Brackets` to invoke its callback immediately
// (with a fake chainable builder) so that branch's logic is actually
// exercised rather than silently skipped.
jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  return {
    ...actual,
    Brackets: jest.fn().mockImplementation((cb: (b: any) => void) => {
      const fakeBuilder: any = {};
      fakeBuilder.where = jest.fn().mockReturnValue(fakeBuilder);
      fakeBuilder.orWhere = jest.fn().mockReturnValue(fakeBuilder);
      cb(fakeBuilder);
      return fakeBuilder;
    }),
  };
});

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { Transaction } from '../entities/transaction.entity';
import { Account } from '../entities/account.entity';
import { GeminiService } from '../documents/gemini.service';
import { AiInsightsCacheService } from './ai-insights-cache.service';
import { AccountsService } from '../accounts/accounts.service';
import { RagService } from './rag.service';
import type {
  FinanceChatFilters,
  FinanceChatParseResult,
} from './finance-chat.types';

/**
 * A minimal chainable fake for TypeORM's SelectQueryBuilder. Every chain
 * method returns the same object so `.clone()` behaves like the real thing
 * would for this test's purposes (each `.clone()` call is independent in
 * production, but since none of these tests depend on mutating one clone
 * without affecting another, sharing one fake keeps the test simple).
 */
function createFakeQueryBuilder() {
  const qb: any = {};
  [
    'where',
    'andWhere',
    'select',
    'addSelect',
    'groupBy',
    'orderBy',
    'limit',
    'clone',
  ].forEach((m) => {
    qb[m] = jest.fn().mockReturnValue(qb);
  });
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.getCount = jest.fn().mockResolvedValue(0);
  qb.getMany = jest.fn().mockResolvedValue([]);
  qb.getRawOne = jest.fn().mockResolvedValue(null);
  return qb;
}

function emptyFilters(
  overrides: Partial<FinanceChatFilters> = {},
): FinanceChatFilters {
  return {
    from: null,
    to: null,
    relative: null,
    accountId: null,
    bankName: null,
    category: null,
    amountMin: null,
    amountMax: null,
    description: null,
    type: null,
    sortBy: null,
    sortDir: null,
    ...overrides,
  };
}

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let transactionsRepository: { createQueryBuilder: jest.Mock };
  let geminiService: {
    generateInsights: jest.Mock;
    parseFinanceChatIntent: jest.Mock;
  };
  let aiInsightsCache: { get: jest.Mock; set: jest.Mock; makeKey: jest.Mock };
  let accountsService: { findAllByUser: jest.Mock };
  let ragService: { answer: jest.Mock };
  let fakeQb: ReturnType<typeof createFakeQueryBuilder>;

  beforeEach(async () => {
    fakeQb = createFakeQueryBuilder();
    transactionsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(fakeQb),
    };
    geminiService = {
      generateInsights: jest.fn(),
      parseFinanceChatIntent: jest.fn(),
    };
    aiInsightsCache = {
      get: jest.fn(),
      set: jest.fn(),
      makeKey: jest.fn().mockReturnValue('cache-key'),
    };
    accountsService = { findAllByUser: jest.fn().mockResolvedValue([]) };
    ragService = {
      answer: jest.fn().mockResolvedValue({ answer: 'rag answer' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: getRepositoryToken(Transaction),
          useValue: transactionsRepository,
        },
        { provide: getRepositoryToken(Account), useValue: {} },
        { provide: GeminiService, useValue: geminiService },
        { provide: AiInsightsCacheService, useValue: aiInsightsCache },
        { provide: AccountsService, useValue: accountsService },
        { provide: RagService, useValue: ragService },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------
  // getSummary
  // ---------------------------------------------------------------------
  describe('getSummary', () => {
    it('computes inflow/outflow/net from SQL aggregates, never from the LLM', async () => {
      fakeQb.getRawMany
        .mockResolvedValueOnce([
          { type: 'CREDIT', total: '1000.00' },
          { type: 'DEBIT', total: '400.00' },
        ]) // totals
        .mockResolvedValueOnce([{ name: 'Food', value: '400.00' }]) // topCategories
        .mockResolvedValueOnce([]); // cashflow
      fakeQb.getCount.mockResolvedValue(5);
      fakeQb.getMany.mockResolvedValue([]);

      const summary = await service.getSummary(1, undefined, 'all');

      expect(summary.metrics).toEqual({
        totalInflow: 1000,
        totalOutflow: 400,
        netBalance: 600,
        transactionCount: 5,
      });
      expect(summary.topCategories).toEqual([{ name: 'Food', value: 400 }]);
      expect(summary.cashflow).toEqual([]);
    });

    it('scopes every query to the given userId', async () => {
      await service.getSummary(42, undefined, 'all');
      expect(fakeQb.where).toHaveBeenCalledWith('tx.userId = :userId', {
        userId: 42,
      });
    });

    it('[Phase 1] gates every query on reviewed = true', async () => {
      await service.getSummary(1, undefined, 'all');
      expect(fakeQb.andWhere).toHaveBeenCalledWith('tx.reviewed = true');
    });

    it('applies an accountId filter when provided', async () => {
      await service.getSummary(1, 99, 'all');
      expect(fakeQb.andWhere).toHaveBeenCalledWith(
        'tx.accountId = :accountId',
        { accountId: 99 },
      );
    });

    it('applies a dateRange filter when provided (not "all")', async () => {
      await service.getSummary(1, undefined, '1m');
      expect(fakeQb.andWhere).toHaveBeenCalledWith(
        'tx.transaction_date >= :startDate',
        expect.objectContaining({ startDate: expect.any(String) }),
      );
    });

    it('defaults "Other" for a null category', async () => {
      fakeQb.getRawMany
        .mockResolvedValueOnce([]) // totals
        .mockResolvedValueOnce([{ name: null, value: '50.00' }]) // topCategories
        .mockResolvedValueOnce([]); // cashflow

      const summary = await service.getSummary(1, undefined, 'all');
      expect(summary.topCategories).toEqual([{ name: 'Other', value: 50 }]);
    });

    it('returns the raw anomalies rows (largest DEBIT transactions) from getMany', async () => {
      const anomalyRows = [{ id: 1, amount: 50000, type: 'DEBIT' }];
      fakeQb.getMany.mockResolvedValue(anomalyRows);
      const summary = await service.getSummary(1, undefined, 'all');
      expect(summary.anomalies).toBe(anomalyRows);
    });

    it('formats and chronologically reverses non-empty cashflow rows', async () => {
      fakeQb.getRawMany
        .mockResolvedValueOnce([]) // totals
        .mockResolvedValueOnce([]) // topCategories
        .mockResolvedValueOnce([
          { month: '2026-02', income: '2000.00', expenses: '1000.00' },
          { month: '2026-01', income: '1500.00', expenses: '900.00' },
        ]); // cashflow, DB-ordered DESC

      const summary = await service.getSummary(1, undefined, 'all');
      expect(summary.cashflow).toEqual([
        { month: '2026-01', income: 1500, expenses: 900 },
        { month: '2026-02', income: 2000, expenses: 1000 },
      ]);
    });
  });

  // ---------------------------------------------------------------------
  // getAiInsights
  // ---------------------------------------------------------------------
  describe('getAiInsights', () => {
    it('returns the cached value without touching the database or Gemini when present', async () => {
      const cached = {
        summary: 'cached summary',
        subscriptions: [],
        anomalies: [],
      };
      aiInsightsCache.get.mockReturnValue(cached);

      const result = await service.getAiInsights(1, undefined, 'all');

      expect(result).toBe(cached);
      expect(transactionsRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(geminiService.generateInsights).not.toHaveBeenCalled();
    });

    it('returns a fallback message and caches it when there are no transactions', async () => {
      aiInsightsCache.get.mockReturnValue(undefined);
      fakeQb.getMany.mockResolvedValue([]);

      const result = await service.getAiInsights(1, undefined, 'all');

      expect(result).toEqual({
        summary: 'Not enough transactions to generate insights yet.',
        subscriptions: [],
        anomalies: [],
      });
      expect(aiInsightsCache.set).toHaveBeenCalledWith('cache-key', result);
      expect(geminiService.generateInsights).not.toHaveBeenCalled();
    });

    it('sends recent transactions to Gemini and returns the (verified) summary', async () => {
      aiInsightsCache.get.mockReturnValue(undefined);
      fakeQb.getMany.mockResolvedValue([
        {
          transaction_date: '2026-03-01',
          amount: 500,
          type: 'DEBIT',
          category: 'Food',
          description: 'Cafe',
        },
      ]);
      geminiService.generateInsights.mockResolvedValue({
        summary: 'You spend a lot on food',
        subscriptions: [],
        anomalies: [],
      });

      const result = await service.getAiInsights(1, 5, '3m');

      expect(geminiService.generateInsights).toHaveBeenCalledWith(
        expect.stringContaining('Cafe'),
      );
      expect(result.summary).toBe('You spend a lot on food');
      expect(aiInsightsCache.set).toHaveBeenCalledWith('cache-key', result);
    });

    it('falls back to an empty summary string if Gemini returns a non-string summary', async () => {
      aiInsightsCache.get.mockReturnValue(undefined);
      fakeQb.getMany.mockResolvedValue([
        {
          transaction_date: '2026-03-01',
          amount: 500,
          type: 'DEBIT',
          category: 'Food',
          description: 'Cafe',
        },
      ]);
      geminiService.generateInsights.mockResolvedValue({
        summary: null,
        subscriptions: [],
        anomalies: [],
      });

      const result = await service.getAiInsights(1, undefined, 'all');
      expect(result.summary).toBe('');
    });

    describe('[Bug #5 fix] verifying subscriptions against real transactions', () => {
      const netflixTx = {
        transaction_date: '2026-03-10',
        amount: 649,
        type: 'DEBIT',
        category: 'Entertainment',
        description: 'NETFLIX.COM',
      };

      it('replaces an LLM-stated amount with the real amount from the matching transaction', async () => {
        aiInsightsCache.get.mockReturnValue(undefined);
        fakeQb.getMany.mockResolvedValue([netflixTx]);
        geminiService.generateInsights.mockResolvedValue({
          summary: 'ok',
          // Gemini misreads/hallucinates 199 — the real charge was 649.
          subscriptions: [
            { name: 'Netflix', amount: 199, frequency: 'Monthly' },
          ],
          anomalies: [],
        });

        const result = await service.getAiInsights(1, undefined, 'all');
        expect(result.subscriptions).toEqual([
          { name: 'Netflix', amount: 649, frequency: 'Monthly' },
        ]);
      });

      it('drops a subscription that matches no real transaction (hallucinated vendor)', async () => {
        aiInsightsCache.get.mockReturnValue(undefined);
        fakeQb.getMany.mockResolvedValue([netflixTx]);
        geminiService.generateInsights.mockResolvedValue({
          summary: 'ok',
          subscriptions: [
            { name: 'Disney+', amount: 299, frequency: 'Monthly' },
          ],
          anomalies: [],
        });

        const result = await service.getAiInsights(1, undefined, 'all');
        expect(result.subscriptions).toEqual([]);
      });

      it('uses the most recent matching transaction when there are several', async () => {
        aiInsightsCache.get.mockReturnValue(undefined);
        fakeQb.getMany.mockResolvedValue([
          { ...netflixTx, transaction_date: '2026-01-10', amount: 599 },
          { ...netflixTx, transaction_date: '2026-03-10', amount: 649 },
          { ...netflixTx, transaction_date: '2026-02-10', amount: 599 },
        ]);
        geminiService.generateInsights.mockResolvedValue({
          summary: 'ok',
          subscriptions: [{ name: 'Netflix', amount: 1, frequency: 'Monthly' }],
          anomalies: [],
        });

        const result = await service.getAiInsights(1, undefined, 'all');
        expect(result.subscriptions[0].amount).toBe(649);
      });

      it('ignores CREDIT transactions when matching a subscription vendor', async () => {
        aiInsightsCache.get.mockReturnValue(undefined);
        fakeQb.getMany.mockResolvedValue([{ ...netflixTx, type: 'CREDIT' }]); // a refund, not a charge
        geminiService.generateInsights.mockResolvedValue({
          summary: 'ok',
          subscriptions: [
            { name: 'Netflix', amount: 649, frequency: 'Monthly' },
          ],
          anomalies: [],
        });

        const result = await service.getAiInsights(1, undefined, 'all');
        expect(result.subscriptions).toEqual([]);
      });

      it('gracefully returns [] when subscriptions is missing or malformed', async () => {
        aiInsightsCache.get.mockReturnValue(undefined);
        fakeQb.getMany.mockResolvedValue([netflixTx]);
        geminiService.generateInsights.mockResolvedValue({
          summary: 'ok',
          anomalies: [],
        }); // no subscriptions key

        const result = await service.getAiInsights(1, undefined, 'all');
        expect(result.subscriptions).toEqual([]);
      });

      it('skips a malformed subscription entry (missing name) without crashing', async () => {
        aiInsightsCache.get.mockReturnValue(undefined);
        fakeQb.getMany.mockResolvedValue([netflixTx]);
        geminiService.generateInsights.mockResolvedValue({
          summary: 'ok',
          subscriptions: [
            { amount: 649, frequency: 'Monthly' },
            'not even an object',
          ],
          anomalies: [],
        });

        const result = await service.getAiInsights(1, undefined, 'all');
        expect(result.subscriptions).toEqual([]);
      });
    });

    describe('[Bug #5 fix] verifying anomalies against real transactions', () => {
      const bigTx = {
        transaction_date: '2026-03-05',
        amount: 50000,
        type: 'DEBIT',
        category: 'Shopping',
        description: 'Apple Store',
      };

      it('keeps an anomaly sentence whose figure matches a real transaction amount', async () => {
        aiInsightsCache.get.mockReturnValue(undefined);
        fakeQb.getMany.mockResolvedValue([bigTx]);
        geminiService.generateInsights.mockResolvedValue({
          summary: 'ok',
          subscriptions: [],
          anomalies: [
            'Detected a large unusual payment of ₹50,000 for Apple Store.',
          ],
        });

        const result = await service.getAiInsights(1, undefined, 'all');
        expect(result.anomalies).toEqual([
          'Detected a large unusual payment of ₹50,000 for Apple Store.',
        ]);
      });

      it('drops an anomaly sentence whose figure matches no real transaction', async () => {
        aiInsightsCache.get.mockReturnValue(undefined);
        fakeQb.getMany.mockResolvedValue([bigTx]);
        geminiService.generateInsights.mockResolvedValue({
          summary: 'ok',
          subscriptions: [],
          anomalies: [
            'Detected a suspicious payment of ₹99,999 to an unknown merchant.',
          ],
        });

        const result = await service.getAiInsights(1, undefined, 'all');
        expect(result.anomalies).toEqual([]);
      });

      it('gracefully returns [] when anomalies is missing or malformed', async () => {
        aiInsightsCache.get.mockReturnValue(undefined);
        fakeQb.getMany.mockResolvedValue([bigTx]);
        geminiService.generateInsights.mockResolvedValue({
          summary: 'ok',
          subscriptions: [],
        }); // no anomalies key

        const result = await service.getAiInsights(1, undefined, 'all');
        expect(result.anomalies).toEqual([]);
      });

      it('ignores a non-string entry in the anomalies array', async () => {
        aiInsightsCache.get.mockReturnValue(undefined);
        fakeQb.getMany.mockResolvedValue([bigTx]);
        geminiService.generateInsights.mockResolvedValue({
          summary: 'ok',
          subscriptions: [],
          anomalies: [12345],
        });

        const result = await service.getAiInsights(1, undefined, 'all');
        expect(result.anomalies).toEqual([]);
      });
    });
  });

  // ---------------------------------------------------------------------
  // financeChat — top-level routing
  // ---------------------------------------------------------------------
  describe('financeChat', () => {
    function mockParse(
      overrides: Partial<FinanceChatParseResult> = {},
    ): FinanceChatParseResult {
      return {
        intent: 'sum_debits',
        filters: emptyFilters(),
        clarifyMessage: null,
        ...overrides,
      };
    }

    it('returns the LLM-provided clarify message when intent is "clarify"', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'clarify',
          clarifyMessage: 'Which account do you mean?',
        }),
      );
      const result = await service.financeChat(1, 'how much did I spend');
      expect(result.answer).toBe('Which account do you mean?');
      expect(transactionsRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('falls back to a generic clarify prompt when clarifyMessage is empty', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({ intent: 'clarify', clarifyMessage: '  ' }),
      );
      const result = await service.financeChat(1, 'huh');
      expect(result.answer).toContain('Could you specify');
    });

    it('[Phase 3] routes intent "unknown" to RagService.answer instead of the old canned message', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({ intent: 'unknown' }),
      );
      ragService.answer.mockResolvedValue({
        answer: 'Your late fee is 2%.',
        sources: [
          { documentId: 1, documentTitle: 'March', snippet: 'late fee 2%' },
        ],
      });

      const result = await service.financeChat(1, 'what is my late fee?');

      expect(ragService.answer).toHaveBeenCalledWith(1, 'what is my late fee?');
      expect(result).toEqual({
        answer: 'Your late fee is 2%.',
        sources: [
          { documentId: 1, documentTitle: 'March', snippet: 'late fee 2%' },
        ],
      });
      // The deterministic-SQL path must stay untouched by this fallback.
      expect(transactionsRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('returns a no-match message when an accountId filter matches no account, without querying transactions', async () => {
      accountsService.findAllByUser.mockResolvedValue([
        { id: 1, bank_name: 'HDFC' },
      ]);
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({ filters: emptyFilters({ accountId: 999 }) }),
      );
      const result = await service.financeChat(
        1,
        'how much did I spend on account 999',
      );
      expect(result.answer).toContain('No account matched');
      expect(transactionsRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('returns a no-match message when a bankName filter matches no account', async () => {
      accountsService.findAllByUser.mockResolvedValue([
        { id: 1, bank_name: 'HDFC' },
      ]);
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({ filters: emptyFilters({ bankName: 'ICICI' }) }),
      );
      const result = await service.financeChat(1, 'how much on ICICI');
      expect(result.answer).toContain('No account matched');
    });

    it('reports "add or import" when the period is empty and the user has no reviewed data at all', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(mockParse());
      fakeQb.getCount.mockResolvedValue(0); // period count, unreviewed-in-period, hasAny — all 0

      const result = await service.financeChat(1, 'how much did I spend');
      expect(result.answer).toContain('No transactions found between');
      expect(result.answer).toContain('Add or import transactions');
    });

    it('[empty-period diagnosis] points at the Review page when unreviewed transactions exist in this exact period', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(mockParse());
      fakeQb.getCount
        .mockResolvedValueOnce(0) // period count (reviewed=true) -> triggers the empty-period branch
        .mockResolvedValueOnce(3); // countUnreviewedInPeriod

      const result = await service.financeChat(1, 'how much did I spend');

      expect(result.answer).toContain('3 transactions');
      expect(result.answer).toContain('still waiting for review');
      expect(result.answer).toContain('Review page');
    });

    it('[empty-period diagnosis] singular phrasing for exactly one unreviewed transaction', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(mockParse());
      fakeQb.getCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

      const result = await service.financeChat(1, 'how much did I spend');

      expect(result.answer).toContain(
        '1 transaction in that period is still waiting',
      );
      expect(result.answer).not.toContain('1 transactions');
    });

    it('[empty-period diagnosis] suggests a different period when the user has reviewed data, just not in this window', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(mockParse());
      fakeQb.getCount
        .mockResolvedValueOnce(0) // period count
        .mockResolvedValueOnce(0) // countUnreviewedInPeriod
        .mockResolvedValueOnce(42); // hasAnyReviewedTransactions (count > 0)

      const result = await service.financeChat(1, 'how much did I spend');

      expect(result.answer).toContain('transaction history outside this range');
      expect(result.answer).not.toContain('Add or import transactions');
    });

    it('[Phase 1] gates financeChat queries on reviewed = true too (separate base query from getSummary)', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({ intent: 'sum_debits' }),
      );
      fakeQb.getCount.mockResolvedValue(3);
      fakeQb.getRawOne.mockResolvedValue({ sum: '100.00' });

      await service.financeChat(1, 'how much did I spend');
      expect(fakeQb.andWhere).toHaveBeenCalledWith('tx.reviewed = true');
    });

    it('sum_debits: reports total debit spending, with and without a category filter', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({ intent: 'sum_debits' }),
      );
      fakeQb.getCount.mockResolvedValue(3);
      fakeQb.getRawOne.mockResolvedValue({ sum: '12345.00' });

      const result = await service.financeChat(1, 'how much did I spend');
      expect(result.answer).toContain(
        'total debit spending on all your accounts was',
      );
      expect(result.answer).toContain('12,345');
    });

    it('sum_debits: mentions the category when one is given', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'sum_debits',
          filters: emptyFilters({ category: 'Food' }),
        }),
      );
      fakeQb.getCount.mockResolvedValue(3);
      fakeQb.getRawOne.mockResolvedValue({ sum: '500.00' });

      const result = await service.financeChat(1, 'how much on food');
      expect(result.answer).toContain('categories matching “Food”');
    });

    it('sum_credits: reports total credits, with and without a category filter', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({ intent: 'sum_credits' }),
      );
      fakeQb.getCount.mockResolvedValue(2);
      fakeQb.getRawOne.mockResolvedValue({ sum: '50000.00' });

      const result = await service.financeChat(1, 'how much did I earn');
      expect(result.answer).toContain(
        'total credits on all your accounts were',
      );
    });

    it('net_flow: reports credits, debits, and the net (positive)', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({ intent: 'net_flow' }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne
        .mockResolvedValueOnce({ sum: '10000.00' }) // credits
        .mockResolvedValueOnce({ sum: '4000.00' }); // debits

      const result = await service.financeChat(1, 'what is my net cashflow');
      expect(result.answer).toContain('net cashflow');
      expect(fakeQb.getRawOne).toHaveBeenCalledTimes(2);
    });

    it('top_category: reports the highest-spend category', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({ intent: 'top_category' }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue({
        name: 'Shopping',
        total: '7000.00',
      });

      const result = await service.financeChat(1, 'top category last month');
      expect(result.answer).toContain('“Shopping”');
    });

    it('top_category: reports "no debit categories" when nothing was found', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({ intent: 'top_category' }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue(null);

      const result = await service.financeChat(1, 'top category');
      expect(result.answer).toContain('No debit categories');
    });

    it('top_category: applies a category hint filter when the user names one', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'top_category',
          filters: emptyFilters({ category: 'Food' }),
        }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue({ name: null, total: '1200.00' });

      const result = await service.financeChat(1, 'top category matching food');
      expect(fakeQb.andWhere).toHaveBeenCalledWith('tx.category ILIKE :hint', {
        hint: '%Food%',
      });
      // A null category name from the DB still falls back to "Other".
      expect(result.answer).toContain('“Other”');
    });

    it('top_category: reports "no debit categories" when the top row total is zero', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({ intent: 'top_category' }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue({ name: 'Food', total: '0' });

      const result = await service.financeChat(1, 'top category');
      expect(result.answer).toContain('No debit categories');
    });

    it('compare_amount: asks for a number when neither bound was parsed', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'compare_amount',
          filters: emptyFilters({ amountMin: null, amountMax: null }),
        }),
      );
      fakeQb.getCount.mockResolvedValue(4);

      const result = await service.financeChat(1, 'did I spend a lot');
      expect(result.answer).toContain(
        'I could not tell which amount to compare',
      );
    });

    it('compare_amount: "at least" (amountMin only) passes when spend meets the threshold', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'compare_amount',
          filters: emptyFilters({ amountMin: 10000 }),
        }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue({ sum: '15000.00' });

      const result = await service.financeChat(1, 'did I spend at least 10000');
      expect(result.answer).toContain('at least');
      expect(result.answer).not.toContain('not at least');
    });

    it('compare_amount: "at least" (amountMin only) fails when spend is below the threshold', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'compare_amount',
          filters: emptyFilters({ amountMin: 10000 }),
        }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue({ sum: '5000.00' });

      const result = await service.financeChat(1, 'did I spend at least 10000');
      expect(result.answer).toContain('not at least');
    });

    it('compare_amount: "at most" (amountMax only) passes when spend is at or below the threshold', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'compare_amount',
          filters: emptyFilters({ amountMax: 10000 }),
        }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue({ sum: '5000.00' });

      const result = await service.financeChat(1, 'did I spend at most 10000');
      expect(result.answer).toContain('at most');
      expect(result.answer).not.toContain('not at most');
    });

    it('compare_amount: "exactly" (equal amountMin/amountMax) passes on an exact (float-tolerant) match', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'compare_amount',
          filters: emptyFilters({ amountMin: 10000, amountMax: 10000 }),
        }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue({ sum: '10000.00' });

      const result = await service.financeChat(1, 'did I spend exactly 10000');
      expect(result.answer).toContain('exactly');
      expect(result.answer).not.toContain('not exactly');
    });

    it('compare_amount: "exactly" fails when the amounts differ', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'compare_amount',
          filters: emptyFilters({ amountMin: 10000, amountMax: 10000 }),
        }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue({ sum: '9000.00' });

      const result = await service.financeChat(1, 'did I spend exactly 10000');
      expect(result.answer).toContain('not exactly');
    });

    it('compare_amount: "between" (distinct amountMin and amountMax) checks the sum falls in range', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'compare_amount',
          filters: emptyFilters({ amountMin: 5000, amountMax: 10000 }),
        }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue({ sum: '7500.00' });

      const result = await service.financeChat(
        1,
        'did I spend between 5000 and 10000',
      );
      expect(result.answer).toContain('between ₹5,000 and ₹10,000');
      expect(result.answer).not.toContain('not between');
    });

    it('investment_estimate: reports estimated investment-like debits', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({ intent: 'investment_estimate' }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue({ sum: '2000.00' });

      const result = await service.financeChat(1, 'how much did I invest');
      expect(result.answer).toContain('investment-style keywords');
    });

    describe('list_transactions', () => {
      it('lists individual debit transactions matching a threshold, with a header stating the total and threshold', async () => {
        geminiService.parseFinanceChatIntent.mockResolvedValue(
          mockParse({
            intent: 'list_transactions',
            filters: emptyFilters({ amountMin: 10000 }),
          }),
        );
        fakeQb.getCount
          .mockResolvedValueOnce(5) // countTransactions zero-check
          .mockResolvedValueOnce(2); // listMatchingTransactions's own total
        fakeQb.getMany.mockResolvedValue([
          {
            transaction_date: '2026-04-10',
            description: 'Laptop',
            amount: 55000,
            category: 'Shopping',
          },
          {
            transaction_date: '2026-04-05',
            description: 'Rent',
            amount: 15000,
            category: 'Rent',
          },
        ]);

        const result = await service.financeChat(
          1,
          'show me transactions over 10000',
        );

        expect(result.answer).toContain(
          '2 debit transactions of at least ₹10,000',
        );
        expect(result.answer).toContain('2026-04-10 — Laptop — ₹55,000');
        expect(result.answer).toContain('2026-04-05 — Rent — ₹15,000');
      });

      it('reports no matches with the threshold phrase when nothing matches', async () => {
        geminiService.parseFinanceChatIntent.mockResolvedValue(
          mockParse({
            intent: 'list_transactions',
            filters: emptyFilters({ amountMin: 50000 }),
          }),
        );
        fakeQb.getCount.mockResolvedValueOnce(5).mockResolvedValueOnce(0);
        fakeQb.getMany.mockResolvedValue([]);

        const result = await service.financeChat(1, 'transactions over 50000');

        expect(result.answer).toContain(
          'No debit transactions of at least ₹50,000 found',
        );
      });

      it('phrases "at most" for amountMax-only and "between" for a distinct amountMin+amountMax range', async () => {
        geminiService.parseFinanceChatIntent.mockResolvedValue(
          mockParse({
            intent: 'list_transactions',
            filters: emptyFilters({ amountMax: 500 }),
          }),
        );
        fakeQb.getCount.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
        fakeQb.getMany.mockResolvedValue([
          {
            transaction_date: '2026-04-01',
            description: 'Coffee',
            amount: 200,
            category: 'Food',
          },
        ]);

        const result = await service.financeChat(1, 'transactions under 500');
        expect(result.answer).toContain('at most ₹500');
      });

      it('filters between a distinct amountMin and amountMax via a BETWEEN clause', async () => {
        geminiService.parseFinanceChatIntent.mockResolvedValue(
          mockParse({
            intent: 'list_transactions',
            filters: emptyFilters({ amountMin: 500, amountMax: 2000 }),
          }),
        );
        fakeQb.getCount.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
        fakeQb.getMany.mockResolvedValue([
          {
            transaction_date: '2026-04-01',
            description: 'Groceries',
            amount: 1200,
            category: 'Food',
          },
        ]);

        const result = await service.financeChat(
          1,
          'transactions between 500 and 2000',
        );
        expect(fakeQb.andWhere).toHaveBeenCalledWith(
          'tx.amount BETWEEN :amountMin AND :amountMax',
          { amountMin: 500, amountMax: 2000 },
        );
        expect(result.answer).toContain('between ₹500 and ₹2,000');
      });

      it('notes truncation when more rows match than are shown', async () => {
        geminiService.parseFinanceChatIntent.mockResolvedValue(
          mockParse({
            intent: 'list_transactions',
            filters: emptyFilters({ amountMin: 100 }),
          }),
        );
        fakeQb.getCount.mockResolvedValueOnce(5).mockResolvedValueOnce(30);
        fakeQb.getMany.mockResolvedValue([
          {
            transaction_date: '2026-04-01',
            description: 'A',
            amount: 9000,
            category: 'Shopping',
          },
        ]);

        const result = await service.financeChat(1, 'transactions over 100');
        expect(result.answer).toContain('30 debit transactions');
        expect(result.answer).toContain('showing 1 of 30');
      });

      it('applies a category filter when the user names one', async () => {
        geminiService.parseFinanceChatIntent.mockResolvedValue(
          mockParse({
            intent: 'list_transactions',
            filters: emptyFilters({ category: 'Food' }),
          }),
        );
        fakeQb.getCount.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
        fakeQb.getMany.mockResolvedValue([
          {
            transaction_date: '2026-04-01',
            description: 'Cafe',
            amount: 300,
            category: 'Food',
          },
        ]);

        await service.financeChat(1, 'list my food transactions');
        expect(fakeQb.andWhere).toHaveBeenCalledWith('tx.category ILIKE :cat', {
          cat: '%Food%',
        });
      });

      it('searches by vendor/merchant keyword via filters.description', async () => {
        geminiService.parseFinanceChatIntent.mockResolvedValue(
          mockParse({
            intent: 'list_transactions',
            filters: emptyFilters({ description: 'Swiggy' }),
          }),
        );
        fakeQb.getCount.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
        fakeQb.getMany.mockResolvedValue([
          {
            transaction_date: '2026-04-01',
            description: 'SWIGGY ORDER #123',
            amount: 450,
            category: 'Food',
          },
        ]);

        const result = await service.financeChat(
          1,
          'find my Swiggy transactions',
        );
        expect(fakeQb.andWhere).toHaveBeenCalledWith(
          'tx.description ILIKE :desc',
          { desc: '%Swiggy%' },
        );
        expect(result.answer).toContain('matching “Swiggy”');
      });

      it('lists credits instead of debits when filters.type is CREDIT', async () => {
        geminiService.parseFinanceChatIntent.mockResolvedValue(
          mockParse({
            intent: 'list_transactions',
            filters: emptyFilters({ type: 'CREDIT', amountMin: 5000 }),
          }),
        );
        fakeQb.getCount.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
        fakeQb.getMany.mockResolvedValue([
          {
            transaction_date: '2026-04-01',
            description: 'Salary',
            amount: 80000,
            category: 'Salary',
          },
        ]);

        const result = await service.financeChat(1, 'credits above 5000');
        expect(fakeQb.andWhere).toHaveBeenCalledWith('tx.type = :type', {
          type: 'CREDIT',
        });
        expect(result.answer).toContain('credit transaction');
      });

      it('sorts by date ascending when filters.sortBy/sortDir request it', async () => {
        geminiService.parseFinanceChatIntent.mockResolvedValue(
          mockParse({
            intent: 'list_transactions',
            filters: emptyFilters({ sortBy: 'date', sortDir: 'asc' }),
          }),
        );
        fakeQb.getCount.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
        fakeQb.getMany.mockResolvedValue([
          {
            transaction_date: '2026-04-01',
            description: 'Oldest',
            amount: 100,
            category: 'Other',
          },
        ]);

        await service.financeChat(1, 'my oldest transactions');
        expect(fakeQb.orderBy).toHaveBeenCalledWith(
          'tx.transaction_date',
          'ASC',
        );
      });

      it('defaults to sorting by amount descending when no sort is requested', async () => {
        geminiService.parseFinanceChatIntent.mockResolvedValue(
          mockParse({ intent: 'list_transactions', filters: emptyFilters() }),
        );
        fakeQb.getCount.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
        fakeQb.getMany.mockResolvedValue([
          {
            transaction_date: '2026-04-01',
            description: null,
            amount: 300,
            category: 'Food',
          },
        ]);

        await service.financeChat(1, 'list my transactions');
        expect(fakeQb.orderBy).toHaveBeenCalledWith('tx.amount', 'DESC');
      });

      it('falls back to the category or a generic label when description is blank', async () => {
        geminiService.parseFinanceChatIntent.mockResolvedValue(
          mockParse({ intent: 'list_transactions', filters: emptyFilters() }),
        );
        fakeQb.getCount.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
        fakeQb.getMany.mockResolvedValue([
          {
            transaction_date: '2026-04-01',
            description: null,
            amount: 300,
            category: 'Food',
          },
        ]);

        const result = await service.financeChat(1, 'list my transactions');
        expect(result.answer).toContain('2026-04-01 — Food — ₹300');
      });
    });

    describe('category_breakdown', () => {
      it('lists every category with its total, not just the highest', async () => {
        geminiService.parseFinanceChatIntent.mockResolvedValue(
          mockParse({ intent: 'category_breakdown' }),
        );
        fakeQb.getCount.mockResolvedValue(10);
        fakeQb.getRawMany.mockResolvedValue([
          { name: 'Food', total: '5000.00' },
          { name: 'Rent', total: '15000.00' },
          { name: null, total: '200.00' },
        ]);

        const result = await service.financeChat(
          1,
          'break down my spending by category',
        );

        expect(result.answer).toContain('• Food — ₹5,000');
        expect(result.answer).toContain('• Rent — ₹15,000');
        expect(result.answer).toContain('• Other — ₹200');
      });

      it('reports no categories when there is no debit spend in the period', async () => {
        geminiService.parseFinanceChatIntent.mockResolvedValue(
          mockParse({ intent: 'category_breakdown' }),
        );
        fakeQb.getCount.mockResolvedValue(10);
        fakeQb.getRawMany.mockResolvedValue([]);

        const result = await service.financeChat(1, 'spending by category');
        expect(result.answer).toContain('No debit categories');
      });
    });

    describe('compare_periods', () => {
      it('reports current vs. immediately-preceding-period spending with a direction and delta', async () => {
        geminiService.parseFinanceChatIntent.mockResolvedValue(
          mockParse({
            intent: 'compare_periods',
            filters: emptyFilters({ relative: 'this_month' }),
          }),
        );
        fakeQb.getCount.mockResolvedValue(10);
        fakeQb.getRawOne
          .mockResolvedValueOnce({ sum: '20000.00' }) // current credits
          .mockResolvedValueOnce({ sum: '15000.00' }) // current debits
          .mockResolvedValueOnce({ sum: '18000.00' }) // previous credits
          .mockResolvedValueOnce({ sum: '10000.00' }); // previous debits

        const result = await service.financeChat(
          1,
          'how does this month compare to last month',
        );

        expect(result.answer).toContain('₹15,000');
        expect(result.answer).toContain('up by ₹5,000');
        expect(result.answer).toContain('₹10,000');
      });

      it('reports "down" when current spending is lower than the previous period', async () => {
        geminiService.parseFinanceChatIntent.mockResolvedValue(
          mockParse({ intent: 'compare_periods' }),
        );
        fakeQb.getCount.mockResolvedValue(10);
        fakeQb.getRawOne
          .mockResolvedValueOnce({ sum: '0' })
          .mockResolvedValueOnce({ sum: '5000.00' })
          .mockResolvedValueOnce({ sum: '0' })
          .mockResolvedValueOnce({ sum: '9000.00' });

        const result = await service.financeChat(1, 'am I spending less');
        expect(result.answer).toContain('down by ₹4,000');
      });
    });

    it('describes a single-account scope by bank name and account id', async () => {
      accountsService.findAllByUser.mockResolvedValue([
        { id: 7, bank_name: 'HDFC' },
      ]);
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({ filters: emptyFilters({ accountId: 7 }) }),
      );
      fakeQb.getCount.mockResolvedValue(1);
      fakeQb.getRawOne.mockResolvedValue({ sum: '100.00' });

      const result = await service.financeChat(1, 'how much on account 7');
      expect(result.answer).toContain('HDFC (account #7)');
    });

    it('describes a multi-account bank-name scope', async () => {
      accountsService.findAllByUser.mockResolvedValue([
        { id: 1, bank_name: 'HDFC Savings' },
        { id: 2, bank_name: 'HDFC Credit Card' },
      ]);
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({ filters: emptyFilters({ bankName: 'HDFC' }) }),
      );
      fakeQb.getCount.mockResolvedValue(1);
      fakeQb.getRawOne.mockResolvedValue({ sum: '100.00' });

      const result = await service.financeChat(1, 'how much on HDFC');
      expect(result.answer).toContain('accounts matching “HDFC”');
    });
  });

  // ---------------------------------------------------------------------
  // Private helpers — tested directly for exhaustive branch coverage
  // ---------------------------------------------------------------------
  describe('resolveChatDateRange (private)', () => {
    const call = (
      filters: Partial<FinanceChatFilters>,
      todayIsoStr = '2026-03-15',
    ) =>
      (service as any).resolveChatDateRange(emptyFilters(filters), todayIsoStr);

    it('uses explicit from/to when both are set', () => {
      expect(call({ from: '2026-01-01', to: '2026-01-31' })).toEqual({
        from: '2026-01-01',
        to: '2026-01-31',
      });
    });

    it('uses from through today when only from is set', () => {
      expect(call({ from: '2026-01-01' })).toEqual({
        from: '2026-01-01',
        to: '2026-03-15',
      });
    });

    it('uses the epoch through "to" when only to is set', () => {
      expect(call({ to: '2026-01-31' })).toEqual({
        from: '1970-01-01',
        to: '2026-01-31',
      });
    });

    it('falls back to the "relative" filter when neither from nor to is set', () => {
      expect(call({ relative: 'this_year' })).toEqual({
        from: '2026-01-01',
        to: '2026-03-15',
      });
    });

    it('defaults to last_30_days when nothing is set at all', () => {
      expect(call({})).toEqual({ from: '2026-02-14', to: '2026-03-15' });
    });
  });

  describe('resolveAccountIds (private)', () => {
    const accounts = [
      { id: 1, bank_name: 'HDFC' } as any,
      { id: 2, bank_name: 'ICICI' } as any,
    ];
    const call = (filters: Partial<FinanceChatFilters>) =>
      (service as any).resolveAccountIds(accounts, emptyFilters(filters));

    it('returns the single matching account id when accountId matches', () => {
      expect(call({ accountId: 2 })).toEqual([2]);
    });

    it('returns an empty array when accountId matches no account', () => {
      expect(call({ accountId: 999 })).toEqual([]);
    });

    it('returns ids of accounts whose bank name contains the filter (case-insensitive)', () => {
      expect(call({ bankName: 'hdfc' })).toEqual([1]);
    });

    it('returns undefined (no filter) when neither accountId nor bankName is set', () => {
      expect(call({})).toBeUndefined();
    });
  });

  describe('describeAccountScope (private)', () => {
    const accounts = [{ id: 1, bank_name: 'HDFC' } as any];
    const call = (
      accountIds: number[] | undefined,
      bankName: string | null = null,
    ) => (service as any).describeAccountScope(accounts, accountIds, bankName);

    it('describes "all your accounts" when accountIds is undefined', () => {
      expect(call(undefined)).toBe('all your accounts');
    });

    it('describes a single known account by bank name and id', () => {
      expect(call([1])).toBe('HDFC (account #1)');
    });

    it('falls back to "the selected account" if the single id is not found (defensive)', () => {
      expect(call([999])).toBe('the selected account');
    });

    it('describes multiple accounts by the bank-name filter when given', () => {
      expect(call([1, 2], 'HDFC')).toBe('accounts matching “HDFC”');
    });

    it('falls back to "the selected accounts" for multiple ids with no bank-name filter', () => {
      expect(call([1, 2], null)).toBe('the selected accounts');
    });
  });

  describe('executeFinanceIntent default case (private, defensive/unreachable via the public API)', () => {
    it('returns a generic fallback for an unrecognized intent', async () => {
      fakeQb.getCount.mockResolvedValue(1);
      const answer = await (service as any).executeFinanceIntent(
        1,
        'some_future_intent',
        emptyFilters(),
        '2026-01-01',
        '2026-01-31',
        undefined,
        'all your accounts',
      );
      expect(answer).toContain('I could not run that query');
    });
  });
});
