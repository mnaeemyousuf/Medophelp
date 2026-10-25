import { Router } from 'express';
import { z } from 'zod';
import { admissionListQuery, admitSchema, bedSchema, bedStatusSchema, dischargeSchema, ipdNoteSchema, objectId, roomSchema, transferSchema2, wardSchema } from '@hms/shared';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import { BusinessRuleError } from '../../core/errors';
import { dischargeSummaryPdf } from '../../core/pdf/documents';
import * as svc from './ipd.service';

export const ipdRouter = Router();
const idParam = validate(z.object({ id: objectId }), 'params');

// Configuration
ipdRouter.get('/wards', requirePermission('ipd.view', 'ipd.config'), ah(async (_req, res) => res.json(await svc.listWards())));
ipdRouter.post('/wards', requirePermission('ipd.config'), validate(wardSchema), ah(async (req, res) => res.status(201).json(await svc.saveWard(req.body))));
ipdRouter.put('/wards/:id', requirePermission('ipd.config'), idParam, validate(wardSchema), ah(async (req, res) => res.json(await svc.saveWard(req.body, req.params.id))));
ipdRouter.post('/rooms', requirePermission('ipd.config'), validate(roomSchema), ah(async (req, res) => res.status(201).json(await svc.saveRoom(req.body))));
ipdRouter.post('/beds', requirePermission('ipd.config'), validate(bedSchema), ah(async (req, res) => res.status(201).json(await svc.saveBed(req.body))));

// Bed board & housekeeping
ipdRouter.get('/beds/board', requirePermission('ipd.view', 'ipd.manage', 'emergency.treat'), ah(async (_req, res) => res.json(await svc.bedBoard())));
ipdRouter.post(
  '/beds/:id/status',
  requirePermission('ipd.manage'),
  idParam,
  validate(bedStatusSchema.extend({ reservedForPatientId: objectId.optional() })),
  ah(async (req, res) => res.json(await svc.setBedStatus(req.params.id, req.body.status, req.body.note, req.body.reservedForPatientId))),
);

// Admissions
ipdRouter.get('/stats', requirePermission('ipd.view', 'dashboard.executive'), ah(async (_req, res) => res.json(await svc.ipdStats())));
ipdRouter.get('/admissions', requirePermission('ipd.view', 'portal.self'), validate(admissionListQuery, 'query'), ah(async (req, res) => res.json(await svc.listAdmissions(req.query as never))));
ipdRouter.post('/admissions', requirePermission('ipd.manage'), validate(admitSchema), ah(async (req, res) => res.status(201).json(await svc.admit(req.body))));
ipdRouter.get('/admissions/:id', requirePermission('ipd.view', 'portal.self'), idParam, ah(async (req, res) => res.json(await svc.getAdmission(req.params.id))));
ipdRouter.post('/admissions/:id/transfer', requirePermission('ipd.manage'), idParam, validate(transferSchema2), ah(async (req, res) => res.json(await svc.transfer(req.params.id, req.body))));
ipdRouter.post('/admissions/:id/notes', requirePermission('ipd.view'), idParam, validate(ipdNoteSchema), ah(async (req, res) => res.json(await svc.addNote(req.params.id, req.body.note))));
ipdRouter.post('/admissions/:id/discharge', requirePermission('ipd.discharge'), idParam, validate(dischargeSchema), ah(async (req, res) => res.json(await svc.discharge(req.params.id, req.body))));
ipdRouter.post('/admissions/:id/cancel', requirePermission('ipd.manage'), idParam, validate(z.object({ reason: z.string().trim().min(3).max(300) })), ah(async (req, res) => res.json(await svc.cancelAdmission(req.params.id, req.body.reason))));
ipdRouter.get(
  '/admissions/:id/discharge-summary.pdf',
  requirePermission('ipd.view', 'portal.self'),
  idParam,
  ah(async (req, res) => {
    const adm = await svc.getAdmission(req.params.id);
    if (adm.status !== 'Discharged') throw new BusinessRuleError('The discharge summary is available after discharge');
    const pdf = await dischargeSummaryPdf(adm as never);
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="discharge-${adm.admissionNo}.pdf"`);
    res.send(pdf);
  }),
);
