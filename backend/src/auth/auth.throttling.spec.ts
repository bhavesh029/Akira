import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Bug #4: /auth/login and /auth/register had no rate limiting at all,
 * leaving them open to brute-force / credential-stuffing. These tests drive
 * the real AuthController + real ThrottlerGuard through actual HTTP requests
 * (via supertest) — not a mock of the throttling behavior — with only
 * AuthService mocked, so a future change that weakens or removes the
 * `@Throttle` decorator fails a real assertion, not just a lint check.
 *
 * A standalone module (not the full AppModule) is used deliberately: it
 * avoids bootstrapping the database/other modules entirely, and each test
 * gets a fresh in-memory throttler-storage instance since a new module is
 * compiled per test.
 */
describe('AuthController rate limiting (Bug #4)', () => {
  let app: INestApplication;
  let authService: { register: jest.Mock; login: jest.Mock };

  beforeEach(async () => {
    authService = {
      register: jest.fn().mockResolvedValue({ access_token: 't', user: { id: 1 } }),
      login: jest.fn().mockResolvedValue({ access_token: 't', user: { id: 1 } }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const loginBody = { email: 'a@example.com', password: 'password123' };
  const registerBody = { name: 'Ada', email: 'a@example.com', password: 'password123' };

  it('allows requests up to the configured limit (5 per minute) on /auth/login', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer()).post('/auth/login').send(loginBody);
      expect(res.status).not.toBe(429);
    }
    expect(authService.login).toHaveBeenCalledTimes(5);
  });

  it('blocks the 6th /auth/login request within the window with 429', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/auth/login').send(loginBody);
    }

    const res = await request(app.getHttpServer()).post('/auth/login').send(loginBody);

    expect(res.status).toBe(429);
    expect(authService.login).toHaveBeenCalledTimes(5); // the 6th never reached the service
  });

  it('blocks the 6th /auth/register request within the window with 429', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/auth/register').send(registerBody);
    }

    const res = await request(app.getHttpServer()).post('/auth/register').send(registerBody);

    expect(res.status).toBe(429);
    expect(authService.register).toHaveBeenCalledTimes(5);
  });

  it('tracks /auth/login and /auth/register as independent limits (one exhausting does not block the other)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/auth/login').send(loginBody);
    }
    // login's bucket is now exhausted — register must still be unaffected.
    const res = await request(app.getHttpServer()).post('/auth/register').send(registerBody);

    expect(res.status).not.toBe(429);
    expect(authService.register).toHaveBeenCalledTimes(1);
  });
});
