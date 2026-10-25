import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { APPOINTMENT_STATUSES, VISIT_TYPES } from '@hms/shared';
import { basePlugin } from '../../core/plugins/base.plugin';

const statusEventSchema = new Schema(
  {
    status: { type: String, enum: APPOINTMENT_STATUSES, required: true },
    at: { type: Date, default: () => new Date() },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    note: String,
  },
  { _id: false },
);

const appointmentSchema = new Schema({
  appointmentNo: { type: String, required: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
  /** Calendar date at local midnight UTC, plus HH:mm strings — avoids time-zone drift on dates. */
  date: { type: Date, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  /** Code from the hospital's configured appointment types (catalog.appointmentTypes). */
  type: { type: String, default: 'New' },
  status: { type: String, enum: APPOINTMENT_STATUSES, default: 'Scheduled', index: true },
  reason: String,
  cancellationReason: String,
  rescheduleCount: { type: Number, default: 0 },
  tokenNumber: Number,
  checkedInAt: Date,
  /** Set when the 24-hour reminder has been sent, so it goes out once. */
  reminderSentAt: Date,
  consultationStartedAt: Date,
  completedAt: Date,
  visitId: { type: Schema.Types.ObjectId, ref: 'Visit' },
  history: [statusEventSchema],
});
appointmentSchema.plugin(basePlugin);
appointmentSchema.index({ hospitalId: 1, appointmentNo: 1 }, { unique: true });
appointmentSchema.index({ hospitalId: 1, doctorId: 1, date: 1, startTime: 1 });
appointmentSchema.index({ hospitalId: 1, date: 1, status: 1 });
export const Appointment = model('Appointment', appointmentSchema);
export type AppointmentDoc = HydratedDocument<InferSchemaType<typeof appointmentSchema>>;

/**
 * Prevents two active appointments in the same doctor slot even under concurrent requests:
 * a unique key "doctorId|date|startTime" exists only while the appointment holds the slot.
 */
const slotLockSchema = new Schema(
  {
    hospitalId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true },
    appointmentId: { type: Schema.Types.ObjectId, required: true },
  },
  { versionKey: false },
);
slotLockSchema.index({ hospitalId: 1, key: 1 }, { unique: true });
export const SlotLock = model('SlotLock', slotLockSchema);

/** One clinical encounter. Vitals, notes, diagnoses and prescriptions hang off a visit. */
const visitSchema = new Schema({
  visitNo: { type: String, required: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', index: true },
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
  appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
  type: { type: String, enum: VISIT_TYPES, default: 'OPD' },
  status: { type: String, enum: ['Open', 'Closed'], default: 'Open' },
  startedAt: { type: Date, default: () => new Date() },
  endedAt: Date,
  chiefComplaint: String,
  followUpDate: Date,
});
visitSchema.plugin(basePlugin);
visitSchema.index({ hospitalId: 1, visitNo: 1 }, { unique: true });
export const Visit = model('Visit', visitSchema);
