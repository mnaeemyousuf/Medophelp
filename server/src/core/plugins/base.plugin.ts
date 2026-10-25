import { Schema, type Query, type Aggregate, type SchemaDefinition } from 'mongoose';
import { ctx } from '../context';

export interface BasePluginOptions {
  /** Add hospitalId and scope every query to the caller's hospital. Default true. */
  tenant?: boolean;
  /** Add isDeleted/deletedAt/deletedBy and hide deleted docs by default. Default false. */
  softDelete?: boolean;
}

/**
 * The plugin adds these fields at runtime. Spread them into a schema definition as well when code
 * reads them, so Mongoose's type inference sees them (the plugin then leaves them as declared).
 */
export const tenantField = {
  hospitalId: { type: Schema.Types.ObjectId, ref: 'Hospital', required: true, index: true },
} as const;

export const actorFields = {
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
} as const;

export const softDeleteFields = {
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: Date,
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
} as const;

const QUERY_OPS = [
  'find',
  'findOne',
  'countDocuments',
  'findOneAndUpdate',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'distinct',
] as const;

/**
 * Applied to every operational schema:
 *  - createdAt/updatedAt + createdBy/updatedBy from the request context
 *  - hospitalId stamped on insert and AND-ed into every query, so a missing filter cannot leak
 *    another hospital's data. A tenant query with no context is refused unless running as system.
 *  - optional soft delete
 */
export function basePlugin(schema: Schema, opts: BasePluginOptions = {}) {
  const tenant = opts.tenant ?? true;
  const softDelete = opts.softDelete ?? false;

  schema.set('timestamps', true);
  const addMissing = (fields: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(fields)) if (!schema.path(k)) schema.add({ [k]: v } as SchemaDefinition);
  };
  addMissing(actorFields);
  if (tenant) addMissing(tenantField);
  if (softDelete) addMissing(softDeleteFields);

  schema.pre('validate', function (next) {
    const c = ctx();
    if (this.isNew) {
      if (tenant && !this.get('hospitalId') && c?.hospitalId) this.set('hospitalId', c.hospitalId);
      if (c?.userId && !this.get('createdBy')) this.set('createdBy', c.userId);
    } else if (c?.userId) {
      this.set('updatedBy', c.userId);
    }
    next();
  });

  for (const op of QUERY_OPS) {
    schema.pre(op as any, function (this: Query<unknown, unknown>, next: (err?: Error) => void) {
      const c = ctx();
      const filter = this.getFilter();
      if (tenant && !c?.system) {
        if (!c?.hospitalId) return next(new Error(`Unscoped ${op} on ${(this as any).model?.modelName}: no hospital in context`));
        if (filter.hospitalId === undefined) this.where({ hospitalId: c.hospitalId });
      }
      if (softDelete && filter.isDeleted === undefined && !(this.getOptions() as any).withDeleted) {
        this.where({ isDeleted: { $ne: true } });
      }
      if (op.startsWith('update') || op === 'findOneAndUpdate') {
        if (c?.userId) this.set({ updatedBy: c.userId });
      }
      next();
    });
  }

  schema.pre('aggregate', function (this: Aggregate<unknown>, next) {
    const c = ctx();
    const match: Record<string, unknown> = {};
    if (tenant && !c?.system) {
      if (!c?.hospitalId) return next(new Error('Unscoped aggregate: no hospital in context'));
      match.hospitalId = c.hospitalId;
    }
    if (softDelete) match.isDeleted = { $ne: true };
    if (Object.keys(match).length) this.pipeline().unshift({ $match: match });
    next();
  });
}
