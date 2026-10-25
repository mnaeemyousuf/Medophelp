import { Router } from 'express';
import { z } from 'zod';
import { isoDate, objectId, paginationQuery } from '@hms/shared';
import { requireCtx } from '../../core/context';
import { AuditLog } from '../../core/audit/audit';
import { ah, dateOnly, escapeRegex, oid, skipOf } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';

export const auditRouter = Router();

const query = paginationQuery.extend({
  module: z.string().max(40).optional(),
  action: z.string().max(60).optional(),
  entity: z.string().max(40).optional(),
  entityId: z.string().max(40).optional(),
  userId: objectId.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/** Read-only. There are deliberately no write, update or delete routes for audit entries. */
auditRouter.get('/', requirePermission('audit.view'), validate(query, 'query'), ah(async (req, res) => {
  const q = req.query as unknown as z.infer<typeof query>;
  // AuditLog is not tenant-plugged (it must record pre-auth events), so scope explicitly.
  const filter: Record<string, unknown> = { hospitalId: requireCtx().hospitalId };
  if (q.module) filter.module = q.module;
  if (q.action) filter.action = new RegExp(`^${escapeRegex(q.action)}`);
  if (q.entity) filter.entity = q.entity;
  if (q.entityId) filter.entityId = q.entityId;
  if (q.userId) filter.userId = oid(q.userId);
  if (q.search) filter.$or = [{ userName: new RegExp(escapeRegex(q.search), 'i') }, { action: new RegExp(escapeRegex(q.search), 'i') }];
  if (q.from || q.to) {
    const to = q.to ? new Date(dateOnly(q.to).getTime() + 86_400_000) : undefined;
    filter.at = { ...(q.from ? { $gte: dateOnly(q.from) } : {}), ...(to ? { $lt: to } : {}) };
  }
  const [items, total, modules] = await Promise.all([
    AuditLog.find(filter).sort({ at: -1 }).skip(skipOf(q)).limit(q.pageSize).lean(),
    AuditLog.countDocuments(filter),
    AuditLog.distinct('module', { hospitalId: requireCtx().hospitalId }),
  ]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize, modules });
}));
