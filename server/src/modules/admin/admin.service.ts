import { Types } from 'mongoose';
import { ALL_PERMISSIONS, PERMISSIONS, type HospitalSettingsInput, type Permission } from '@hms/shared';
import type { z } from 'zod';
import type { createUserSchema, departmentSchema, roleSchema, serviceSchema, staffSchema, updateUserSchema } from '@hms/shared';
import { asSystem, currentHospitalId, requireCtx } from '../../core/context';
import { BusinessRuleError, ConflictError, ForbiddenError } from '../../core/errors';
import { diff, recordAudit, snapshot } from '../../core/audit/audit';
import { escapeRegex, dateOnly, oid, orNotFound, skipOf, sortBy } from '../../core/http';
import { withTransaction } from '../../core/db';
import { nextNumber } from '../../core/numbering/numbering';
import { Department, Hospital, Service } from '../organization/organization.models';
import { Role, User, type UserDoc } from '../identity/identity.models';
import { applyNewPassword, hashPassword } from '../identity/auth.service';
import { invalidatePrincipal } from '../identity/principal';
import { Doctor, Employee, Nurse } from '../staff/staff.models';
import { Appointment } from '../appointments/appointment.models';
import { Item } from '../inventory/inventory.models';

// ── Hospital configuration ───────────────────────────────────────────────────
export async function getHospital() {
  return orNotFound(await Hospital.findById(currentHospitalId()).lean(), 'Hospital');
}

export async function updateHospital(input: HospitalSettingsInput) {
  const h = orNotFound(await Hospital.findById(currentHospitalId()), 'Hospital');
  const before = snapshot(h) as Record<string, unknown>;
  if (input.catalog) {
    // Codes still used by records cannot disappear; deactivate them instead.
    const codes = new Set(input.catalog.appointmentTypes.map((t) => t.code));
    const usedTypes = (await Appointment.distinct('type')).filter((t) => !codes.has(t));
    if (usedTypes.length) throw new BusinessRuleError(`Appointment type(s) ${usedTypes.join(', ')} are used by existing appointments — deactivate them instead of removing`);
    const cats = new Set(input.catalog.medicineCategories);
    const usedCats = (await Item.distinct('therapeuticClass', { therapeuticClass: { $ne: null } })).filter((c) => c && !cats.has(c));
    if (usedCats.length) throw new BusinessRuleError(`Medicine categor(ies) ${usedCats.join(', ')} are assigned to items — reassign them first`);
  }
  h.set(input);
  await h.save();
  const d = diff(before, snapshot(h) as Record<string, unknown>);
  await recordAudit({ action: 'hospital.updated', module: 'Administration', entity: 'Hospital', entityId: h._id, ...d });
  return h.toObject();
}

// ── Departments ──────────────────────────────────────────────────────────────
export const listDepartments = (includeInactive = false) =>
  Department.find(includeInactive ? {} : { isActive: true }).sort({ name: 1 }).lean();

export async function createDepartment(input: z.infer<typeof departmentSchema>) {
  const d = await Department.create(input);
  await recordAudit({ action: 'department.created', module: 'Administration', entity: 'Department', entityId: d._id, after: d });
  return d.toObject();
}

export async function updateDepartment(id: string, input: z.infer<typeof departmentSchema>) {
  const d = orNotFound(await Department.findById(id), 'Department');
  const before = snapshot(d) as Record<string, unknown>;
  d.set(input);
  await d.save();
  await recordAudit({ action: 'department.updated', module: 'Administration', entity: 'Department', entityId: d._id, ...diff(before, snapshot(d) as Record<string, unknown>) });
  return d.toObject();
}

// ── Services / price list ────────────────────────────────────────────────────
export const listServices = (category?: string) =>
  Service.find({ isActive: true, ...(category ? { category } : {}) }).sort({ name: 1 }).lean();

export async function createService(input: z.infer<typeof serviceSchema>) {
  const s = await Service.create(input);
  await recordAudit({ action: 'service.created', module: 'Administration', entity: 'Service', entityId: s._id, after: s });
  return s.toObject();
}

export async function updateService(id: string, input: z.infer<typeof serviceSchema>) {
  const s = orNotFound(await Service.findById(id), 'Service');
  const before = snapshot(s) as Record<string, unknown>;
  s.set(input);
  await s.save();
  await recordAudit({ action: 'service.price_changed', module: 'Administration', entity: 'Service', entityId: s._id, ...diff(before, snapshot(s) as Record<string, unknown>) });
  return s.toObject();
}

