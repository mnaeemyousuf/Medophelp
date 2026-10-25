import { Router } from 'express';
import { z } from 'zod';
import { convertPurchaseRequestSchema, goodsReceiptSchema, objectId, poListQuery, purchaseOrderSchema, purchaseRequestListQuery, purchaseRequestSchema, supplierSchema } from '@hms/shared';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import * as svc from './purchasing.service';

export const purchasingRouter = Router();
const idParam = validate(z.object({ id: objectId }), 'params');

purchasingRouter.get(
  '/suppliers',
  requirePermission('purchasing.manage', 'inventory.view'),
  validate(z.object({ search: z.string().trim().max(60).optional(), includeInactive: z.coerce.boolean().optional() }), 'query'),
  ah(async (req, res) => res.json(await svc.listSuppliers(req.query as never))),
);
purchasingRouter.post('/suppliers', requirePermission('purchasing.manage'), validate(supplierSchema), ah(async (req, res) => res.status(201).json(await svc.createSupplier(req.body))));
purchasingRouter.put('/suppliers/:id', requirePermission('purchasing.manage'), idParam, validate(supplierSchema), ah(async (req, res) => res.json(await svc.updateSupplier(req.params.id, req.body))));

purchasingRouter.get('/orders', requirePermission('purchasing.manage', 'purchasing.approve'), validate(poListQuery, 'query'), ah(async (req, res) => res.json(await svc.listPurchaseOrders(req.query as never))));
purchasingRouter.post('/orders', requirePermission('purchasing.manage'), validate(purchaseOrderSchema), ah(async (req, res) => res.status(201).json(await svc.createPurchaseOrder(req.body))));
purchasingRouter.get('/orders/:id', requirePermission('purchasing.manage', 'purchasing.approve'), idParam, ah(async (req, res) => res.json(await svc.getPurchaseOrder(req.params.id))));
purchasingRouter.put('/orders/:id', requirePermission('purchasing.manage'), idParam, validate(purchaseOrderSchema), ah(async (req, res) => res.json(await svc.updatePurchaseOrder(req.params.id, req.body))));

const noteBody = validate(z.object({ note: z.string().trim().max(300).optional() }));
for (const action of ['submit', 'order', 'cancel'] as const) {
  purchasingRouter.post(`/orders/:id/${action}`, requirePermission('purchasing.manage'), idParam, noteBody, ah(async (req, res) => res.json(await svc.actOnPurchaseOrder(req.params.id, action, req.body.note))));
}
for (const action of ['approve', 'reject'] as const) {
  purchasingRouter.post(`/orders/:id/${action}`, requirePermission('purchasing.approve'), idParam, noteBody, ah(async (req, res) => res.json(await svc.actOnPurchaseOrder(req.params.id, action, req.body.note))));
}
// Purchase requests: raised by pharmacy/stores, approved by purchasing (not the requester), converted to a PO.
const requesters = requirePermission('inventory.manage', 'pharmacy.dispense', 'purchasing.manage');
const prReaders = requirePermission('inventory.manage', 'pharmacy.dispense', 'purchasing.manage', 'purchasing.approve');
purchasingRouter.get('/requests', prReaders, validate(purchaseRequestListQuery, 'query'), ah(async (req, res) => res.json(await svc.listPurchaseRequests(req.query as never))));
purchasingRouter.post('/requests', requesters, validate(purchaseRequestSchema), ah(async (req, res) => res.status(201).json(await svc.createPurchaseRequest(req.body))));
purchasingRouter.get('/requests/:id', prReaders, idParam, ah(async (req, res) => res.json(await svc.getPurchaseRequest(req.params.id))));
purchasingRouter.put('/requests/:id', requesters, idParam, validate(purchaseRequestSchema), ah(async (req, res) => res.json(await svc.updatePurchaseRequest(req.params.id, req.body))));
for (const action of ['submit', 'cancel', 'reopen'] as const) {
  purchasingRouter.post(`/requests/:id/${action}`, requesters, idParam, noteBody, ah(async (req, res) => res.json(await svc.actOnPurchaseRequest(req.params.id, action, req.body.note))));
}
for (const action of ['approve', 'reject'] as const) {
  purchasingRouter.post(`/requests/:id/${action}`, requirePermission('purchasing.approve'), idParam, noteBody, ah(async (req, res) => res.json(await svc.actOnPurchaseRequest(req.params.id, action, req.body.note))));
}
purchasingRouter.post('/requests/:id/convert', requirePermission('purchasing.manage'), idParam, validate(convertPurchaseRequestSchema), ah(async (req, res) => res.status(201).json(await svc.convertPurchaseRequest(req.params.id, req.body))));

purchasingRouter.post('/orders/:id/receive', requirePermission('purchasing.manage', 'inventory.manage'), idParam, validate(goodsReceiptSchema), ah(async (req, res) => res.status(201).json(await svc.receiveGoods(req.params.id, req.body))));
