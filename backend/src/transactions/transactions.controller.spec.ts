import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ExecutionContext,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import request from 'supertest';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

/**
 * Bug #8: GET /transactions's `type` (and other) query params were typed
 * but never actually validated, so an invalid value reached a Postgres enum
 * column directly and raised an unhandled 500 instead of a clean 400. These
 * tests drive the real controller + a `FindTransactionsQueryDto` through the
 * same global ValidationPipe configuration used in main.ts (whitelist,
 * forbidNonWhitelisted, transform), via actual HTTP requests — not just a
 * unit call to the handler — so a regression that drops the DTO or the pipe
 * config fails a real assertion.
 */
describe('TransactionsController query validation (Bug #8)', () => {
  let app: INestApplication;
  let transactionsService: { findAllByUser: jest.Mock };

  beforeEach(async () => {
    transactionsService = {
      findAllByUser: jest.fn().mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [
        { provide: TransactionsService, useValue: transactionsService },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          req.user = { id: 10 };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    // Mirrors the exact global pipe configuration in src/main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with no query params at all', async () => {
    const res = await request(app.getHttpServer()).get('/transactions');
    expect(res.status).toBe(200);
    expect(transactionsService.findAllByUser).toHaveBeenCalledWith(
      10,
      expect.any(Object),
    );
  });

  it('accepts a valid "type" value and passes it through unchanged', async () => {
    const res = await request(app.getHttpServer()).get(
      '/transactions?type=DEBIT',
    );
    expect(res.status).toBe(200);
    expect(transactionsService.findAllByUser).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ type: 'DEBIT' }),
    );
  });

  it('[Bug #8 fix] rejects an invalid "type" value with 400, not a 500', async () => {
    const res = await request(app.getHttpServer()).get(
      '/transactions?type=FOO',
    );
    expect(res.status).toBe(400);
    expect(transactionsService.findAllByUser).not.toHaveBeenCalled();
  });

  it('[Bug #8 fix] rejects a lowercase "type" value (enum is case-sensitive) with 400', async () => {
    const res = await request(app.getHttpServer()).get(
      '/transactions?type=debit',
    );
    expect(res.status).toBe(400);
  });

  it('[Bug #8 fix] rejects a non-numeric "accountId" with 400', async () => {
    const res = await request(app.getHttpServer()).get(
      '/transactions?accountId=abc',
    );
    expect(res.status).toBe(400);
    expect(transactionsService.findAllByUser).not.toHaveBeenCalled();
  });

  it('accepts a numeric "accountId" and transforms it to a real number', async () => {
    await request(app.getHttpServer()).get('/transactions?accountId=5');
    const filtersArg = transactionsService.findAllByUser.mock.calls[0][1];
    expect(filtersArg.accountId).toBe(5);
    expect(typeof filtersArg.accountId).toBe('number');
  });

  it('rejects a malformed "from" date with 400', async () => {
    const res = await request(app.getHttpServer()).get(
      '/transactions?from=not-a-date',
    );
    expect(res.status).toBe(400);
  });

  it('rejects an unrecognized query parameter with 400 (forbidNonWhitelisted)', async () => {
    const res = await request(app.getHttpServer()).get(
      '/transactions?sortBy=amount',
    );
    expect(res.status).toBe(400);
  });

  it('transforms "page" and "limit" to real numbers', async () => {
    await request(app.getHttpServer()).get('/transactions?page=2&limit=10');
    const filtersArg = transactionsService.findAllByUser.mock.calls[0][1];
    expect(filtersArg.page).toBe(2);
    expect(filtersArg.limit).toBe(10);
  });

  it('rejects page=0 with 400 (must be at least 1)', async () => {
    const res = await request(app.getHttpServer()).get('/transactions?page=0');
    expect(res.status).toBe(400);
  });

  it('trims the search filter', async () => {
    await request(app.getHttpServer()).get('/transactions?search=%20coffee%20');
    const filtersArg = transactionsService.findAllByUser.mock.calls[0][1];
    expect(filtersArg.search).toBe('coffee');
  });
});

describe('POST /transactions/recategorize', () => {
  let app: INestApplication;
  let transactionsService: { recategorizeAll: jest.Mock };

  beforeEach(async () => {
    transactionsService = {
      recategorizeAll: jest.fn().mockResolvedValue({ updated: 3, total: 10 }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [
        { provide: TransactionsService, useValue: transactionsService },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          req.user = { id: 10 };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('re-runs categorization scoped to the authenticated user and returns the update count', async () => {
    const res = await request(app.getHttpServer()).post(
      '/transactions/recategorize',
    );
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ updated: 3, total: 10 });
    expect(transactionsService.recategorizeAll).toHaveBeenCalledWith(10);
  });
});
