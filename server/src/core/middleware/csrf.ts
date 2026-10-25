import type { RequestHandler } from 'express';
import { env } from '../../config/env';
import { ForbiddenError } from '../errors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth on top of SameSite=Strict cookies:
 *  - state-changing requests must carry the custom header (cannot be set cross-site without CORS preflight)
 *  - if the browser sends an Origin, it must be on the allow-list
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (SAFE.has(req.method)) return next();
  if (req.get('x-requested-with') !== 'hms') return next(new ForbiddenError('Missing CSRF header'));
  const origin = req.get('origin');
  if (origin && !env.corsOrigins.includes(origin)) return next(new ForbiddenError('Origin not allowed'));
  next();
};
