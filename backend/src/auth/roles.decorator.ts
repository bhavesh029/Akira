import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../entities/user.entity';

export const ROLES_KEY = 'roles';

/**
 * Bug #6: `UserRole` was stored on `User` and embedded in the JWT payload
 * but nothing ever actually checked it anywhere — a role-based access
 * control mechanism that looked real but enforced nothing. `@Roles(...)`
 * (paired with `RolesGuard`, see `roles.guard.ts`) is a real, working
 * implementation, ready to apply to a future admin-only route with one line
 * — e.g. `@UseGuards(AuthGuard('jwt'), RolesGuard) @Roles(UserRole.ADMIN)`.
 * No route uses it yet, since no admin-only feature exists in this B2C app
 * today; that's a product decision for whenever one is added, not something
 * this fix should invent.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
