import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ALLERGY_SEVERITIES, BLOOD_GROUPS, CONSENT_METHODS, CONSENT_TYPES, GENDERS } from '@hms/shared';
import { basePlugin } from '../../core/plugins/base.plugin';

const subDocTrail = {
  addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  addedAt: { type: Date, default: () => new Date() },
  removedAt: Date, // soft removal keeps the clinical history intact
  removedBy: { type: Schema.Types.ObjectId, ref: 'User' },
};

const allergySchema = new Schema({
  allergen: { type: String, required: true },
  reaction: String,
  severity: { type: String, enum: ALLERGY_SEVERITIES, default: 'Moderate' },
  ...subDocTrail,
});

const historySchema = new Schema({
  condition: { type: String, required: true },
  diagnosedOn: Date,
  isChronic: { type: Boolean, default: false },
  notes: String,
  ...subDocTrail,
});

const insuranceSchema = new Schema({
  provider: { type: String, required: true },
  policyNumber: { type: String, required: true },
  coveragePercent: { type: Number, default: 100, min: 0, max: 100 },
  coverageLimit: Number,
  expiresOn: Date,
  isPrimary: { type: Boolean, default: true },
  ...subDocTrail,
});

const patientSchema = new Schema({
  mrn: { type: String, required: true },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, trim: true, default: '' },
  /** Lower-cased "first last" for fast prefix search. */
  searchName: { type: String, index: true },
  guardianName: String,
  cnic: String,
  dateOfBirth: { type: Date, required: true },
  gender: { type: String, enum: GENDERS, required: true },
  bloodGroup: { type: String, enum: BLOOD_GROUPS, default: 'Unknown' },
  // Emergency quick-registrations may not have a phone yet.
  phone: { type: String, required: function (this: { isProvisional?: boolean }) { return !this.isProvisional; } },
  email: String,
  address: String,
  city: String,
  emergencyContactName: String,
  emergencyContactRelation: String,
  emergencyContactPhone: String,
  /** Emergency quick-registration still missing full demographics. */
  isProvisional: { type: Boolean, default: false },
  allergies: [allergySchema],
  medicalHistory: [historySchema],
  insurances: [insuranceSchema],
});
patientSchema.plugin(basePlugin, { softDelete: true });
patientSchema.index({ hospitalId: 1, mrn: 1 }, { unique: true });
patientSchema.index(
  { hospitalId: 1, cnic: 1 },
  { unique: true, partialFilterExpression: { cnic: { $type: 'string' }, isDeleted: false } },
);
patientSchema.index({ hospitalId: 1, phone: 1 });
patientSchema.index({ hospitalId: 1, createdAt: -1 });
patientSchema.pre('validate', function (next) {
  this.searchName = `${this.firstName} ${this.lastName}`.toLowerCase();
  next();
});

export const Patient = model('Patient', patientSchema);
export type PatientDoc = HydratedDocument<InferSchemaType<typeof patientSchema>>;

const documentSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  category: { type: String, required: true },
  fileName: { type: String, required: true },
  contentType: { type: String, required: true },
  sizeBytes: { type: Number, required: true },
  storageKey: { type: String, required: true },
  notes: String,
});
documentSchema.plugin(basePlugin, { softDelete: true });
export const PatientDocument = model('PatientDocument', documentSchema);

/**
 * Consent log (append-only). The latest entry per type is the patient's current decision; earlier
 * entries are kept as evidence of what was agreed and when it was withdrawn.
 */
const consentSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  type: { type: String, enum: CONSENT_TYPES, required: true },
  granted: { type: Boolean, required: true },
  method: { type: String, enum: CONSENT_METHODS, required: true },
  note: String,
  recordedByName: String,
  recordedByPatient: { type: Boolean, default: false },
  at: { type: Date, default: () => new Date() },
});
consentSchema.plugin(basePlugin);
consentSchema.index({ hospitalId: 1, patientId: 1, type: 1, at: -1 });
consentSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as never, function () {
  throw new Error('Consent records are append-only');
});
export const PatientConsent = model('PatientConsent', consentSchema);
