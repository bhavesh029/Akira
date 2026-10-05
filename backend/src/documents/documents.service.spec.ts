// documents.service.ts imports the ESM-only `uuid` package, which Jest's
// default (non-ESM) transform can't parse — mock it out, the same way other
// specs in this repo stub problematic imports (e.g. pdf-parse).
jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let documentsRepository: any;
  let transactionsRepository: any;
  let storageService: any;
  let extractionService: any;
  let accountsService: any;
  let aiInsightsCache: { invalidateForUser: jest.Mock };
  let mockManagerExecute: jest.Mock;
  let mockWhere: jest.Mock;
  let mockSet: jest.Mock;

  beforeEach(() => {
    documentsRepository = { findOne: jest.fn() };

    mockManagerExecute = jest.fn().mockResolvedValue(undefined);
    mockWhere = jest.fn().mockReturnValue({ execute: mockManagerExecute });
    mockSet = jest.fn().mockReturnValue({ where: mockWhere });
    const mockUpdate = jest.fn().mockReturnValue({ set: mockSet });
    const fakeQueryBuilder = { update: mockUpdate };

    transactionsRepository = {
      find: jest.fn().mockResolvedValue([]),
      manager: {
        transaction: jest.fn(async (cb: (manager: any) => Promise<void>) =>
          cb({
            createQueryBuilder: jest.fn().mockReturnValue(fakeQueryBuilder),
          }),
        ),
      },
    };
    storageService = {};
    extractionService = {};
    accountsService = {};
    aiInsightsCache = { invalidateForUser: jest.fn() };

    service = new DocumentsService(
      documentsRepository,
      transactionsRepository,
      storageService,
      extractionService,
      accountsService,
      aiInsightsCache as any,
    );
  });

  describe('confirmReview', () => {
    it('throws NotFoundException when the document does not belong to the user', async () => {
      documentsRepository.findOne.mockResolvedValue(null);
      await expect(service.confirmReview(1, 10)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('bulk-confirms every unreviewed transaction for the document in one DB transaction and invalidates the cache', async () => {
      documentsRepository.findOne.mockResolvedValue({ id: 1, userId: 10 });
      transactionsRepository.find.mockResolvedValue([{ id: 101 }, { id: 102 }]);

      const result = await service.confirmReview(1, 10);

      expect(result).toEqual({ confirmed: 2 });
      expect(transactionsRepository.manager.transaction).toHaveBeenCalledTimes(
        1,
      );
      expect(mockSet).toHaveBeenCalledWith({ reviewed: true });
      expect(mockWhere).toHaveBeenCalledWith(
        'documentId = :id AND userId = :userId',
        { id: 1, userId: 10 },
      );
      expect(aiInsightsCache.invalidateForUser).toHaveBeenCalledWith(10);
    });

    it('does nothing and does not invalidate the cache when there are no unreviewed transactions', async () => {
      documentsRepository.findOne.mockResolvedValue({ id: 1, userId: 10 });
      transactionsRepository.find.mockResolvedValue([]);

      const result = await service.confirmReview(1, 10);

      expect(result).toEqual({ confirmed: 0 });
      expect(transactionsRepository.manager.transaction).not.toHaveBeenCalled();
      expect(aiInsightsCache.invalidateForUser).not.toHaveBeenCalled();
    });
  });
});
