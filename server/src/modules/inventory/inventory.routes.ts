import { Router } from 'express';
import { z } from 'zod';
import { INVENTORY_TX_TYPES, itemListQuery, itemSchema, objectId, paginationQuery, purchaseReturnSchema, stockAdjustmentSchema, transferSchema } from '@hms/shared';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import * as svc from './inventory.service';

export const inventoryRouter = Router();
const idParam = validate(z.object({ id: objectId }), 'params');

inventoryRouter.get('/items', requirePermission('inventory.view'), validate(itemListQuery, 'query'), ah(async (req, res) => res.json(await svc.listItems(req.query as never))));
inventoryRouter.post('/items', requirePermission('inventory.manage'), validate(itemSchema), ah(async (req, res) => res.status(201).json(await svc.createItem(req.body))));
inventoryRouter.get('/items/:id', requirePermission('inventory.view'), idParam, ah(async (req, res) => res.json(await svc.getItem(req.params.id))));
inventoryRouter.put('/items/:id', requirePermission('inventory.manage'), idParam, validate(itemSchema), ah(async (req, res) => res.json(await svc.updateItem(req.params.id, req.body))));

inventoryRouter.post('/adjustments', requirePermission('inventory.manage'), validate(stockAdjustmentSchema), ah(async (req, res) => res.status(201).json(await svc.adjust(req.body))));
inventoryRouter.post('/transfers', requirePermission('inventory.manage'), validate(transferSchema), ah(async (req, res) => res.status(201).json(await svc.transfer(req.body))));
inventoryRouter.post('/returns', requirePermission('inventory.manage', 'purchasing.manage'), validate(purchaseReturnSchema), ah(async (req, res) => res.status(201).json(await svc.returnToSupplier(req.body))));

inventoryRouter.get(
  '/transactions',
  requirePermission('inventory.view'),
  validate(paginationQuery.extend({ type: z.enum(INVENTORY_TX_TYPES).optional(), itemId: objectId.optional() }), 'query'),
  ah(async (req, res) => res.json(await svc.ledger(req.query as never))),
);
inventoryRouter.get(
  '/alerts',
  requirePermission('inventory.view', 'pharmacy.dispense'),
  validate(z.object({ days: z.coerce.number().int().min(1).max(365).default(90) }), 'query'),
  ah(async (req, res) => res.json(await svc.alerts((req.query as unknown as { days: number }).days))),
);
inventoryRouter.get('/summary', requirePermission('inventory.view', 'dashboard.executive'), ah(async (_req, res) => res.json(await svc.stockSummary())));
