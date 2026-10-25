import { Router } from 'express';
import { z } from 'zod';
import { leaveRequestSchema, objectId } from '@hms/shared';
import { ah, todayString } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import * as hr from './hr.service';
import { myPayslips } from '../payroll/payroll.service';

/** Self-service for every staff member: own attendance, leave, payslips and reviews. */
export const meRouter = Router();
meRouter.use(requirePermission('self.service'));

meRouter.get('/attendance', validate(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() }), 'query'), ah(async (req, res) => res.json(await hr.myAttendance((req.query as { period?: string }).period ?? todayString().slice(0, 7)))));
meRouter.post('/attendance/clock-in', ah(async (_req, res) => res.json(await hr.clockIn())));
meRouter.post('/attendance/clock-out', ah(async (_req, res) => res.json(await hr.clockOut())));
meRouter.get('/leave', ah(async (_req, res) => res.json(await hr.myLeave())));
meRouter.post('/leave', validate(leaveRequestSchema), ah(async (req, res) => res.status(201).json(await hr.requestLeave(req.body))));
meRouter.get('/payslips', ah(async (_req, res) => res.json(await myPayslips())));
meRouter.post('/reviews/:id/acknowledge', validate(z.object({ id: objectId }), 'params'), validate(z.object({ comment: z.string().trim().max(1000).optional() })), ah(async (req, res) => res.json(await hr.acknowledgeReview(req.params.id, req.body.comment))));
