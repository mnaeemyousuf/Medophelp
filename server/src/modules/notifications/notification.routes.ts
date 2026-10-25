import { Router } from 'express';
import { z } from 'zod';
import { NOTIFICATION_TYPES, objectId, paginationQuery } from '@hms/shared';
import { requireCtx } from '../../core/context';
import { ah, oid, skipOf } from '../../core/http';
import { validate } from '../../core/middleware/validate';
import { Notification } from './notification.model';

export const notificationRouter = Router();

/** Staff see notifications addressed to their user; portal patients see those for their record. */
const mine = () => {
  const c = requireCtx();
  return c.patientId ? { $or: [{ userId: c.userId }, { patientId: c.patientId, userId: null }] } : { userId: c.userId };
};

notificationRouter.get('/', validate(paginationQuery.extend({ unreadOnly: z.coerce.boolean().optional(), type: z.enum(NOTIFICATION_TYPES).optional() }), 'query'), ah(async (req, res) => {
  const q = req.query as unknown as { page: number; pageSize: number; unreadOnly?: boolean; type?: string };
  const filter = { ...mine(), ...(q.unreadOnly ? { readAt: null } : {}), ...(q.type ? { type: q.type } : {}) };
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skipOf(q)).limit(q.pageSize).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...mine(), readAt: null }),
  ]);
  res.json({ items, total, unread, page: q.page, pageSize: q.pageSize });
}));

notificationRouter.post('/:id/read', validate(z.object({ id: objectId }), 'params'), ah(async (req, res) => {
  await Notification.updateOne({ _id: oid(req.params.id), ...mine() }, { readAt: new Date() });
  res.status(204).end();
}));

notificationRouter.post('/read-all', ah(async (_req, res) => {
  await Notification.updateMany({ ...mine(), readAt: null }, { readAt: new Date() });
  res.status(204).end();
}));