// ── Roles & permissions ─────────────────────────────────────────────────────
export function permissionCatalogue() {
  return ALL_PERMISSIONS.map((code) => ({ code, ...PERMISSIONS[code] }));
}

export const listRoles = () => Role.find().sort({ isSystem: -1, name: 1 }).lean();

function assertKnownPermissions(perms: string[]) {
  const unknown = perms.filter((p) => !(p in PERMISSIONS));
  if (unknown.length) throw new BusinessRuleError(`Unknown permissions: ${unknown.join(', ')}`);
}

export async function createRole(input: z.infer<typeof roleSchema>) {
  assertKnownPermissions(input.permissions);
  const r = await Role.create({ ...input, isSystem: false });
  await recordAudit({ action: 'role.created', module: 'Administration', entity: 'Role', entityId: r._id, after: r });
  return r.toObject();
}

export async function updateRole(id: string, input: z.infer<typeof roleSchema>) {
  assertKnownPermissions(input.permissions);
  const r = orNotFound(await Role.findById(id), 'Role');
  if (r.isSystem && input.name !== r.name) throw new BusinessRuleError('System roles cannot be renamed');
  // Guard against an admin locking everybody out of role management.
  const c = requireCtx();
  if (r.isSystem && r.permissions.includes('roles.manage') && !input.permissions.includes('roles.manage')) {
    const self = await User.findById(c.userId).lean();
    if (self?.roleIds.some((x) => x.equals(r._id))) throw new BusinessRuleError('You cannot remove role management from your own system role');
  }
  const before = { name: r.name, description: r.description, permissions: [...r.permissions] };
  r.set(input);
  await r.save();
  invalidatePrincipal();
  const added = input.permissions.filter((p) => !before.permissions.includes(p as Permission));
  const removed = before.permissions.filter((p) => !input.permissions.includes(p));
  await recordAudit({
    action: 'role.permissions_changed',
    module: 'Administration',
    entity: 'Role',
    entityId: r._id,
    before,
    after: { name: r.name, description: r.description, permissions: r.permissions },
    meta: { added, removed },
  });
  return r.toObject();
}

