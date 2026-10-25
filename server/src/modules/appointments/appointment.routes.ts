import { Router } from 'express';
import { z } from 'zod';
import {
  appointmentListQuery,
  availabilityQuery,
  cancelAppointmentSchema,
  createAppointmentSchema,
  objectId,
  rescheduleAppointmentSchema,
} from '@hms/shared';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import * as svc from './appointment.service';

export const appointmentRouter = Router();
const idParam = validate(z.object({ id: objectId }), 'params');

appointmentRouter.get('/availability', requirePermission('appointments.view', 'portal.self'), validate(availabilityQuery, 'query'), ah(async (req, res) => {
  const q = req.query as unknown as { doctorId: string; date: string };
  res.json(await svc.availability(q.doctorId, q.date));
}));
appointmentRouter.get('/', requirePermission('appointments.view', 'portal.self'), validate(appointmentListQuery, 'query'), ah(async (req, res) => res.json(await svc.listAppointments(req.query as never))));
appointmentRouter.post('/', requirePermission('appointments.manage', 'portal.self'), validate(createAppointmentSchema), ah(async (req, res) => res.status(201).json(await svc.createAppointment(req.body))));
appointmentRouter.get('/:id', requirePermission('appointments.view', 'portal.self'), idParam, ah(async (req, res) => res.json(await svc.getAppointment(req.params.id))));
appointmentRouter.post('/:id/confirm', requirePermission('appointments.manage'), idParam, ah(async (req, res) => res.json(await svc.confirm(req.params.id))));
appointmentRouter.post('/:id/check-in', requirePermission('appointments.checkin'), idParam, ah(async (req, res) => res.json(await svc.checkIn(req.params.id))));
appointmentRouter.post('/:id/cancel', requirePermission('appointments.manage', 'portal.self'), idParam, validate(cancelAppointmentSchema), ah(async (req, res) => res.json(await svc.cancel(req.params.id, req.body.reason))));
appointmentRouter.post('/:id/no-show', requirePermission('appointments.manage'), idParam, ah(async (req, res) => res.json(await svc.markNoShow(req.params.id))));
appointmentRouter.post('/:id/reschedule', requirePermission('appointments.manage'), idParam, validate(rescheduleAppointmentSchema), ah(async (req, res) => res.json(await svc.reschedule(req.params.id, req.body))));
