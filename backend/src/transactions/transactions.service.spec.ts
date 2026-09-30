import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { Transaction, TransactionType } from '../entities/transaction.entity';
import { AccountsService } from '../accounts/accounts.service';
import { AiInsightsCacheService } from '../analytics/ai-insights-cache.service';

function createFakeQueryBuilder() {
  const qb: any = {};
  ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy', 'addOrderBy', 'skip', 'take'].forEach((m) => {
    qb[m] = jest.fn().mockReturnValue(qb);
  });
  qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
  return qb;
}

describe('TransactionsService', () => {
  let service: TransactionsService;
  let transactionsRepository: any;
  let accountsService: { findOne: jest.Mock };
  let aiInsightsCache: { invalidateForUser: jest.Mock };
  let fakeQb: ReturnType<typeof createFakeQueryBuilder>;

  beforeEach(async () => {
    fakeQb = createFakeQueryBuilder();
    transactionsRepository = {
      create: jest.fn((data) => data),
      save: jest.fn((data) => ({ id: 1, ...data })),
      createQueryBuilder: jest.fn().mockReturnValue(fakeQb),
      findOne: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
    };
    accountsService = { findOne: jest.fn().mockResolvedValue({ id: 1, userId: 10 }) };
    aiInsightsCache = { invalidateForUser: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: getRepositoryToken(Transaction), useValue: transactionsRepository },
        { provide: AccountsService, useValue: accountsService },
        { provide: AiInsightsCacheService, useValue: aiInsightsCache },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('validates account ownership, saves, and invalidates the cache', async () => {
      const dto = { accountId: 1, amount: 500, type: TransactionType.DEBIT, transaction_date: '2026-03-01' } as any;

      const result = await service.create(10, dto);

      expect(accountsService.findOne).toHaveBeenCalledWith(1, 10);
      expect(transactionsRepository.save).toHaveBeenCalledWith(expect.objectContaining({ ...dto, userId: 10 }));
      expect(aiInsightsCache.invalidateForUser).toHaveBeenCalledWith(10);
      expect(result).toEqual(expect.objectContaining({ amount: 500, userId: 10 }));
    });

    it('propagates the NotFoundException if the account does not belong to the user', async () => {
      accountsService.findOne.mockRejectedValue(new NotFoundException('Account with ID "1" not found'));
      const dto = { accountId: 1, amount: 500, type: TransactionType.DEBIT, transaction_date: '2026-03-01' } as any;

      await expect(service.create(10, dto)).rejects.toBeInstanceOf(NotFoundException);
      expect(transactionsRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('findAllByUser', () => {
    it('always scopes to the given userId', async () => {
      await service.findAllByUser(10);
      expect(fakeQb.where).toHaveBeenCalledWith('tx.userId = :userId', { userId: 10 });
    });

    it('defaults to page 1 and limit 20 when no filters are given', async () => {
      const result = await service.findAllByUser(10);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(fakeQb.skip).toHaveBeenCalledWith(0);
      expect(fakeQb.take).toHaveBeenCalledWith(20);
    });

    it('computes skip correctly for page > 1', async () => {
      await service.findAllByUser(10, { page: 3, limit: 10 });
      expect(fakeQb.skip).toHaveBeenCalledWith(20); // (3-1)*10
      expect(fakeQb.take).toHaveBeenCalledWith(10);
    });

    it('clamps page below 1 up to 1', async () => {
      const result = await service.findAllByUser(10, { page: 0 });
      expect(result.page).toBe(1);
    });

    it('clamps a negative page up to 1', async () => {
      const result = await service.findAllByUser(10, { page: -5 });
      expect(result.page).toBe(1);
    });

    it('clamps limit below 1 up to 1', async () => {
      const result = await service.findAllByUser(10, { limit: 0 });
      expect(result.limit).toBe(1);
    });

    it('clamps limit above MAX_LIMIT (100) down to 100', async () => {
      const result = await service.findAllByUser(10, { limit: 500 });
      expect(result.limit).toBe(100);
    });

    it('applies an accountId filter when provided', async () => {
      await service.findAllByUser(10, { accountId: 5 });
      expect(fakeQb.andWhere).toHaveBeenCalledWith('tx.accountId = :accountId', { accountId: 5 });
    });

    it('does not apply an accountId filter when absent', async () => {
      await service.findAllByUser(10, {});
      expect(fakeQb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('tx.accountId'),
        expect.anything(),
      );
    });

    it('applies a type filter when provided', async () => {
      await service.findAllByUser(10, { type: TransactionType.CREDIT });
      expect(fakeQb.andWhere).toHaveBeenCalledWith('tx.type = :type', { type: TransactionType.CREDIT });
    });

    it('applies an exact category filter when provided', async () => {
      await service.findAllByUser(10, { category: 'Food' });
      expect(fakeQb.andWhere).toHaveBeenCalledWith('tx.category = :category', { category: 'Food' });
    });

    it('applies a BETWEEN date filter only when both from and to are provided', async () => {
      await service.findAllByUser(10, { from: '2026-01-01', to: '2026-01-31' });
      expect(fakeQb.andWhere).toHaveBeenCalledWith('tx.transaction_date BETWEEN :from AND :to', {
        from: '2026-01-01',
        to: '2026-01-31',
      });
    });

    it('[documents current behavior] ignores the date filter entirely when only "from" is given', async () => {
      await service.findAllByUser(10, { from: '2026-01-01' });
      expect(fakeQb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('transaction_date'),
        expect.anything(),
      );
    });

    it('[documents current behavior] ignores the date filter entirely when only "to" is given', async () => {
      await service.findAllByUser(10, { to: '2026-01-31' });
      expect(fakeQb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('transaction_date'),
        expect.anything(),
      );
    });

    it('applies a trimmed search filter across description and category', async () => {
      await service.findAllByUser(10, { search: '  coffee  ' });
      expect(fakeQb.andWhere).toHaveBeenCalledWith(
        '(tx.description ILIKE :search OR tx.category ILIKE :search)',
        { search: '%coffee%' },
      );
    });

    it('does not apply a search filter when it is empty or whitespace-only', async () => {
      await service.findAllByUser(10, { search: '   ' });
      expect(fakeQb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.anything(),
      );
    });

    it('orders by transaction_date DESC then created_at DESC', async () => {
      await service.findAllByUser(10);
      expect(fakeQb.orderBy).toHaveBeenCalledWith('tx.transaction_date', 'DESC');
      expect(fakeQb.addOrderBy).toHaveBeenCalledWith('tx.created_at', 'DESC');
    });

    it('computes totalPages as 0 when there are no results', async () => {
      fakeQb.getManyAndCount.mockResolvedValue([[], 0]);
      const result = await service.findAllByUser(10);
      expect(result.totalPages).toBe(0);
    });

    it('computes totalPages by rounding up', async () => {
      fakeQb.getManyAndCount.mockResolvedValue([[{ id: 1 }], 21]);
      const result = await service.findAllByUser(10, { limit: 20 });
      expect(result.totalPages).toBe(2);
      expect(result.total).toBe(21);
      expect(result.data).toEqual([{ id: 1 }]);
    });
  });

  describe('findOne', () => {
    it('returns the transaction when found', async () => {
      const tx = { id: 1, userId: 10 };
      transactionsRepository.findOne.mockResolvedValue(tx);
      await expect(service.findOne(1, 10)).resolves.toBe(tx);
      expect(transactionsRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1, userId: 10 },
        relations: ['account'],
      });
    });

    it('throws NotFoundException when not found', async () => {
      transactionsRepository.findOne.mockResolvedValue(null);
      await expect(service.findOne(999, 10)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the transaction does not exist', async () => {
      transactionsRepository.findOne.mockResolvedValue(null);
      await expect(service.update(1, 10, {} as any)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('validates the new account ownership when accountId is being changed', async () => {
      transactionsRepository.findOne.mockResolvedValue({ id: 1, userId: 10, accountId: 1 });
      await service.update(1, 10, { accountId: 2 } as any);
      expect(accountsService.findOne).toHaveBeenCalledWith(2, 10);
    });

    it('does not re-validate account ownership when accountId is not part of the update', async () => {
      transactionsRepository.findOne.mockResolvedValue({ id: 1, userId: 10, accountId: 1 });
      await service.update(1, 10, { category: 'Food' } as any);
      expect(accountsService.findOne).not.toHaveBeenCalled();
    });

    it('merges the DTO onto the transaction, saves, and invalidates the cache', async () => {
      const existing = { id: 1, userId: 10, category: 'Old' };
      transactionsRepository.findOne.mockResolvedValue(existing);

      const result = await service.update(1, 10, { category: 'New' } as any);

      expect(transactionsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, category: 'New' }),
      );
      expect(aiInsightsCache.invalidateForUser).toHaveBeenCalledWith(10);
      expect(result).toEqual(expect.objectContaining({ category: 'New' }));
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the transaction does not exist', async () => {
      transactionsRepository.findOne.mockResolvedValue(null);
      await expect(service.remove(1, 10)).rejects.toBeInstanceOf(NotFoundException);
      expect(transactionsRepository.remove).not.toHaveBeenCalled();
    });

    it('removes the transaction and invalidates the cache', async () => {
      const tx = { id: 1, userId: 10 };
      transactionsRepository.findOne.mockResolvedValue(tx);

      await service.remove(1, 10);

      expect(transactionsRepository.remove).toHaveBeenCalledWith(tx);
      expect(aiInsightsCache.invalidateForUser).toHaveBeenCalledWith(10);
    });
  });

  describe('countByUser', () => {
    it('delegates to the repository count scoped to the user', async () => {
      transactionsRepository.count.mockResolvedValue(42);
      await expect(service.countByUser(10)).resolves.toBe(42);
      expect(transactionsRepository.count).toHaveBeenCalledWith({ where: { userId: 10 } });
    });
  });
});
