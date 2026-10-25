import { Router } from 'express';
import { z } from 'zod';
import { doseActionSchema, doseTimesSchema, objectId, stopScheduleSchema } from '@hms/shared';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import * as svc from './medication.service';

/** Medication schedules and dose tracking: patients for themselves, clinical staff for their patients. */
export const medicationRouter = Router();
const idParam = validate(z.object({ id: objectId }), 'params');
const either = requirePermission('portal.self', 'medication.manage');

medicationRouter.get('/mine', requirePermission('portal.self'), ah(async (_req, res) => res.json(await svc.mySchedules())));
medicationRouter.get('/patients/:id', requirePermission('medication.manage'), idParam, ah(async (req, res) => res.json(await svc.patientSchedules(req.params.id))));
medicationRouter.get('/schedules/:id/doses', either, idParam, ah(async (req, res) => res.json(await svc.scheduleDoses(req.params.id))));
medicationRouter.put('/schedules/:id/times', either, idParam, validate(doseTimesSchema), ah(async (req, res) => res.json(await svc.updateTimes(req.params.id, req.body.times))));
medicationRouter.post('/schedules/:id/stop', requirePermission('medication.manage'), idParam, validate(stopScheduleSchema), ah(async (req, res) => res.json(await svc.stopSchedule(req.params.id, req.body.reason))));
medicationRouter.post('/doses/:id', either, idParam, validate(doseActionSchema), ah(async (req, res) => res.json(await svc.recordDose(req.params.id, req.body.status, req.body.note))));
