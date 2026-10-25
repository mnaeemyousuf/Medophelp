import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { basePlugin, softDeleteFields, tenantField } from '../../core/plugins/base.plugin';

/**
 * Roles embed their permission codes (the catalogue lives in @hms/shared). This is the document
 * equivalent of the Roles / Permissions / RolePermissions tables.
 */
const roleSchema = new Schema({
  name: { type: String, required: true, trim: true },
  description: String,
  permissions: { type: [String], default: [] },
  /** Seeded roles cannot be deleted or renamed. */
  isSystem: { type: Boolean, default: false },
});
roleSchema.plugin(basePlugin);
roleSchema.index({ hospitalId: 1, name: 1 }, { unique: true });
export const Role = model('Role', roleSchema);

const userSchema = new Schema({
  ...tenantField,
  ...softDeleteFields,
  email: { type: String, required: true, lowercase: true, trim: true },
  fullName: { type: String, required: true, trim: true },
  phone: String,
  passwordHash: { type: String, required: true, select: false },
  roleIds: [{ type: Schema.Types.ObjectId, ref: 'Role' }],
  isActive: { type: Boolean, default: true },
  mustChangePassword: { type: Boolean, default: false },
  failedLoginCount: { type: Number, default: 0 },
  lockoutEndsAt: Date,
  lastLoginAt: Date,
  passwordChangedAt: { type: Date, default: () => new Date() },
  // MFA-ready: when enabled, login returns a challenge instead of a session.
  mfaEnabled: { type: Boolean, default: false },
  mfaSecret: { type: String, select: false },
  /** Patient-portal users are bound to exactly one patient record. */
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient' },
});
userSchema.plugin(basePlugin, { softDelete: true });
// Email is globally unique so login can resolve the hospital from the account.
userSchema.index({ email: 1 }, { unique: true });
export const User = model('User', userSchema);
export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;

const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    replacedByHash: String,
    ip: String,
    userAgent: String,
    rememberMe: Boolean,
  },
  { timestamps: true },
);
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // purge 30 days after expiry
export const RefreshToken = model('RefreshToken', refreshTokenSchema);

const passwordResetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { timestamps: true },
);
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });
export const PasswordResetToken = model('PasswordResetToken', passwordResetSchema);
