import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { LAB_ORDER_STATUSES, LAB_PRIORITIES, RESULT_FLAGS, SAMPLE_TYPES } from '@hms/shared';
import { basePlugin, softDeleteFields } from '../../core/plugins/base.plugin';

const parameterSchema = new Schema(
  {
    name: { type: String, required: true },
    unit: String,
    type: { type: String, enum: ['numeric', 'text'], default: 'numeric' },
    refLow: Number,
    refHigh: Number,
    criticalLow: Number,
    criticalHigh: Number,
    refText: String,
  },
  { _id: false },
);

/** Lab test master: what can be ordered, its price, sample and result parameters. */
const labTestSchema = new Schema({
  ...softDeleteFields,
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, required: true },
  sampleType: { type: String, enum: SAMPLE_TYPES, required: true },
  price: { type: Number, required: true, min: 0 },
  turnaroundHours: { type: Number, default: 24 },
  parameters: { type: [parameterSchema], validate: (v: unknown[]) => v.length > 0 },
  isActive: { type: Boolean, default: true },
});
labTestSchema.plugin(basePlugin, { softDelete: true });
labTestSchema.index({ hospitalId: 1, code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
export const LabTest = model('LabTest', labTestSchema);

const resultSchema = new Schema(
  {
    parameter: { type: String, required: true },
    value: { type: String, required: true },
    unit: String,
    refRange: String,
    flag: { type: String, enum: RESULT_FLAGS, default: 'N' },
  },
  { _id: false },
);

const orderItemSchema = new Schema({
  testId: { type: Schema.Types.ObjectId, ref: 'LabTest', required: true },
  testCode: String,
  testName: { type: String, required: true },
  sampleType: String,
  price: { type: Number, required: true },
  results: [resultSchema],
});

const historySchema = new Schema(
  {
    status: { type: String, enum: LAB_ORDER_STATUSES, required: true },
    at: { type: Date, default: () => new Date() },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    note: String,
  },
  { _id: false },
);

/**
 * One lab request (the LabOrders + LabOrderItems + LabResults tables as one document): tests,
 * sample, results per parameter, verification and doctor review. The report is rendered from it.
 */
const labOrderSchema = new Schema({
  orderNo: { type: String, required: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  visitId: { type: Schema.Types.ObjectId, ref: 'Visit' },
  doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor' },
  doctorName: String,
  priority: { type: String, enum: LAB_PRIORITIES, default: 'Routine' },
  status: { type: String, enum: LAB_ORDER_STATUSES, default: 'Ordered', index: true },
  clinicalNotes: String,
  items: { type: [orderItemSchema], validate: (v: unknown[]) => v.length > 0 },
  sample: {
    type: { type: String },
    barcode: String,
    collectedAt: Date,
    collectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    collectedByName: String,
    notes: String,
  },
  technicianId: { type: Schema.Types.ObjectId, ref: 'User' },
  technicianName: String,
  startedAt: Date,
  resultsEnteredAt: Date,
  comments: String,
  verifiedAt: Date,
  verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  verifiedByName: String,
  reviewedAt: Date,
  reviewedByName: String,
  /** Abnormal/critical summary for queues and alerts. */
  hasAbnormal: { type: Boolean, default: false },
  hasCritical: { type: Boolean, default: false },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  cancelReason: String,
  /** Externally produced reports or instrument printouts uploaded by the lab (PDF/PNG/JPEG). */
  attachments: [
    new Schema(
      { fileName: { type: String, required: true }, contentType: String, sizeBytes: Number, storageKey: { type: String, required: true }, description: String, uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' }, uploadedByName: String, at: { type: Date, default: () => new Date() } },
    ),
  ],
  assignedByName: String,
  assignedAt: Date,
  history: [historySchema],
});
labOrderSchema.plugin(basePlugin);
labOrderSchema.index({ hospitalId: 1, orderNo: 1 }, { unique: true });
labOrderSchema.index({ hospitalId: 1, status: 1, createdAt: -1 });
labOrderSchema.index({ hospitalId: 1, doctorId: 1, status: 1 });
export const LabOrder = model('LabOrder', labOrderSchema);
export type LabOrderDoc = HydratedDocument<InferSchemaType<typeof labOrderSchema>>;
