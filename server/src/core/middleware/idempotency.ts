import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import { Schema, model } from 'mongoose';
import { requireCtx } from '../context';
import { logger } from '../logger';

/**
 * Stored outcome of a request made with an `Idempotency-Key` header. A retried or double-clicked
 * payment, refund or dispense replays the first response instead of being executed twice.
 * Records expire after 24 hours (TTL index).
 */
const idempotencySchema = new Schema(
  {
    hospitalId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true },
    route: { type: String, required: true },
    bodyHash: { type: String, required: true },
    state: { type: String, enum: ['processing', 'done'], default: 'processing' },
    statusCode: Number,
    response: Schema.Types.Mixed,
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
idempotencySchema.index({ hospitalId: 1, userId: 1, key: 1 }, { unique: true });
idempotencySchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 3600 });
export const IdempotencyRecord = model('IdempotencyRecord', idempotencySchema);

const KEY = /^[A-Za-z0-9_-]{8,100}$/;

export const idempotent = (): RequestHandler => async (req, res, next) => {
  const key = req.header('Idempotency-Key');
  if (!key) return next();
  if (!KEY.test(key)) return res.status(400).json({ type: 'https://hms.local/problems/validation', title: 'Invalid Idempotency-Key', status: 400, code: 'invalid_idempotency_key' });
  const c = requireCtx();
  const route = `${req.method} ${req.baseUrl}${req.path}`;
  const bodyHash = crypto.createHash('sha256').update(`${route}|${JSON.stringify(req.body ?? {})}`).digest('hex');
  const scope = { hospitalId: c.hospitalId, userId: c.userId, key };
  try {
    await IdempotencyRecord.create({ ...scope, route, bodyHash });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) return next(err);
    const prior = await IdempotencyRecord.findOne(scope).lean();
    if (!prior) return next();
    if (prior.bodyHash !== bodyHash) {
      return res.status(422).json({ type: 'https://hms.local/problems/business-rule', title: 'This Idempotency-Key was already used for a different request', status: 422, code: 'idempotency_key_reused' });
    }
    if (prior.state === 'processing') {
      return res.status(409).json({ type: 'https://hms.local/problems/conflict', title: 'The same request is still being processed', status: 409, code: 'request_in_progress' });
    }
    res.setHeader('Idempotent-Replayed', 'true');
    return res.status(prior.statusCode ?? 200).json(prior.response);
  }

  // Store the outcome BEFORE the response leaves, so a retry sent the moment the client has the
  // answer replays it instead of seeing "still processing" (saving on 'finish' raced with fast retries).
  const json = res.json.bind(res);
  let settled = false;
  res.json = (b: unknown) => {
    settled = true;
    const status = res.statusCode;
    const save = status < 500
      ? IdempotencyRecord.updateOne(scope, { state: 'done', statusCode: status, response: b })
      : IdempotencyRecord.deleteOne(scope); // server errors may be retried
    save
      .catch((e) => logger.error({ err: e }, 'Failed to store idempotent response'))
      .finally(() => json(b));
    return res;
  };
  // A response that bypassed res.json (stream, redirect, aborted request) releases the key.
  res.on('close', () => {
    if (!settled) IdempotencyRecord.deleteOne(scope).catch((e) => logger.error({ err: e }, 'Failed to release idempotency key'));
  });
  next();
};
