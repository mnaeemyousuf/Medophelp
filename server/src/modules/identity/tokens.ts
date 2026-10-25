import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';
import { env } from '../../config/env';

export const ACCESS_COOKIE = 'hms_at';
export const REFRESH_COOKIE = 'hms_rt';

export interface AccessClaims {
  sub: string;
  hid: string;
  /** password-changed-at (epoch s): tokens minted before a password change are rejected */
  pca: number;
}

export function signAccessToken(claims: AccessClaims) {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_MIN * 60,
    issuer: 'hms-api',
    audience: 'hms-web',
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: 'hms-api',
    audience: 'hms-web',
  }) as AccessClaims;
}

export const randomToken = () => crypto.randomBytes(48).toString('base64url');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const baseCookie = (): CookieOptions => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict',
});

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string, refreshExpires: Date, persistent: boolean) {
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseCookie(), path: '/api', maxAge: env.ACCESS_TOKEN_TTL_MIN * 60_000 });
  // Refresh cookie is only ever sent to the auth endpoints. Without "remember me" it is a session cookie.
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookie(),
    path: '/api/auth',
    ...(persistent ? { expires: refreshExpires } : {}),
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie(), path: '/api' });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie(), path: '/api/auth' });
}
