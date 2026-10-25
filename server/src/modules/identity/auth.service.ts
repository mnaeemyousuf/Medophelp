import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { SessionUser } from '@hms/shared';
import { env } from '../../config/env';
import { asSystem, requireCtx } from '../../core/context';
import { BusinessRuleError, UnauthorizedError } from '../../core/errors';
import { recordAudit } from '../../core/audit/audit';
import { logger } from '../../core/logger';
import { Hospital } from '../organization/organization.models';
import { PasswordResetToken, RefreshToken, User, type UserDoc } from './identity.models';
import { invalidatePrincipal, loadPrincipal } from './principal';
import { randomToken, sha256, signAccessToken } from './tokens';

const MAX_FAILED = 5;
const LOCKOUT_MIN = 15;
const BCRYPT_COST = 12;
// Constant-time defence: compare against a dummy hash when the email doesn't exist.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_COST);

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshExpires: Date;
  persistent: boolean;
}

async function issueSession(user: UserDoc, familyId: string, persistent: boolean, meta: { ip?: string; ua?: string }): Promise<IssuedSession> {
  const refreshToken = randomToken();
  const refreshExpires = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await RefreshToken.create({
    userId: user._id,
    tokenHash: sha256(refreshToken),
    familyId,
    expiresAt: refreshExpires,
    ip: meta.ip,
    userAgent: meta.ua?.slice(0, 200),
    rememberMe: persistent,
  });
  const accessToken = signAccessToken({
    sub: user._id.toString(),
    hid: user.hospitalId.toString(),
    pca: Math.floor(user.passwordChangedAt.getTime() / 1000),
  });
  return { accessToken, refreshToken, refreshExpires, persistent };
}

export async function login(email: string, password: string, rememberMe: boolean, meta: { ip?: string; ua?: string }) {
  return asSystem(async () => {
    const user = (await User.findOne({ email: email.toLowerCase() }).select('+passwordHash')) as UserDoc | null;
    const now = new Date();

    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedError('Invalid email or password');
    }
    const audit = (action: string, meta?: Record<string, unknown>) =>
      recordAudit({ action, module: 'Auth', entity: 'User', entityId: user._id, userId: user._id, userName: user.fullName, hospitalId: user.hospitalId, meta });

    if (!user.isActive) {
      await audit('auth.login_blocked', { reason: 'inactive' });
      throw new UnauthorizedError('Invalid email or password');
    }
    if (user.lockoutEndsAt && user.lockoutEndsAt > now) {
      await audit('auth.login_blocked', { reason: 'locked' });
      const minutes = Math.ceil((user.lockoutEndsAt.getTime() - now.getTime()) / 60_000);
      throw new UnauthorizedError(`Account locked after repeated failed attempts. Try again in ${minutes} minute(s).`);
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      user.failedLoginCount += 1;
      if (user.failedLoginCount >= MAX_FAILED) {
        user.lockoutEndsAt = new Date(now.getTime() + LOCKOUT_MIN * 60_000);
        user.failedLoginCount = 0;
      }
      await user.save();
      await audit('auth.login_failed', { locked: !!user.lockoutEndsAt && user.lockoutEndsAt > now });
      throw new UnauthorizedError('Invalid email or password');
    }

    user.failedLoginCount = 0;
    user.lockoutEndsAt = undefined;
    user.lastLoginAt = now;
    await user.save();
    await audit('auth.login');
    return issueSession(user, crypto.randomUUID(), rememberMe, meta);
  });
}

/**
 * Rotates the refresh token. Presenting an already-rotated token means it was stolen or replayed:
 * the whole token family is revoked and the user must sign in again.
 */
export async function refresh(presented: string, meta: { ip?: string; ua?: string }) {
  return asSystem(async () => {
    const hash = sha256(presented);
    const token = await RefreshToken.findOne({ tokenHash: hash });
    if (!token) throw new UnauthorizedError('Session expired');

    if (token.revokedAt) {
      await RefreshToken.updateMany({ familyId: token.familyId, revokedAt: null }, { revokedAt: new Date() });
      logger.warn({ userId: token.userId.toString() }, 'Refresh token reuse detected; family revoked');
      await recordAudit({ action: 'auth.refresh_reuse', module: 'Auth', entity: 'User', entityId: token.userId, userId: token.userId });
      throw new UnauthorizedError('Session expired');
    }
    if (token.expiresAt < new Date()) throw new UnauthorizedError('Session expired');

    const user = (await User.findById(token.userId)) as UserDoc | null;
    if (!user || !user.isActive) throw new UnauthorizedError('Account is not active');

    const session = await issueSession(user, token.familyId, !!token.rememberMe, meta);
    token.revokedAt = new Date();
    token.replacedByHash = sha256(session.refreshToken);
    await token.save();
    return session;
  });
}

