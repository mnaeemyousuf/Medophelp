import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { changePasswordSchema, forgotPasswordSchema, loginSchema, resetPasswordSchema } from '@hms/shared';
import { ah } from '../../core/http';
import { validate } from '../../core/middleware/validate';
import { authenticate } from '../../core/middleware/auth';
import { UnauthorizedError } from '../../core/errors';
import * as auth from './auth.service';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from './tokens';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { title: 'Too many attempts. Please wait a minute and try again.', status: 429, code: 'rate_limited' },
});

const meta = (req: { ip?: string; get(h: string): string | undefined }) => ({ ip: req.ip, ua: req.get('user-agent') });

authRouter.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  ah(async (req, res) => {
    const s = await auth.login(req.body.email, req.body.password, req.body.rememberMe, meta(req));
    setAuthCookies(res, s.accessToken, s.refreshToken, s.refreshExpires, s.persistent);
    res.status(204).end();
  }),
);

authRouter.post(
  '/refresh',
  authLimiter,
  ah(async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE];
    if (!presented) throw new UnauthorizedError('Session expired');
    try {
      const s = await auth.refresh(presented, meta(req));
      setAuthCookies(res, s.accessToken, s.refreshToken, s.refreshExpires, s.persistent);
      res.status(204).end();
    } catch (err) {
      clearAuthCookies(res);
      throw err;
    }
  }),
);

authRouter.post(
  '/logout',
  ah(async (req, res) => {
    await auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearAuthCookies(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  authenticate,
  ah(async (_req, res) => {
    res.json(await auth.getSessionUser());
  }),
);

authRouter.post(
  '/forgot-password',
  authLimiter,
  validate(forgotPasswordSchema),
  ah(async (req, res) => {
    await auth.requestPasswordReset(req.body.email);
    res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
  }),
);

authRouter.post(
  '/reset-password',
  authLimiter,
  validate(resetPasswordSchema),
  ah(async (req, res) => {
    await auth.resetPassword(req.body.token, req.body.password);
    res.status(204).end();
  }),
);

authRouter.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  ah(async (req, res) => {
    const s = await auth.changePassword(req.body.currentPassword, req.body.newPassword, meta(req));
    setAuthCookies(res, s.accessToken, s.refreshToken, s.refreshExpires, s.persistent);
    res.status(204).end();
  }),
);
