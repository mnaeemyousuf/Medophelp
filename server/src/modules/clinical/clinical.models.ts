import { Schema, model } from 'mongoose';
import { DIAGNOSIS_TYPES, MEDICINE_ROUTES, NOTE_TYPES, PRESCRIPTION_STATUSES } from '@hms/shared';
import { basePlugin, softDeleteFields } from '../../core/plugins/base.plugin';

/** Vital signs are append-only; a correction is a new reading. */
const vitalSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  visitId: { type: Schema.Types.ObjectId, ref: 'Visit' },
  systolicBp: Number,
  diastolicBp: Number,
  heartRate: Number,
  temperatureC: Number,
  spo2: Number,
  respiratoryRate: Number,
  weightKg: Number,
  heightCm: Number,
  bmi: Number,
  painScale: Number,
  flags: [String],
  recordedAt: { type: Date, default: () => new Date() },
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  recordedByName: String,
});
vitalSchema.plugin(basePlugin);
vitalSchema.index({ hospitalId: 1, patientId: 1, recordedAt: -1 });
export const VitalSign = model('VitalSign', vitalSchema);

const assessmentSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  visitId: { type: Schema.Types.ObjectId, ref: 'Visit', required: true },
  appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true, unique: true },
  vitalSignId: { type: Schema.Types.ObjectId, ref: 'VitalSign', required: true },
  symptoms: String,
  notes: String,
  nurseUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  nurseName: String,
  submittedAt: { type: Date, default: () => new Date() },
});
assessmentSchema.plugin(basePlugin);
export const NursingAssessment = model('NursingAssessment', assessmentSchema);

/** Doctor-authored notes. Only the author can amend; amendments are audited with before/after. */
const clinicalNoteSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  visitId: { type: Schema.Types.ObjectId, ref: 'Visit', required: true, index: true },
  type: { type: String, enum: NOTE_TYPES, required: true },
  chiefComplaint: String,
  content: { type: String, required: true },
  authorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  authorName: String,
  authorRole: { type: String, required: true },
  /**
   * Earlier versions, oldest first. Amendments never overwrite silently: the previous text, who wrote
   * it and when are kept here (and in the audit log) and shown in the EMR.
   */
  versions: [
    new Schema({ chiefComplaint: String, content: String, savedAt: Date, byName: String, reason: String }, { _id: false }),
  ],
  amendedAt: Date,
  amendmentReason: String,
});
clinicalNoteSchema.plugin(basePlugin, { softDelete: true });
clinicalNoteSchema.index({ hospitalId: 1, patientId: 1, createdAt: -1 });
export const ClinicalNote = model('ClinicalNote', clinicalNoteSchema);

const diagnosisSchema = new Schema({
  ...softDeleteFields,
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  visitId: { type: Schema.Types.ObjectId, ref: 'Visit', required: true, index: true },
  icdCode: String,
  description: { type: String, required: true },
  type: { type: String, enum: DIAGNOSIS_TYPES, default: 'Provisional' },
  doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
  doctorName: String,
});
diagnosisSchema.plugin(basePlugin, { softDelete: true });
diagnosisSchema.index({ hospitalId: 1, patientId: 1, createdAt: -1 });
export const Diagnosis = model('Diagnosis', diagnosisSchema);

const treatmentPlanSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  visitId: { type: Schema.Types.ObjectId, ref: 'Visit', required: true, unique: true },
  plan: { type: String, required: true },
  followUpDate: Date,
  doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
});
treatmentPlanSchema.plugin(basePlugin);
export const TreatmentPlan = model('TreatmentPlan', treatmentPlanSchema);

const prescriptionItemSchema = new Schema({
  medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine' },
  medicineName: { type: String, required: true },
  dosage: { type: String, required: true },
  frequency: { type: String, required: true },
  timesPerDay: { type: Number, required: true, min: 0 },
  route: { type: String, enum: MEDICINE_ROUTES, default: 'Oral' },
  durationDays: { type: Number, required: true, min: 1 },
  quantity: { type: Number, required: true, min: 0 },
  instructions: String,
  dispensedQuantity: { type: Number, default: 0, min: 0 },
});

const prescriptionSchema = new Schema({
  prescriptionNo: { type: String, required: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  visitId: { type: Schema.Types.ObjectId, ref: 'Visit', required: true },
  doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
  doctorName: String,
  prescribedAt: { type: Date, default: () => new Date() },
  status: { type: String, enum: PRESCRIPTION_STATUSES, default: 'Active', index: true },
  notes: String,
  cancelReason: String,
  items: { type: [prescriptionItemSchema], validate: (v: unknown[]) => v.length > 0 },
});
prescriptionSchema.plugin(basePlugin);
prescriptionSchema.index({ hospitalId: 1, prescriptionNo: 1 }, { unique: true });
export const Prescription = model('Prescription', prescriptionSchema);
