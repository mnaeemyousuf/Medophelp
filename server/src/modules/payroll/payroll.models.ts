import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { PAYROLL_STATUSES } from '@hms/shared';
import { actorFields, basePlugin } from '../../core/plugins/base.plugin';

const lineSchema = new Schema({ name: { type: String, required: true }, amount: { type: Number, required: true, min: 0 } }, { _id: false });

/** Versioned by `effectiveFrom`: payroll uses the latest structure effective on the period's first day. */
const salaryStructureSchema = new Schema({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  effectiveFrom: { type: Date, required: true },
  basic: { type: Number, required: true, min: 0 },
  allowances: [lineSchema],
  deductions: [lineSchema],
  taxPercent: { type: Number, default: 0, min: 0, max: 50 },
  overtimeRatePerHour: { type: Number, min: 0 },
  bankName: String,
  bankAccount: String,
});
salaryStructureSchema.plugin(basePlugin);
salaryStructureSchema.index({ hospitalId: 1, employeeId: 1, effectiveFrom: -1 });
export const SalaryStructure = model('SalaryStructure', salaryStructureSchema);

const payrollRunSchema = new Schema({
  ...actorFields,
  runNo: { type: String, required: true },
  period: { type: String, required: true }, // YYYY-MM
  status: { type: String, enum: PAYROLL_STATUSES, default: 'Draft', index: true },
  workingDays: { type: Number, required: true },
  employees: { type: Number, default: 0 },
  totals: {
    gross: { type: Number, default: 0 },
    deductions: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    net: { type: Number, default: 0 },
  },
  preparedByName: String,
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  approvedByName: String,
  approvedAt: Date,
  processedAt: Date,
  history: [{ _id: false, status: String, at: { type: Date, default: () => new Date() }, byName: String, note: String }],
  /** Live runs only; backs the one-payroll-per-period rule. */
  isLive: { type: Boolean, default: true },
});
payrollRunSchema.plugin(basePlugin);
payrollRunSchema.index({ hospitalId: 1, runNo: 1 }, { unique: true });
payrollRunSchema.index({ hospitalId: 1, period: 1 }, { unique: true, partialFilterExpression: { isLive: true } });
payrollRunSchema.pre('validate', function (next) {
  this.isLive = this.status !== 'Cancelled';
  next();
});
export const PayrollRun = model('PayrollRun', payrollRunSchema);
export type PayrollRunDoc = HydratedDocument<InferSchemaType<typeof payrollRunSchema>>;

/** One employee's pay for a run (PayrollItems). Inputs are snapshotted so later changes don't rewrite history. */
const payrollItemSchema = new Schema({
  runId: { type: Schema.Types.ObjectId, ref: 'PayrollRun', required: true, index: true },
  period: { type: String, required: true },
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  employeeNo: String,
  employeeName: String,
  designation: String,
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
  departmentName: String,
  bankName: String,
  bankAccount: String,
  basic: Number,
  allowances: [lineSchema],
  deductions: [lineSchema],
  taxPercent: Number,
  overtimeRatePerHour: Number,
  workingDays: Number,
  presentDays: Number,
  absentDays: Number,
  unpaidLeaveDays: Number,
  paidLeaveDays: Number,
  overtimeHours: Number,
  bonus: { type: Number, default: 0 },
  otherDeduction: { type: Number, default: 0 },
  adjustmentNote: String,
  // computed
  allowanceTotal: Number,
  overtimePay: Number,
  gross: Number,
  unpaidLeaveDeduction: Number,
  absenceDeduction: Number,
  tax: Number,
  totalDeductions: Number,
  net: Number,
});
payrollItemSchema.plugin(basePlugin);
payrollItemSchema.index({ hospitalId: 1, runId: 1, employeeId: 1 }, { unique: true });
export const PayrollItem = model('PayrollItem', payrollItemSchema);
export type PayrollItemDoc = HydratedDocument<InferSchemaType<typeof payrollItemSchema>>;

/** Issued when a run is processed; immutable record the employee can download. */
const payslipSchema = new Schema({
  payslipNo: { type: String, required: true },
  runId: { type: Schema.Types.ObjectId, ref: 'PayrollRun', required: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'PayrollItem', required: true },
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  period: { type: String, required: true },
  gross: Number,
  totalDeductions: Number,
  net: Number,
  issuedAt: { type: Date, default: () => new Date() },
});
payslipSchema.plugin(basePlugin);
payslipSchema.index({ hospitalId: 1, payslipNo: 1 }, { unique: true });
payslipSchema.index({ hospitalId: 1, employeeId: 1, period: 1 }, { unique: true });
export const Payslip = model('Payslip', payslipSchema);
