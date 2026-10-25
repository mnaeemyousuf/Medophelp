import { Router } from 'express';
import { z } from 'zod';
import {
  attendanceQuery,
  contractSchema,
  employeeListQuery,
  employeeSchema,
  isoDate,
  leaveDecisionSchema,
  leaveListQuery,
  manualAttendanceSchema,
  objectId,
  performanceReviewSchema,
} from '@hms/shared';
import { ah, todayString } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import * as svc from './hr.service';

export const hrRouter = Router();
const idParam = validate(z.object({ id: objectId }), 'params');

// Employees
hrRouter.get('/employees', requirePermission('hr.employees', 'hr.attendance', 'payroll.manage'), validate(employeeListQuery, 'query'), ah(async (req, res) => res.json(await svc.listEmployees(req.query as never))));
hrRouter.post('/employees', requirePermission('hr.employees'), validate(employeeSchema), ah(async (req, res) => res.status(201).json(await svc.createEmployee(req.body))));
hrRouter.get('/employees/:id', requirePermission('hr.employees', 'hr.attendance', 'payroll.manage', 'self.service'), idParam, ah(async (req, res) => res.json(await svc.getEmployee(req.params.id))));
hrRouter.put('/employees/:id', requirePermission('hr.employees'), idParam, validate(employeeSchema), ah(async (req, res) => res.json(await svc.updateEmployee(req.params.id, req.body))));
hrRouter.post('/employees/:id/contracts', requirePermission('hr.employees'), idParam, validate(contractSchema), ah(async (req, res) => res.status(201).json(await svc.addContract(req.params.id, req.body))));
hrRouter.post('/contracts/:id/terminate', requirePermission('hr.employees'), idParam, validate(z.object({ reason: z.string().trim().min(3).max(300) })), ah(async (req, res) => res.json(await svc.terminateContract(req.params.id, req.body.reason))));
hrRouter.post('/employees/:id/reviews', requirePermission('hr.employees'), idParam, validate(performanceReviewSchema), ah(async (req, res) => res.json(await svc.saveReview(req.params.id, req.body))));

// Attendance
hrRouter.get('/attendance/day', requirePermission('hr.attendance'), validate(attendanceQuery, 'query'), ah(async (req, res) => {
  const q = req.query as unknown as { date?: string; departmentId?: string };
  res.json(await svc.dayRegister(q.date ?? todayString(), q.departmentId));
}));
hrRouter.get('/attendance/summary', requirePermission('hr.attendance', 'reports.hr'), validate(attendanceQuery, 'query'), ah(async (req, res) => {
  const q = req.query as unknown as { period?: string; departmentId?: string; employeeId?: string };
  res.json(await svc.monthlySummary(q.period ?? todayString().slice(0, 7), q));
}));
hrRouter.post('/attendance/manual', requirePermission('hr.attendance'), validate(manualAttendanceSchema), ah(async (req, res) => res.json(await svc.manualEntry(req.body))));
hrRouter.post('/attendance/close-day', requirePermission('hr.attendance'), validate(z.object({ date: isoDate })), ah(async (req, res) => res.json(await svc.closeDay(req.body.date))));

// Leave
hrRouter.get('/leave', requirePermission('hr.leave.approve', 'hr.employees', 'self.service'), validate(leaveListQuery, 'query'), ah(async (req, res) => res.json(await svc.listLeave(req.query as never))));
hrRouter.post('/leave/:id/manager-decision', requirePermission('self.service'), idParam, validate(leaveDecisionSchema), ah(async (req, res) => res.json(await svc.managerDecision(req.params.id, req.body.approve, req.body.note))));
hrRouter.post('/leave/:id/hr-decision', requirePermission('hr.leave.approve'), idParam, validate(leaveDecisionSchema), ah(async (req, res) => res.json(await svc.hrDecision(req.params.id, req.body.approve, req.body.note))));
hrRouter.post('/leave/:id/cancel', requirePermission('self.service', 'hr.leave.approve'), idParam, ah(async (req, res) => res.json(await svc.cancelLeave(req.params.id))));

hrRouter.get('/stats', requirePermission('hr.employees', 'hr.attendance', 'dashboard.executive'), ah(async (_req, res) => res.json(await svc.hrStats())));
