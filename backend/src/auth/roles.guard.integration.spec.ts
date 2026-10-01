import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { UserRole } from '../entities/user.entity';

/**
 * Bug #6, end-to-end proof: a real controller, decorated with the real
 * `@Roles()` + `RolesGuard`, driven through actual HTTP requests — not just
 * a unit call to `canActivate()`. A stand-in for `AuthGuard('jwt')` reads
 * the test role from a header instead of a real JWT, but `RolesGuard` itself
 * is exactly what production code would use.
 */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role = req.headers['x-test-role'] as string | undefined;
    req.user = role ? { id: 1, role } : undefined;
    return true;
  }
}

@Controller('test')
class TestController {
  @Get('admin-only')
  @UseGuards(FakeAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  adminOnly() {
    return { ok: true };
  }

  @Get('open')
  @UseGuards(FakeAuthGuard, RolesGuard)
  open() {
    return { ok: true };
  }
}

describe('RolesGuard (integration, via real HTTP requests)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TestController],
      providers: [RolesGuard],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows a user with the required role through an @Roles(ADMIN) route', async () => {
    const res = await request(app.getHttpServer())
      .get('/test/admin-only')
      .set('x-test-role', 'ADMIN');
    expect(res.status).toBe(200);
  });

  it('blocks a user without the required role with 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/test/admin-only')
      .set('x-test-role', 'USER');
    expect(res.status).toBe(403);
  });

  it('blocks an unauthenticated request (no user) with 403', async () => {
    const res = await request(app.getHttpServer()).get('/test/admin-only');
    expect(res.status).toBe(403);
  });

  it('allows any authenticated user through a route with no @Roles() at all', async () => {
    const res = await request(app.getHttpServer())
      .get('/test/open')
      .set('x-test-role', 'USER');
    expect(res.status).toBe(200);
  });
});
