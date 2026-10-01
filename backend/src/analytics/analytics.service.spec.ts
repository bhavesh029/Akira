import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { Transaction } from '../entities/transaction.entity';
import { Account } from '../entities/account.entity';
import { GeminiService } from '../documents/gemini.service';
import { AiInsightsCacheService } from './ai-insights-cache.service';
import { AccountsService } from '../accounts/accounts.service';

/**
 * A minimal chainable fake for TypeORM's SelectQueryBuilder. Every chain
 * method returns the same object so `.clone()` behaves like the real thing
 * would for this test's purposes (each `.clone()` call is independent in
 * production, but since none of these tests depend on mutating one clone
 * without affecting another, sharing one fake keeps the test simple).
 */
function createFakeQueryBuilder() {
  const qb: any = {};
  ['where', 'andWhere', 'select', 'addSelect', 'groupBy', 'orderBy', 'limit', 'clone'].forEach((m) => {
    qb[m] = jest.fn().mockReturnValue(qb);
  });
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.getCount = jest.fn().mockResolvedValue(0);
  qb.getMany = jest.fn().mockResolvedValue([]);
  qb.getRawOne = jest.fn().mockResolvedValue(null);
  return qb;
}

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let transactionsRepository: { createQueryBuilder: jest.Mock };
  let fakeQb: ReturnType<typeof createFakeQueryBuilder>;

  beforeEach(async () => {
    fakeQb = createFakeQueryBuilder();
    transactionsRepository = { createQueryBuilder: jest.fn().mockReturnValue(fakeQb) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(Transaction), useValue: transactionsRepository },
        { provide: getRepositoryToken(Account), useValue: {} },
        { provide: GeminiService, useValue: {} },
        { provide: AiInsightsCacheService, useValue: { get: jest.fn(), set: jest.fn(), makeKey: jest.fn() } },
        { provide: AccountsService, useValue: { findAllByUser: jest.fn() } },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getSummary computes inflow/outflow/net from SQL aggregates, never from the LLM', async () => {
    // Call order inside getSummary: totals -> topCategories -> cashflow (all
    // via getRawMany on the same fake builder), transactionCount via getCount,
    // anomalies via getMany.
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

  it('getSummary scopes every query to the given userId', async () => {
    await service.getSummary(42, undefined, 'all');
    expect(fakeQb.where).toHaveBeenCalledWith('tx.userId = :userId', { userId: 42 });
  });

  it('getSummary applies an accountId filter when provided', async () => {
    await service.getSummary(1, 99, 'all');
    expect(fakeQb.andWhere).toHaveBeenCalledWith('tx.accountId = :accountId', { accountId: 99 });
  });

  it('getSummary defaults "Other" for a null category', async () => {
    fakeQb.getRawMany
      .mockResolvedValueOnce([]) // totals
      .mockResolvedValueOnce([{ name: null, value: '50.00' }]) // topCategories
      .mockResolvedValueOnce([]); // cashflow

    const summary = await service.getSummary(1, undefined, 'all');
    expect(summary.topCategories).toEqual([{ name: 'Other', value: 50 }]);
  });
});
