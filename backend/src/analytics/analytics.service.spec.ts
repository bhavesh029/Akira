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
    amount: null,
    compareOp: null,
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

    it('returns a canned help message when intent is "unknown"', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({ intent: 'unknown' }),
      );
      const result = await service.financeChat(1, 'tell me a joke');
      expect(result.answer).toContain(
        'I can answer questions about your recorded transactions',
      );
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

    it('reports no transactions found when the period has zero transactions', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(mockParse());
      fakeQb.getCount.mockResolvedValue(0);

      const result = await service.financeChat(1, 'how much did I spend');
      expect(result.answer).toContain('No transactions found between');
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

    it('compare_amount: asks for a number when no amount was parsed', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'compare_amount',
          filters: emptyFilters({ amount: null }),
        }),
      );
      fakeQb.getCount.mockResolvedValue(4);

      const result = await service.financeChat(1, 'did I spend a lot');
      expect(result.answer).toContain(
        'I could not tell which amount to compare',
      );
    });

    it('compare_amount: "gte" passes when spend meets the threshold', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'compare_amount',
          filters: emptyFilters({ amount: 10000, compareOp: 'gte' }),
        }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue({ sum: '15000.00' });

      const result = await service.financeChat(1, 'did I spend at least 10000');
      expect(result.answer).toContain('at least');
      expect(result.answer).not.toContain('not at least');
    });

    it('compare_amount: "gte" fails when spend is below the threshold', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'compare_amount',
          filters: emptyFilters({ amount: 10000, compareOp: 'gte' }),
        }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue({ sum: '5000.00' });

      const result = await service.financeChat(1, 'did I spend at least 10000');
      expect(result.answer).toContain('not at least');
    });

    it('compare_amount: "lte" passes when spend is at or below the threshold', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'compare_amount',
          filters: emptyFilters({ amount: 10000, compareOp: 'lte' }),
        }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue({ sum: '5000.00' });

      const result = await service.financeChat(1, 'did I spend at most 10000');
      expect(result.answer).toContain('at most');
      expect(result.answer).not.toContain('not at most');
    });

    it('compare_amount: "eq" passes on an exact (float-tolerant) match', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'compare_amount',
          filters: emptyFilters({ amount: 10000, compareOp: 'eq' }),
        }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue({ sum: '10000.00' });

      const result = await service.financeChat(1, 'did I spend exactly 10000');
      expect(result.answer).toContain('exactly');
      expect(result.answer).not.toContain('not exactly');
    });

    it('compare_amount: "eq" fails when the amounts differ', async () => {
      geminiService.parseFinanceChatIntent.mockResolvedValue(
        mockParse({
          intent: 'compare_amount',
          filters: emptyFilters({ amount: 10000, compareOp: 'eq' }),
        }),
      );
      fakeQb.getCount.mockResolvedValue(4);
      fakeQb.getRawOne.mockResolvedValue({ sum: '9000.00' });

      const result = await service.financeChat(1, 'did I spend exactly 10000');
      expect(result.answer).toContain('not exactly');
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
