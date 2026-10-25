import { Schema, model } from 'mongoose';
import { basePlugin } from '../../core/plugins/base.plugin';

const allocationSchema = new Schema(
  {
    batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
    batchNo: String,
    expiryDate: Date,
    quantity: { type: Number, required: true },
  },
  { _id: false },
);

const dispenseLineSchema = new Schema(
  {
    prescriptionItemId: { type: Schema.Types.ObjectId, required: true },
    itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
    itemName: String,
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true },
    total: { type: Number, required: true },
    isControlled: Boolean,
    allocations: [allocationSchema],
  },
  { _id: false },
);

/** One dispensing event against a prescription (dispensing history). */
const dispenseSchema = new Schema({
  dispenseNo: { type: String, required: true },
  prescriptionId: { type: Schema.Types.ObjectId, ref: 'Prescription', required: true, index: true },
  prescriptionNo: String,
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  patientName: String,
  mrn: String,
  lines: [dispenseLineSchema],
  total: { type: Number, required: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  witnessName: String,
  notes: String,
  dispensedByName: String,
  dispensedAt: { type: Date, default: () => new Date() },
});
dispenseSchema.plugin(basePlugin);
dispenseSchema.index({ hospitalId: 1, dispenseNo: 1 }, { unique: true });
dispenseSchema.index({ hospitalId: 1, dispensedAt: -1 });
export const Dispense = model('Dispense', dispenseSchema);

/** Controlled-substance register: one row per controlled line dispensed, with witness. */
const controlledLogSchema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  itemName: String,
  batchNo: String,
  quantity: { type: Number, required: true },
  balanceAfter: Number,
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient' },
  patientName: String,
  mrn: String,
  prescriptionNo: String,
  prescriberName: String,
  dispenseId: { type: Schema.Types.ObjectId, ref: 'Dispense' },
  dispensedByName: String,
  witnessName: { type: String, required: true },
  at: { type: Date, default: () => new Date() },
});
controlledLogSchema.plugin(basePlugin);
controlledLogSchema.index({ hospitalId: 1, at: -1 });
export const ControlledDrugLog = model('ControlledDrugLog', controlledLogSchema);
