import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { CLAIM_STATUSES } from '@hms/shared';
import { basePlugin } from '../../core/plugins/base.plugin';

const claimHistorySchema = new Schema(
  { status: { type: String, enum: CLAIM_STATUSES }, at: { type: Date, default: () => new Date() }, byName: String, note: String },
  { _id: false },
);

const insuranceClaimSchema = new Schema({
  claimNo: { type: String, required: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  patientName: String,
  mrn: String,
  invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
  invoiceNo: String,
  invoiceTotal: Number,
  /** Policy snapshot at the time of the claim. */
  insuranceId: { type: Schema.Types.ObjectId, required: true },
  provider: { type: String, required: true, index: true },
  policyNumber: { type: String, required: true },
  coveragePercent: Number,
  coverageLimit: Number,
  policyExpiresOn: Date,
  claimAmount: { type: Number, required: true, min: 0.01 },
  approvedAmount: { type: Number, default: 0, min: 0 },
  rejectedAmount: { type: Number, default: 0, min: 0 },
  paidAmount: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: CLAIM_STATUSES, default: 'Draft', index: true },
  submittedAt: Date,
  decidedAt: Date,
  paidAt: Date,
  payerReference: String,
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment' },
  notes: String,
  history: [claimHistorySchema],
  /** False once rejected; backs the one-live-claim-per-invoice index. */
  isLive: { type: Boolean, default: true },
});
insuranceClaimSchema.plugin(basePlugin);
insuranceClaimSchema.index({ hospitalId: 1, claimNo: 1 }, { unique: true });
insuranceClaimSchema.index({ hospitalId: 1, invoiceId: 1 }, { unique: true, partialFilterExpression: { isLive: true } });
insuranceClaimSchema.pre('validate', function (next) {
  this.isLive = this.status !== 'Rejected';
  next();
});
export const InsuranceClaim = model('InsuranceClaim', insuranceClaimSchema);
export type InsuranceClaimDoc = HydratedDocument<InferSchemaType<typeof insuranceClaimSchema>>;
