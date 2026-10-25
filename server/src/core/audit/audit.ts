import { Schema, model, type InferSchemaType, Types } from 'mongoose';
import { ctx } from '../context';
import { logger } from '../logger';

const auditSchema = new Schema(
  {
    hospitalId: { type: Schema.Types.ObjectId, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    userName: String,
    roles: [String],
    action: { type: String, required: true }, // "patient.created", "payment.received", "auth.login_failed"
    module: { type: String, required: true, index: true },
    entity: { type: String, required: true },
    entityId: { type: String, index: true },
    ip: String,
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    meta: Schema.Types.Mixed,
    at: { type: Date, default: () => new Date(), index: true },
  },
  { versionKey: false },
);
auditSchema.index({ hospitalId: 1, at: -1 });
auditSchema.index({ entity: 1, entityId: 1, at: -1 });

// Immutable: any attempt to change or delete an audit entry fails.
const immutable = function (next: (err?: Error) => void) {
  next(new Error('Audit log entries are immutable'));
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndReplace'] as const) {
  auditSchema.pre(op as any, immutable);
}
auditSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('Audit log entries are immutable'));
  next();
});

export const AuditLog = model('AuditLog', auditSchema);
export type AuditLogDoc = InferSchemaType<typeof auditSchema>;

const SENSITIVE = new Set(['passwordHash', 'password', 'tokenHash', 'mfaSecret', '__v']);

/** Plain JSON copy without secrets, safe to store in the audit trail. */
export function snapshot(doc: unknown): unknown {
  if (doc == null) return undefined;
  const obj = typeof (doc as any).toObject === 'function' ? (doc as any).toObject({ depopulate: true }) : doc;
  return JSON.parse(
    JSON.stringify(obj, (k, v) => (SENSITIVE.has(k) ? undefined : v instanceof Types.ObjectId ? v.toString() : v)),
  );
}

/** Only the fields that changed, for compact update entries. */
export function diff(before: Record<string, any> | undefined, after: Record<string, any> | undefined) {
  if (!before || !after) return { before, after };
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (['updatedAt', 'updatedBy'].includes(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a };
}

export interface AuditEntry {
  action: string;
  module: string;
  entity: string;
  entityId?: string | Types.ObjectId;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
  /** Overrides for events recorded before a session exists (login, failed login). */
  userId?: Types.ObjectId;
  userName?: string;
  hospitalId?: Types.ObjectId;
}

/**
 * Writes an audit entry. Inside withTransaction() it joins the transaction, so the audit row
 * commits or rolls back with the change it describes.
 */
export async function recordAudit(entry: AuditEntry) {
  const c = ctx();
  try {
    await AuditLog.create({
      hospitalId: entry.hospitalId ?? c?.hospitalId,
      userId: entry.userId ?? c?.userId,
      userName: entry.userName ?? c?.userName,
      roles: c?.roles ?? [],
      action: entry.action,
      module: entry.module,
      entity: entry.entity,
      entityId: entry.entityId?.toString(),
      ip: c?.ip,
      before: snapshot(entry.before),
      after: snapshot(entry.after),
      meta: entry.meta,
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to write audit log');
    throw err;
  }
}
