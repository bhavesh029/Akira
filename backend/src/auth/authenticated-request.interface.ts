import { Request } from 'express';
import { User } from '../entities/user.entity';

/**
 * The shape of `@Req()` after `AuthGuard('jwt')` has run — `JwtStrategy.validate()`
 * returns the full `User` entity, which Passport attaches as `request.user`.
 * Use this instead of `@Req() req: any` so `req.user.*` access is type-checked.
 */
export interface AuthenticatedRequest extends Request {
  user: User;
}
