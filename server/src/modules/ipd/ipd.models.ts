import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { ADMISSION_SOURCES, ADMISSION_STATUSES, BED_STATUSES, DISCHARGE_TYPES, WARD_TYPES } from '@hms/shared';
import { basePlugin } from '../../core/plugins/base.plugin';

const wardSchema = new Schema({
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: WARD_TYPES, required: true },
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
  floor: String,
  chargePerDay: { type: Number, required: true, min: 0 },
  isActive: { type: Boolean, default: true },
});
wardSchema.plugin(basePlugin);
wardSchema.index({ hospitalId: 1, code: 1 }, { unique: true });
export const Ward = model('Ward', wardSchema);

const roomSchema = new Schema({
  wardId: { type: Schema.Types.ObjectId, ref: 'Ward', required: true, index: true },
  roomNo: { type: String, required: true, trim: true },
  isActive: { type: Boolean, default: true },
});
roomSchema.plugin(basePlugin);
roomSchema.index({ hospitalId: 1, wardId: 1, roomNo: 1 }, { unique: true });
export const Room = model('Room', roomSchema);

const bedSchema = new Schema({
  wardId: { type: Schema.Types.ObjectId, ref: 'Ward', required: true, index: true },
  roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
  bedNo: { type: String, required: true, trim: true },
  /** Overrides the ward daily rate when set. */
  chargePerDay: { type: Number, min: 0 },
  status: { type: String, enum: BED_STATUSES, default: 'Available', index: true },
  currentAdmissionId: { type: Schema.Types.ObjectId, ref: 'Admission' },
  reservedForPatientId: { type: Schema.Types.ObjectId, ref: 'Patient' },
  statusNote: String,
  statusChangedAt: Date,
});
bedSchema.plugin(basePlugin);
bedSchema.index({ hospitalId: 1, roomId: 1, bedNo: 1 }, { unique: true });
export const Bed = model('Bed', bedSchema);
export type BedDoc = HydratedDocument<InferSchemaType<typeof bedSchema>>;

/** Each bed the patient occupied; the open segment has no `to`. Drives bed-day billing. */
const bedStaySchema = new Schema(
  {
    bedId: { type: Schema.Types.ObjectId, ref: 'Bed', required: true },
    wardId: { type: Schema.Types.ObjectId, ref: 'Ward', required: true },
    wardName: String,
    roomNo: String,
    bedNo: String,
    ratePerDay: { type: Number, required: true },
    from: { type: Date, required: true },
    to: Date,
    reason: String,
  },
  { _id: false },
);

const ipdNoteSchema = new Schema({
  at: { type: Date, default: () => new Date() },
  kind: { type: String, enum: ['Progress', 'Nursing', 'Event'], required: true },
  text: { type: String, required: true },
  authorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  authorName: String,
  authorRole: String,
});

/** The Admissions and Discharges tables: discharge details live on the admission they close. */
const admissionSchema = new Schema({
  admissionNo: { type: String, required: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  visitId: { type: Schema.Types.ObjectId, ref: 'Visit', required: true },
  source: { type: String, enum: ADMISSION_SOURCES, default: 'Direct' },
  emergencyCaseId: { type: Schema.Types.ObjectId, ref: 'EmergencyCase' },
  attendingDoctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
  attendingDoctorName: String,
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
  assignedNurseId: { type: Schema.Types.ObjectId, ref: 'Nurse' },
  assignedNurseName: String,
  bedId: { type: Schema.Types.ObjectId, ref: 'Bed' },
  wardId: { type: Schema.Types.ObjectId, ref: 'Ward' },
  stays: [bedStaySchema],
  reason: { type: String, required: true },
  provisionalDiagnosis: String,
  admittedAt: { type: Date, default: () => new Date() },
  expectedDischargeAt: Date,
  status: { type: String, enum: ADMISSION_STATUSES, default: 'Admitted', index: true },
  notes: [ipdNoteSchema],
  discharge: {
    at: Date,
    type: { type: String, enum: DISCHARGE_TYPES },
    finalDiagnosis: String,
    treatmentGiven: String,
    conditionAtDischarge: String,
    medications: String,
    instructions: String,
    followUpDate: Date,
    byName: String,
  },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
});
admissionSchema.plugin(basePlugin);
admissionSchema.index({ hospitalId: 1, admissionNo: 1 }, { unique: true });
admissionSchema.index({ hospitalId: 1, status: 1, admittedAt: -1 });
// A patient can only hold one active admission at a time.
admissionSchema.index({ hospitalId: 1, patientId: 1 }, { unique: true, partialFilterExpression: { status: 'Admitted' } });
export const Admission = model('Admission', admissionSchema);
export type AdmissionDoc = HydratedDocument<InferSchemaType<typeof admissionSchema>>;
