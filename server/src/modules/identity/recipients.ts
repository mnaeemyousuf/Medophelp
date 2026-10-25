import type { Types } from 'mongoose';
import type { Permission } from '@hms/shared';
import { Role, User } from './identity.models';

/** Active users in the current hospital whose roles grant the permission (for operational alerts). */
export async function usersWithPermission(permission: Permission): Promise<Types.ObjectId[]> {
  const roles = await Role.find({ permissions: permission }).select('_id').lean();
  if (!roles.length) return [];
  const users = await User.find({ roleIds: { $in: roles.map((r) => r._id) }, isActive: true }).select('_id').lean();
  return users.map((u) => u._id);
}
