import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { DOSE_STATUSES, MEDICATION_SCHEDULE_STATUSES } from '@hms/shared';
import { basePlugin, tenantField } from '../../core/plugins/base.plugin';

/** One reminder schedule per dispensed prescription line. */
const medicationScheduleSchema = new Schema({
  ...tenantField,
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  prescriptionId: { type: Schema.Types.ObjectId, ref: 'Prescription', required: true },
  prescriptionNo: { type: String, required: true },
  prescriptionItemId: { type: Schema.Types.ObjectId, required: true },
  doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor' },
  doctorName: String,
  medicineName: { type: String, required: true },
  dosage: { type: String, required: true },
  route: String,
  instructions: String,
  timesPerDay: { type: Number, required: true, min: 1 },
  durationDays: { type: Number, required: true, min: 1 },
  times: { type: [String], required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  totalDoses: { type: Number, required: true },
  chronic: { type: Boolean, default: false },
  status: { type: String, enum: MEDICATION_SCHEDULE_STATUSES, default: 'Active', index: true },
  stoppedReason: String,
  stoppedByName: String,
  refillReminderSentAt: Date,
  followUpReminderSentAt: Date,
  lastMissedAlertAt: Date,
});
medicationScheduleSchema.plugin(basePlugin);
medicationScheduleSchema.index({ hospitalId: 1, prescriptionItemId: 1 }, { unique: true });
export const MedicationSchedule = model('MedicationSchedule', medicationScheduleSchema);
export type MedicationScheduleDoc = HydratedDocument<InferSchemaType<typeof medicationScheduleSchema>>;

const medicationDoseSchema = new Schema({
  ...tenantField,
  scheduleId: { type: Schema.Types.ObjectId, ref: 'MedicationSchedule', required: true, index: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  medicineName: { type: String, required: true },
  dosage: String,
  scheduledAt: { type: Date, required: true },
  status: { type: String, enum: DOSE_STATUSES, default: 'Pending' },
  remindedAt: Date,
  recordedAt: Date,
  recordedByName: String,
  recordedBy: { type: String, enum: ['Patient', 'Staff', 'System'] },
  note: String,
});
medicationDoseSchema.plugin(basePlugin);
medicationDoseSchema.index({ hospitalId: 1, status: 1, scheduledAt: 1 });
medicationDoseSchema.index({ hospitalId: 1, patientId: 1, scheduledAt: 1 });
export const MedicationDose = model('MedicationDose', medicationDoseSchema);
