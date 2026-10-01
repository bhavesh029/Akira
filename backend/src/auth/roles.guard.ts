import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { User, UserRole } from '../entities/user.entity';

/**
 * Bug #6: makes `@Roles(...)` actually enforce something. Must run after
 * `AuthGuard('jwt')` (which populates `request.user` from `JwtStrategy`) —
 * apply as `@UseGuards(AuthGuard('jwt'), RolesGuard)`, in that order.
 *
 * A route/controller with no `@Roles(...)` at all is left unrestricted by
 * this guard (it only enforces a restriction that's actually declared).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: User }>();
    const user = request.user;

    if (!user?.role) {
      return false;
    }

    return requiredRoles.includes(user.role);
  }
}