export async function logout(presented: string | undefined) {
  if (!presented) return;
  await asSystem(async () => {
    const token = await RefreshToken.findOne({ tokenHash: sha256(presented) });
    if (!token) return;
    await RefreshToken.updateMany({ familyId: token.familyId, revokedAt: null }, { revokedAt: new Date() });
    await recordAudit({ action: 'auth.logout', module: 'Auth', entity: 'User', entityId: token.userId, userId: token.userId });
  });
}

export async function getSessionUser(): Promise<SessionUser> {
  const c = requireCtx();
  const p = await loadPrincipal(c.userId!.toString());
  if (!p) throw new UnauthorizedError();
  const hospital = await Hospital.findById(p.hospitalId).lean();
  return {
    id: p.userId.toString(),
    email: p.email,
    fullName: p.fullName,
    roles: p.roles,
    permissions: [...p.permissions],
    hospital: {
      id: hospital!._id.toString(),
      name: hospital!.name,
      code: hospital!.code,
      logoUrl: hospital!.logoUrl ?? undefined,
      currency: hospital!.currency,
    },
    patientId: p.patientId?.toString(),
    doctorId: p.doctorId?.toString(),
    nurseId: p.nurseId?.toString(),
    employeeId: p.employeeId?.toString(),
    mustChangePassword: p.mustChangePassword,
  };
}

/** Always resolves the same way whether or not the email exists (no account enumeration). */
export async function requestPasswordReset(email: string) {
  await asSystem(async () => {
    const user = await User.findOne({ email: email.toLowerCase(), isActive: true });
    if (!user) return;
    const token = randomToken();
    await PasswordResetToken.create({ userId: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) });
    await recordAudit({ action: 'auth.password_reset_requested', module: 'Auth', entity: 'User', entityId: user._id, userId: user._id, hospitalId: user.hospitalId });
    // Delivered by the email channel in production. In development the link is logged for testing.
    if (!env.isProd) logger.info({ resetLink: `/reset-password?token=${token}` }, 'Password reset link (development only)');
  });
}

export async function resetPassword(token: string, newPassword: string) {
  await asSystem(async () => {
    const rec = await PasswordResetToken.findOne({ tokenHash: sha256(token) });
    if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw new BusinessRuleError('This reset link is invalid or has expired', 'invalid_token');
    const user = await User.findById(rec.userId);
    if (!user) throw new BusinessRuleError('This reset link is invalid or has expired', 'invalid_token');
    await applyNewPassword(user as UserDoc, newPassword);
    rec.usedAt = new Date();
    await rec.save();
    await recordAudit({ action: 'auth.password_reset', module: 'Auth', entity: 'User', entityId: user._id, userId: user._id, hospitalId: user.hospitalId });
  });
}

export async function changePassword(currentPassword: string, newPassword: string, meta: { ip?: string; ua?: string }) {
  const c = requireCtx();
  const user = (await User.findById(c.userId).select('+passwordHash')) as UserDoc | null;
  if (!user) throw new UnauthorizedError();
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new BusinessRuleError('Current password is incorrect', 'wrong_password');
  }
  await applyNewPassword(user, newPassword);
  await recordAudit({ action: 'auth.password_changed', module: 'Auth', entity: 'User', entityId: user._id });
  // Other sessions are revoked; this device gets a fresh session.
  return issueSession(user, crypto.randomUUID(), false, meta);
}

/** Sets a new password, clears lockout and revokes every existing session. */
export async function applyNewPassword(user: UserDoc, newPassword: string) {
  user.passwordHash = await hashPassword(newPassword);
  // +1s so tokens minted in the current second are also invalidated
  user.passwordChangedAt = new Date(Date.now() + 1000);
  user.mustChangePassword = false;
  user.failedLoginCount = 0;
  user.lockoutEndsAt = undefined;
  await user.save();
  await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
  invalidatePrincipal(user._id.toString());
}
