import { Router } from 'express';
import { z } from 'zod';
import { isoDate } from '@hms/shared';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import { frontDesk, resolveRange, summary, type RangePreset } from './dashboard.service';

export const dashboardRouter = Router();

const rangeQuery = z.object({
  preset: z.enum(['today', 'yesterday', 'week', 'month', 'lastMonth', 'custom']).default('month'),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

dashboardRouter.get('/summary', requirePermission('dashboard.executive', 'dashboard.financial'), validate(rangeQuery, 'query'), ah(async (req, res) => {
  const q = req.query as unknown as { preset: RangePreset; from?: string; to?: string };
  res.json(await summary(resolveRange(q.preset, q.from, q.to)));
}));

dashboardRouter.get('/front-desk', requirePermission('appointments.view', 'nursing.queue'), ah(async (_req, res) => res.json(await frontDesk())));
