import { Router } from 'express';
import { z } from 'zod';
import { claimDecisionSchema, claimListQuery, claimPaidSchema, createClaimSchema, objectId } from '@hms/shared';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import * as svc from './insurance.service';

export const insuranceRouter = Router();
const idParam = validate(z.object({ id: objectId }), 'params');
const guard = requirePermission('insurance.manage');

insuranceRouter.get('/eligible-invoices', guard, validate(z.object({ search: z.string().trim().max(60).optional() }), 'query'), ah(async (req, res) => res.json(await svc.eligibleInvoices((req.query as { search?: string }).search))));
insuranceRouter.get('/claims', guard, validate(claimListQuery, 'query'), ah(async (req, res) => res.json(await svc.listClaims(req.query as never))));
insuranceRouter.post('/claims', guard, validate(createClaimSchema), ah(async (req, res) => res.status(201).json(await svc.createClaim(req.body))));
insuranceRouter.get('/claims/:id', guard, idParam, ah(async (req, res) => res.json(await svc.getClaim(req.params.id))));
insuranceRouter.patch(
  '/claims/:id',
  guard,
  idParam,
  validate(z.object({ claimAmount: z.coerce.number().positive().max(100_000_000).optional(), notes: z.string().trim().max(1000).optional() })),
  ah(async (req, res) => res.json(await svc.updateDraft(req.params.id, req.body))),
);
for (const action of ['submit', 'review', 'reopen'] as const) {
  insuranceRouter.post(`/claims/:id/${action}`, guard, idParam, validate(z.object({ note: z.string().trim().max(300).optional() })), ah(async (req, res) => res.json(await svc.act(req.params.id, action, req.body.note))));
}
insuranceRouter.post('/claims/:id/decision', guard, idParam, validate(claimDecisionSchema), ah(async (req, res) => res.json(await svc.decide(req.params.id, req.body))));
insuranceRouter.post('/claims/:id/paid', requirePermission('insurance.manage'), requirePermission('payments.receive'), idParam, validate(claimPaidSchema), ah(async (req, res) => res.json(await svc.markPaid(req.params.id, req.body))));
