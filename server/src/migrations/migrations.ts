import { Schema, model, type Types } from 'mongoose';
import { DEFAULT_CATALOG, DEFAULT_ROLE_PERMISSIONS } from '@hms/shared';
import { runWithContext } from '../core/context';
import { logger } from '../core/logger';
import { ensureCounterAtLeast } from '../core/numbering/numbering';
import { Hospital } from '../modules/organization/organization.models';
import { Role } from '../modules/identity/identity.models';
import { Employee } from '../modules/staff/staff.models';
import { invalidatePrincipal } from '../modules/identity/principal';

/**
 * Versioned, forward-only data migrations. Each runs once per database (recorded in
 * `schemamigrations`) and must be idempotent. Schema shape lives in the Mongoose models; indexes
 * are built by Mongoose; migrations handle data changes that existing databases need.
 *
 * Add a migration: append { id: 'NNN-short-name', description, up } — never edit or reorder
 * applied ones.
 */
interface Migration {
  id: string;
  description: string;
  up: (hospitalId: Types.ObjectId) => Promise<string>;
}

const MigrationRecord = model(
  'SchemaMigration',
  new Schema({ _id: { type: String }, description: String, appliedAt: { type: Date, default: () => new Date() }, results: [String] }, { versionKey: false }),
);

export const MIGRATIONS: Migration[] = [
  {
    id: '001-system-role-permissions',
    description: 'Grant permissions introduced after the first release (self-service, payroll/recruitment approval, medication management, reports) to the seeded system roles',
    async up() {
      const roles = await Role.find({ isSystem: true });
      let changed = 0;
      for (const r of roles) {
        const wanted = DEFAULT_ROLE_PERMISSIONS[r.name];
        if (!wanted) continue;
        const missing = wanted.filter((p) => !r.permissions.includes(p));
        if (!missing.length) continue;
        r.permissions.push(...missing);
        await r.save();
        changed++;
      }
      invalidatePrincipal();
      return `${changed} role(s) updated`;
    },
  },
  {
    id: '002-hospital-catalog-defaults',
    description: 'Store the default configurable lists (appointment types, payment methods, medicine categories, medication reminder start) on the hospital',
    async up(hospitalId) {
      const h = await Hospital.findById(hospitalId);
      if (!h) return 'hospital missing';
      if (h.catalog?.appointmentTypes?.length) return 'already configured';
      h.set('catalog', DEFAULT_CATALOG);
      await h.save();
      return 'defaults stored';
    },
  },
  {
    id: '003-employee-number-counter',
    description: 'Move the never-resetting employee-number counter past existing employees',
    async up(hospitalId) {
      const max = await Employee.find({ hospitalId }).select('employeeNo').lean();
      const highest = max.reduce((m, e) => Math.max(m, Number(/(\d+)$/.exec(e.employeeNo ?? '')?.[1] ?? 0)), 0);
      await ensureCounterAtLeast('employee', 'EMP-{n:5}', hospitalId, highest);
      return `counter ≥ ${highest}`;
    },
  },
];

/** Applies pending migrations to every hospital. Safe to call on every start. */
export async function runMigrations() {
  return runWithContext({ roles: [], permissions: new Set(), system: true, userName: 'Migration' }, async () => {
    const done = new Set((await MigrationRecord.find().select('_id').lean()).map((m) => m._id));
    const hospitals = await Hospital.find({}).select('_id').lean();
    const applied: string[] = [];
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      const results: string[] = [];
      for (const h of hospitals) {
        // Run each hospital's part with that hospital in context so tenant-scoped models work.
        results.push(await runWithContext({ roles: [], permissions: new Set(), hospitalId: h._id, userName: 'Migration' }, () => m.up(h._id)));
      }
      await MigrationRecord.create({ _id: m.id, description: m.description, results });
      logger.info({ migration: m.id, results }, 'Migration applied');
      applied.push(m.id);
    }
    return applied;
  });
}