// ── Users ────────────────────────────────────────────────────────────────────
export async function listUsers(q: { page: number; pageSize: number; search?: string; sort?: string }) {
  const filter: Record<string, unknown> = {};
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ fullName: rx }, { email: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).populate('roleIds', 'name').sort(sortBy(q.sort, { name: 'fullName', email: 'email', lastLogin: 'lastLoginAt', created: 'createdAt' }, { fullName: 1 })).skip(skipOf(q)).limit(q.pageSize).lean(),
    User.countDocuments(filter),
  ]);
  return {
    items: items.map((u) => ({
      ...u,
      roles: (u.roleIds as unknown as Array<{ _id: Types.ObjectId; name: string }>).map((r) => ({ id: r._id, name: r.name })),
      roleIds: undefined,
      isLocked: !!u.lockoutEndsAt && u.lockoutEndsAt > new Date(),
    })),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

async function assertRolesExist(roleIds: string[]) {
  const count = await Role.countDocuments({ _id: { $in: roleIds.map(oid) } });
  if (count !== roleIds.length) throw new BusinessRuleError('One or more roles do not exist');
}

export async function createUser(input: z.infer<typeof createUserSchema>) {
  await assertRolesExist(input.roleIds);
  // Emails are unique across all hospitals and include deactivated/deleted accounts.
  if (await asSystem(() => User.exists({ email: input.email, isDeleted: { $in: [true, false] } }))) {
    throw new ConflictError('A user with this email already exists');
  }
  const u = await User.create({
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    roleIds: input.roleIds.map(oid),
    passwordHash: await hashPassword(input.password),
    mustChangePassword: input.mustChangePassword,
  });
  await recordAudit({ action: 'user.created', module: 'Administration', entity: 'User', entityId: u._id, after: u });
  return { id: u._id };
}

export async function updateUser(id: string, input: z.infer<typeof updateUserSchema>) {
  const c = requireCtx();
  const u = orNotFound((await User.findById(id)) as UserDoc | null, 'User');
  if (input.roleIds) await assertRolesExist(input.roleIds);
  if (u._id.equals(c.userId!) && input.isActive === false) throw new ForbiddenError('You cannot deactivate your own account');
  const before = snapshot(u) as Record<string, unknown>;
  if (input.fullName) u.fullName = input.fullName;
  if (input.phone !== undefined) u.phone = input.phone;
  if (input.roleIds) u.roleIds = input.roleIds.map(oid) as never;
  if (input.isActive !== undefined) u.isActive = input.isActive;
  await u.save();
  invalidatePrincipal(id);
  const d = diff(before, snapshot(u) as Record<string, unknown>);
  await recordAudit({ action: input.roleIds ? 'user.roles_changed' : 'user.updated', module: 'Administration', entity: 'User', entityId: u._id, ...d });
  return { id: u._id };
}

export async function adminResetPassword(id: string, password: string) {
  const u = orNotFound((await User.findById(id)) as UserDoc | null, 'User');
  await applyNewPassword(u, password);
  u.mustChangePassword = true;
  await u.save();
  await recordAudit({ action: 'user.password_reset_by_admin', module: 'Administration', entity: 'User', entityId: u._id });
}

export async function unlockUser(id: string) {
  const u = orNotFound(await User.findById(id), 'User');
  u.lockoutEndsAt = undefined;
  u.failedLoginCount = 0;
  await u.save();
  await recordAudit({ action: 'user.unlocked', module: 'Administration', entity: 'User', entityId: u._id });
}

// ── Doctors & nurses ────────────────────────────────────────────────────────
export async function listDoctors(filter: { departmentId?: string; availableOnly?: boolean } = {}) {
  return Doctor.find({
    ...(filter.departmentId ? { departmentId: oid(filter.departmentId) } : {}),
    ...(filter.availableOnly ? { isAvailable: true } : {}),
  })
    .populate('departmentId', 'name code')
    .sort({ name: 1 })
    .lean();
}

export const listNurses = () => Nurse.find().populate('departmentId', 'name code').sort({ name: 1 }).lean();

export async function createStaff(input: z.infer<typeof staffSchema>) {
  const hospital = await getHospital();
  return withTransaction(async () => {
    const employeeNo = await nextNumber('employee', 'EMP-{n:5}', hospital.code);
    const [emp] = await Employee.create([
      {
        employeeNo,
        firstName: input.firstName,
        lastName: input.lastName,
        gender: input.gender,
        phone: input.phone,
        email: input.email,
        departmentId: oid(input.departmentId),
        designation: input.designation,
        joiningDate: dateOnly(input.joiningDate),
        employmentType: input.employmentType,
        userId: input.userId ? oid(input.userId) : undefined,
      },
    ]);
    const common = {
      employeeId: emp._id,
      userId: input.userId ? oid(input.userId) : undefined,
      departmentId: oid(input.departmentId),
      qualification: input.qualification,
      licenseNumber: input.licenseNumber,
    };
    let profile;
    if (input.kind === 'Doctor') {
      if (!input.specialization) throw new BusinessRuleError('Specialization is required for doctors');
      [profile] = await Doctor.create([
        {
          ...common,
          name: `Dr. ${input.firstName} ${input.lastName}`,
          specialization: input.specialization,
          consultationFee: input.consultationFee ?? 0,
          followUpFee: input.followUpFee ?? 0,
          slotMinutes: input.slotMinutes ?? 15,
          dutyStart: input.dutyStart ?? '09:00',
          dutyEnd: input.dutyEnd ?? '17:00',
          workingDays: input.workingDays ?? [1, 2, 3, 4, 5, 6],
        },
      ]);
    } else {
      [profile] = await Nurse.create([{ ...common, name: `${input.firstName} ${input.lastName}` }]);
    }
    if (input.userId) invalidatePrincipal(input.userId);
    await recordAudit({ action: `${input.kind.toLowerCase()}.created`, module: 'Administration', entity: input.kind, entityId: profile._id, after: profile });
    return { id: profile._id, employeeNo };
  });
}

export async function updateDoctor(id: string, input: Partial<{ consultationFee: number; followUpFee: number; slotMinutes: number; dutyStart: string; dutyEnd: string; workingDays: number[]; isAvailable: boolean; specialization: string }>) {
  const d = orNotFound(await Doctor.findById(id), 'Doctor');
  const before = snapshot(d) as Record<string, unknown>;
  d.set(input);
  await d.save();
  await recordAudit({ action: 'doctor.updated', module: 'Administration', entity: 'Doctor', entityId: d._id, ...diff(before, snapshot(d) as Record<string, unknown>) });
  return d.toObject();
}
