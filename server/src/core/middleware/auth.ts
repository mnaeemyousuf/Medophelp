import type { RequestHandler } from 'express';
import type { Permission } from '@hms/shared';
import { requireCtx, runWithContext } from '../context';
import { AppError, ForbiddenError, UnauthorizedError } from '../errors';
import { ACCESS_COOKIE, verifyAccessToken } from '../../modules/identity/tokens';
import { loadPrincipal } from '../../modules/identity/principal';

/** Every request runs inside an AsyncLocalStorage context that services, audit and the tenant plugin read. */
export const requestContext: RequestHandler = (req, _res, next) => {
  runWithContext({ roles: [], permissions: new Set(), ip: req.ip }, () => next());
};

/** Verifies the access-token cookie and loads roles/permissions into the context. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedError();
    let claims;
    try {
      claims = verifyAccessToken(token);
    } catch {
      throw new UnauthorizedError('Session expired');
    }
    const p = await loadPrincipal(claims.sub);
    if (!p || !p.isActive) throw new UnauthorizedError('Account is not active');
    if (Math.floor(p.passwordChangedAt.getTime() / 1000) > claims.pca) throw new UnauthorizedError('Session expired');
    // A temporary or reset password only opens the account endpoints (/auth/me, /auth/change-password)
    // until it is changed — enforced here, not just by the browser redirect.
    if (p.mustChangePassword && !req.originalUrl.startsWith('/api/auth/')) {
      throw new AppError(403, 'Change your temporary password before continuing', 'password_change_required');
    }

    const c = requireCtx();
    c.userId = p.userId;
    c.userName = p.fullName;
    c.hospitalId = p.hospitalId;
    c.roles = p.roles;
    c.permissions = p.permissions;
    c.patientId = p.patientId;
    c.doctorId = p.doctorId;
    c.nurseId = p.nurseId;
    c.employeeId = p.employeeId;
    next();
  } catch (err) {
    next(err);
  }
};

/** Route guard: the caller needs at least one of the listed permissions. */
export const requirePermission =
  (...anyOf: Permission[]): RequestHandler =>
  (_req, _res, next) => {
    const c = requireCtx();
    if (!anyOf.some((p) => c.permissions.has(p))) return next(new ForbiddenError());
    next();
  };
