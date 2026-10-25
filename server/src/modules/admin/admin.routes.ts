import { Router } from 'express';
import { z } from 'zod';
import {
  adminResetPasswordSchema,
  createUserSchema,
  departmentSchema,
  hospitalSettingsSchema,
  INVOICE_SOURCES,
  objectId,
  paginationQuery,
  roleSchema,
  serviceSchema,
  staffSchema,
  time24,
  updateUserSchema,
} from '@hms/shared';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import * as admin from './admin.service';
import { getCatalog } from '../organization/catalog';
import { integrationStatus } from '../../core/notifications/notify';

export const adminRouter = Router();
const idParam = validate(z.object({ id: objectId }), 'params');

// Hospital configuration
adminRouter.get('/hospital', requirePermission('system.config'), ah(async (_req, res) => res.json({ ...(await admin.getHospital()), catalog: await getCatalog() })));
// Configured lists (appointment types, payment methods, medicine categories) — needed by every form.
adminRouter.get('/catalog', ah(async (_req, res) => res.json(await getCatalog())));
// Which external notification channels can really deliver (vs demo mode). Never returns secrets.
adminRouter.get('/integrations', requirePermission('system.config'), ah(async (_req, res) => res.json(integrationStatus())));
adminRouter.put('/hospital', requirePermission('system.config'), validate(hospitalSettingsSchema), ah(async (req, res) => res.json(await admin.updateHospital(req.body))));

// Departments (read by any signed-in user — needed for scheduling dropdowns)
adminRouter.get(
  '/departments',
  validate(z.object({ includeInactive: z.coerce.boolean().optional() }), 'query'),
  ah(async (req, res) => res.json(await admin.listDepartments((req.query as { includeInactive?: boolean }).includeInactive))),
);
adminRouter.post('/departments', requirePermission('departments.manage'), validate(departmentSchema), ah(async (req, res) => res.status(201).json(await admin.createDepartment(req.body))));
adminRouter.put('/departments/:id', requirePermission('departments.manage'), idParam, validate(departmentSchema), ah(async (req, res) => res.json(await admin.updateDepartment(req.params.id, req.body))));

// Services / price list
adminRouter.get(
  '/services',
  requirePermission('services.manage', 'billing.manage', 'billing.view'),
  validate(z.object({ category: z.enum(INVOICE_SOURCES).optional() }), 'query'),
  ah(async (req, res) => res.json(await admin.listServices((req.query as { category?: string }).category))),
);
adminRouter.post('/services', requirePermission('services.manage'), validate(serviceSchema), ah(async (req, res) => res.status(201).json(await admin.createService(req.body))));
adminRouter.put('/services/:id', requirePermission('services.manage'), idParam, validate(serviceSchema), ah(async (req, res) => res.json(await admin.updateService(req.params.id, req.body))));

// Roles & permissions
adminRouter.get('/permissions', requirePermission('roles.manage'), (_req, res) => {
  res.json(admin.permissionCatalogue());
});
adminRouter.get('/roles', requirePermission('roles.manage', 'users.view', 'users.manage'), ah(async (_req, res) => res.json(await admin.listRoles())));
adminRouter.post('/roles', requirePermission('roles.manage'), validate(roleSchema), ah(async (req, res) => res.status(201).json(await admin.createRole(req.body))));
adminRouter.put('/roles/:id', requirePermission('roles.manage'), idParam, validate(roleSchema), ah(async (req, res) => res.json(await admin.updateRole(req.params.id, req.body))));

// Users
adminRouter.get('/users', requirePermission('users.view', 'users.manage'), validate(paginationQuery, 'query'), ah(async (req, res) => res.json(await admin.listUsers(req.query as never))));
adminRouter.post('/users', requirePermission('users.manage'), validate(createUserSchema), ah(async (req, res) => res.status(201).json(await admin.createUser(req.body))));
adminRouter.patch('/users/:id', requirePermission('users.manage'), idParam, validate(updateUserSchema), ah(async (req, res) => res.json(await admin.updateUser(req.params.id, req.body))));
adminRouter.post('/users/:id/reset-password', requirePermission('users.manage'), idParam, validate(adminResetPasswordSchema), ah(async (req, res) => {
  await admin.adminResetPassword(req.params.id, req.body.password);
  res.status(204).end();
}));
adminRouter.post('/users/:id/unlock', requirePermission('users.manage'), idParam, ah(async (req, res) => {
  await admin.unlockUser(req.params.id);
  res.status(204).end();
}));

// Doctors & nurses
adminRouter.get(
  '/doctors',
  validate(z.object({ departmentId: objectId.optional(), availableOnly: z.coerce.boolean().optional() }), 'query'),
  ah(async (req, res) => res.json(await admin.listDoctors(req.query as never))),
);
adminRouter.get('/nurses', requirePermission('staff.view', 'staff.manage'), ah(async (_req, res) => res.json(await admin.listNurses())));
adminRouter.post('/staff', requirePermission('staff.manage'), validate(staffSchema), ah(async (req, res) => res.status(201).json(await admin.createStaff(req.body))));
adminRouter.patch(
  '/doctors/:id',
  requirePermission('staff.manage'),
  idParam,
  validate(
    z.object({
      consultationFee: z.coerce.number().min(0).optional(),
      followUpFee: z.coerce.number().min(0).optional(),
      slotMinutes: z.coerce.number().int().min(5).max(120).optional(),
      dutyStart: time24.optional(),
      dutyEnd: time24.optional(),
      workingDays: z.array(z.number().int().min(1).max(7)).optional(),
      isAvailable: z.boolean().optional(),
      specialization: z.string().trim().min(2).max(100).optional(),
    }),
  ),
  ah(async (req, res) => res.json(await admin.updateDoctor(req.params.id, req.body))),
);
