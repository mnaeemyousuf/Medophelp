import { Router } from 'express';
import { z } from 'zod';
import { dispositionSchema, erListQuery, erNoteSchema, objectId, quickRegisterSchema, triageSchema } from '@hms/shared';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import * as svc from './emergency.service';

export const emergencyRouter = Router();
const idParam = validate(z.object({ id: objectId }), 'params');

emergencyRouter.get('/board', requirePermission('emergency.view'), ah(async (_req, res) => res.json(await svc.board())));
emergencyRouter.get('/cases', requirePermission('emergency.view'), validate(erListQuery, 'query'), ah(async (req, res) => res.json(await svc.listCases(req.query as never))));
emergencyRouter.post('/cases', requirePermission('emergency.manage', 'emergency.treat'), validate(quickRegisterSchema), ah(async (req, res) => res.status(201).json(await svc.quickRegister(req.body))));
emergencyRouter.get('/cases/:id', requirePermission('emergency.view'), idParam, ah(async (req, res) => res.json(await svc.getCase(req.params.id))));
emergencyRouter.post('/cases/:id/triage', requirePermission('emergency.manage', 'emergency.treat'), idParam, validate(triageSchema), ah(async (req, res) => res.json(await svc.triage(req.params.id, req.body))));
emergencyRouter.post('/cases/:id/take', requirePermission('emergency.treat'), idParam, ah(async (req, res) => res.json(await svc.takeCase(req.params.id))));
emergencyRouter.post('/cases/:id/notes', requirePermission('emergency.manage', 'emergency.treat'), idParam, validate(erNoteSchema), ah(async (req, res) => res.json(await svc.addNote(req.params.id, req.body.note))));
emergencyRouter.post('/cases/:id/disposition', requirePermission('emergency.manage', 'emergency.treat'), idParam, validate(dispositionSchema), ah(async (req, res) => res.json(await svc.disposition(req.params.id, req.body))));
