import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../entities/user.entity';

/**
 * Bug #6: `UserRole` was stored and JWT-embedded but nothing ever checked
 * it — a role mechanism that looked real but enforced nothing. These tests
 * prove `RolesGuard` actually enforces `@Roles(...)` correctly in every
 * branch, so removing or breaking the check fails a real assertion.
 */
describe('RolesGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  function contextWithUser(user: unknown): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows the request when no @Roles() metadata is present at all', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(contextWithUser({ role: UserRole.USER }))).toBe(true);
  });

  it('allows the request when @Roles() is present but empty', () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    expect(guard.canActivate(contextWithUser({ role: UserRole.USER }))).toBe(true);
  });

  it('allows the request when the user has one of the required roles', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    expect(guard.canActivate(contextWithUser({ role: UserRole.ADMIN }))).toBe(true);
  });

  it('allows the request when multiple roles are accepted and the user matches one', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN, UserRole.USER]);
    expect(guard.canActivate(contextWithUser({ role: UserRole.USER }))).toBe(true);
  });

  it('denies the request when the user does not have a required role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    expect(guard.canActivate(contextWithUser({ role: UserRole.USER }))).toBe(false);
  });

  it('denies the request when there is no user on the request at all', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    expect(guard.canActivate(contextWithUser(undefined))).toBe(false);
  });

  it('denies the request when the user object has no role property', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    expect(guard.canActivate(contextWithUser({}))).toBe(false);
  });

  it('reads metadata from both the handler and the class (getAllAndOverride)', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const context = contextWithUser({ role: UserRole.ADMIN });
    guard.canActivate(context);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
  });
});
