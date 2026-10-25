import { Router } from 'express';
import { z } from 'zod';
import { dispenseSchema, objectId, paginationQuery } from '@hms/shared';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import { idempotent } from '../../core/middleware/idempotency';
import * as svc from './pharmacy.service';

export const pharmacyRouter = Router();
const idParam = validate(z.object({ id: objectId }), 'params');

pharmacyRouter.get(
  '/formulary',
  requirePermission('prescriptions.create', 'pharmacy.dispense', 'inventory.view'),
  validate(z.object({ search: z.string().trim().max(60).optional() }), 'query'),
  ah(async (req, res) => res.json(await svc.formulary((req.query as { search?: string }).search))),
);
pharmacyRouter.get('/queue', requirePermission('pharmacy.dispense'), validate(paginationQuery, 'query'), ah(async (req, res) => res.json(await svc.queue(req.query as never))));
pharmacyRouter.get('/prescriptions/:id', requirePermission('pharmacy.dispense'), idParam, ah(async (req, res) => res.json(await svc.dispenseContext(req.params.id))));
pharmacyRouter.post('/prescriptions/:id/dispense', requirePermission('pharmacy.dispense'), idParam, idempotent(), validate(dispenseSchema), ah(async (req, res) => res.status(201).json(await svc.dispense(req.params.id, req.body))));
pharmacyRouter.get('/dispenses', requirePermission('pharmacy.dispense'), validate(paginationQuery, 'query'), ah(async (req, res) => res.json(await svc.history(req.query as never))));
pharmacyRouter.get('/controlled-register', requirePermission('pharmacy.controlled'), validate(paginationQuery, 'query'), ah(async (req, res) => res.json(await svc.controlledRegister(req.query as never))));
