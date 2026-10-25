import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { INVOICE_SOURCES, INVOICE_STATUSES, PAYMENT_METHODS } from '@hms/shared';
import { basePlugin } from '../../core/plugins/base.plugin';

const lineSchema = new Schema({
  serviceId: { type: Schema.Types.ObjectId, ref: 'Service' },
  description: { type: String, required: true },
  quantity: { type: Number, required: true, min: 0 },
  unitPrice: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0 },
  taxRate: { type: Number, default: 0, min: 0 },
  tax: { type: Number, default: 0, min: 0 },
  total: { type: Number, required: true, min: 0 },
  /** Origin of an automatic charge (e.g. prescription id) to prevent double billing. */
  sourceRef: String,
});

const invoiceSchema = new Schema({
  invoiceNo: { type: String, required: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  mrn: { type: String, required: true },
  patientName: { type: String, required: true },
  visitId: { type: Schema.Types.ObjectId, ref: 'Visit' },
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
  source: { type: String, enum: INVOICE_SOURCES, required: true, index: true },
  status: { type: String, enum: INVOICE_STATUSES, default: 'Draft', index: true },
  items: [lineSchema],
  subtotal: { type: Number, default: 0 },
  discountTotal: { type: Number, default: 0 },
  taxTotal: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  paid: { type: Number, default: 0 },
  refunded: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
  issuedAt: Date,
  dueDate: Date,
  notes: String,
  cancelReason: String,
  /** Overdue-balance follow-up: reminders sent and when (max 3, a week apart). */
  paymentReminders: { type: Number, default: 0 },
  lastPaymentReminderAt: Date,
});
invoiceSchema.plugin(basePlugin);
invoiceSchema.index({ hospitalId: 1, invoiceNo: 1 }, { unique: true });
invoiceSchema.index({ hospitalId: 1, issuedAt: -1 });
invoiceSchema.index({ hospitalId: 1, balance: 1 });
export const Invoice = model('Invoice', invoiceSchema);
export type InvoiceDoc = HydratedDocument<InferSchemaType<typeof invoiceSchema>>;

const paymentSchema = new Schema({
  receiptNo: { type: String, required: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  amount: { type: Number, required: true, min: 0.01 },
  method: { type: String, enum: PAYMENT_METHODS, required: true },
  reference: String,
  notes: String,
  receivedAt: { type: Date, default: () => new Date() },
  receivedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  receivedByName: String,
  refunded: { type: Number, default: 0 },
});
paymentSchema.plugin(basePlugin);
paymentSchema.index({ hospitalId: 1, receiptNo: 1 }, { unique: true });
paymentSchema.index({ hospitalId: 1, receivedAt: -1 });
export const Payment = model('Payment', paymentSchema);

const refundSchema = new Schema({
  refundNo: { type: String, required: true },
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  amount: { type: Number, required: true, min: 0.01 },
  reason: { type: String, required: true },
  processedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  processedAt: { type: Date, default: () => new Date() },
});
refundSchema.plugin(basePlugin);
refundSchema.index({ hospitalId: 1, refundNo: 1 }, { unique: true });
export const Refund = model('Refund', refundSchema);
