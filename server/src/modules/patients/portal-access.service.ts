import crypto from 'node:crypto';
import { SYSTEM_ROLES } from '@hms/shared';
import { asSystem, requireCtx } from '../../core/context';
import { BusinessRuleError, ConflictError } from '../../core/errors';
import { recordAudit } from '../../core/audit/audit';
import { oid, orNotFound } from '../../core/http';
import { Role, User } from '../identity/identity.models';
import { hashPassword } from '../identity/auth.service';
import { invalidatePrincipal } from '../identity/principal';
import { Patient } from './patient.models';

/** A one-time password that satisfies the password policy (upper, lower, digit, symbol, ≥ 10). */
function temporaryPassword() {
  const pick = (chars: string, n: number) => Array.from(crypto.randomBytes(n), (b) => chars[b % chars.length]).join('');
  return `${pick('ABCDEFGHJKLMNPQRSTUVWXYZ', 3)}${pick('abcdefghijkmnpqrstuvwxyz', 4)}${pick('23456789', 3)}${pick('!@#$%*', 1)}`;
}

export async function portalAccountStatus(patientId: string) {
  orNotFound(await Patient.exists({ _id: oid(patientId) }), 'Patient');
  const u = await User.findOne({ patientId: oid(patientId) }).select('email isActive lastLoginAt mustChangePassword createdAt').lean();
  return u ? { enabled: u.isActive, email: u.email, lastLoginAt: u.lastLoginAt ?? null, mustChangePassword: u.mustChangePassword, createdAt: (u as unknown as { createdAt: Date }).createdAt } : { enabled: false, email: null };
}

/**
 * Gives a registered patient a portal login (Patient role only, own records only). The temporary
 * password is returned once for staff to hand over; the patient must change it at first login.
 */
export async function enablePortalAccess(patientId: string, email: string) {
  const pid = oid(patientId);
  const p = orNotFound(await Patient.findById(pid).select('firstName lastName phone isProvisional').lean(), 'Patient');
  if (p.isProvisional) throw new BusinessRuleError('Complete the registration before enabling portal access');
  const existing = await User.findOne({ patientId: pid }).select('_id isActive').lean();
  if (existing?.isActive) throw new ConflictError('This patient already has portal access', 'portal_exists');
  if (await asSystem(() => User.exists({ email, isDeleted: { $in: [true, false] }, ...(existing ? { _id: { $ne: existing._id } } : {}) }))) {
    throw new ConflictError('A user with this email already exists');
  }
  const role = orNotFound(await Role.findOne({ name: SYSTEM_ROLES.PATIENT }).select('_id').lean(), 'Patient role');
  const password = temporaryPassword();
  if (existing) {
    await User.updateOne({ _id: existing._id }, { isActive: true, email, mustChangePassword: true, passwordHash: await hashPassword(password), passwordChangedAt: new Date() });
    invalidatePrincipal(existing._id.toString());
  } else {
    await User.create({ fullName: `${p.firstName} ${p.lastName}`.trim(), email, phone: p.phone, roleIds: [role._id], patientId: pid, passwordHash: await hashPassword(password), mustChangePassword: true });
  }
  await recordAudit({ action: 'portal_access.enabled', module: 'Patients', entity: 'Patient', entityId: pid, after: { email, by: requireCtx().userName } });
  return { email, temporaryPassword: password };
}

export async function disablePortalAccess(patientId: string) {
  const u = orNotFound(await User.findOne({ patientId: oid(patientId), isActive: true }).select('_id').lean(), 'Portal account');
  await User.updateOne({ _id: u._id }, { isActive: false });
  invalidatePrincipal(u._id.toString());
  await recordAudit({ action: 'portal_access.disabled', module: 'Patients', entity: 'Patient', entityId: oid(patientId) });
  return { enabled: false };
}
