import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { ARRIVAL_MODES, ER_DISPOSITIONS, ER_STATUSES, TRIAGE_LEVELS } from '@hms/shared';
import { basePlugin } from '../../core/plugins/base.plugin';

/** One triage assessment. Re-triage appends a new record (the TriageRecords table). */
const triageSchema = new Schema(
  {
    level: { type: String, enum: TRIAGE_LEVELS, required: true },
    rank: { type: Number, required: true },
    notes: String,
    vitalSignId: { type: Schema.Types.ObjectId, ref: 'VitalSign' },
    at: { type: Date, default: () => new Date() },
    byName: String,
  },
  { _id: false },
);

const eventSchema = new Schema(
  {
    at: { type: Date, default: () => new Date() },
    kind: { type: String, required: true }, // registered | triage | assigned | note | status | disposition
    text: { type: String, required: true },
    byName: String,
  },
  { _id: false },
);

const emergencyCaseSchema = new Schema({
  caseNo: { type: String, required: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  visitId: { type: Schema.Types.ObjectId, ref: 'Visit', required: true },
  arrivalAt: { type: Date, default: () => new Date() },
  arrivalMode: { type: String, enum: ARRIVAL_MODES, default: 'Walk-in' },
  presentingComplaint: { type: String, required: true },
  status: { type: String, enum: ER_STATUSES, default: 'Registered', index: true },
  /** Current triage, denormalised for sorting the board; full history in `triage`. */
  triageLevel: { type: String, enum: TRIAGE_LEVELS },
  triageRank: { type: Number, default: 9 },
  triage: [triageSchema],
  assignedDoctorId: { type: Schema.Types.ObjectId, ref: 'Doctor' },
  assignedDoctorName: String,
  treatmentStartedAt: Date,
  disposition: {
    type: { type: String, enum: ER_DISPOSITIONS },
    at: Date,
    notes: String,
    referredTo: String,
    admissionId: { type: Schema.Types.ObjectId, ref: 'Admission' },
    byName: String,
  },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  events: [eventSchema],
});
emergencyCaseSchema.plugin(basePlugin);
emergencyCaseSchema.index({ hospitalId: 1, caseNo: 1 }, { unique: true });
emergencyCaseSchema.index({ hospitalId: 1, status: 1, triageRank: 1, arrivalAt: 1 });
emergencyCaseSchema.index({ hospitalId: 1, arrivalAt: -1 });
export const EmergencyCase = model('EmergencyCase', emergencyCaseSchema);
export type EmergencyCaseDoc = HydratedDocument<InferSchemaType<typeof emergencyCaseSchema>>;

export const ACTIVE_ER_STATUSES = ['Registered', 'Triaged', 'InTreatment'] as const;
