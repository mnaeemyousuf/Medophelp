import { Types } from 'mongoose';
import { asSystem } from '../../core/context';
import { Role, User } from './identity.models';
import { Doctor, Employee, Nurse } from '../staff/staff.models';

export interface Principal {
  userId: Types.ObjectId;
  hospitalId: Types.ObjectId;
  fullName: string;
  email: string;
  roles: string[];
  permissions: Set<string>;
  patientId?: Types.ObjectId;
  doctorId?: Types.ObjectId;
  nurseId?: Types.ObjectId;
  employeeId?: Types.ObjectId;
  isActive: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: Date;
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; principal: Principal }>();

/**
 * Resolves the user's current roles and permissions. Cached for 60 s so permission changes made by
 * an admin take effect within a minute without forcing a re-login. (Single-process cache; swap for
 * Redis when running more than one API instance.)
 */
export async function loadPrincipal(userId: string): Promise<Principal | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.principal;

  const principal = await asSystem(async () => {
    const user = await User.findById(userId).lean();
    if (!user) return null;
    const roles = await Role.find({ _id: { $in: user.roleIds }, hospitalId: user.hospitalId }).lean();
    const [doctor, nurse, employee] = await Promise.all([
      Doctor.findOne({ userId: user._id, hospitalId: user.hospitalId }).select('_id').lean(),
      Nurse.findOne({ userId: user._id, hospitalId: user.hospitalId }).select('_id').lean(),
      Employee.findOne({ userId: user._id, hospitalId: user.hospitalId }).select('_id').lean(),
    ]);
    const p: Principal = {
      userId: user._id,
      hospitalId: user.hospitalId,
      fullName: user.fullName,
      email: user.email,
      roles: roles.map((r) => r.name),
      permissions: new Set(roles.flatMap((r) => r.permissions)),
      patientId: user.patientId ?? undefined,
      doctorId: doctor?._id,
      nurseId: nurse?._id,
      employeeId: employee?._id,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      passwordChangedAt: user.passwordChangedAt,
    };
    return p;
  });
  if (principal) cache.set(userId, { at: Date.now(), principal });
  return principal;
}

export function invalidatePrincipal(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
}
