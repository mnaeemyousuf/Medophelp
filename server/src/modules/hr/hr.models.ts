import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { ATTENDANCE_STATUSES, CONTRACT_STATUSES, EMPLOYMENT_TYPES, LEAVE_STATUSES, LEAVE_TYPES, REVIEW_STATUSES } from '@hms/shared';
import { basePlugin } from '../../core/plugins/base.plugin';

const contractSchema = new Schema({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  contractNo: { type: String, required: true },
  type: { type: String, enum: EMPLOYMENT_TYPES, required: true },
  startDate: { type: Date, required: true },
  endDate: Date,
  basicSalary: { type: Number, required: true, min: 0 },
  noticePeriodDays: { type: Number, default: 30 },
  probationMonths: { type: Number, default: 3 },
  terms: String,
  status: { type: String, enum: CONTRACT_STATUSES, default: 'Active' },
  terminatedAt: Date,
  terminationReason: String,
});
contractSchema.plugin(basePlugin);
contractSchema.index({ hospitalId: 1, contractNo: 1 }, { unique: true });
export const Contract = model('Contract', contractSchema);

const performanceReviewSchema = new Schema({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  period: { type: String, required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  goals: String,
  strengths: String,
  improvements: String,
  reviewerName: String,
  reviewerUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: REVIEW_STATUSES, default: 'Draft' },
  submittedAt: Date,
  acknowledgedAt: Date,
  employeeComment: String,
});
performanceReviewSchema.plugin(basePlugin);
performanceReviewSchema.index({ hospitalId: 1, employeeId: 1, period: 1 }, { unique: true });
export const PerformanceReview = model('PerformanceReview', performanceReviewSchema);

/** One row per employee per calendar day. Times stored as instants; `date` is the local calendar day. */
const attendanceSchema = new Schema({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
  date: { type: String, required: true }, // YYYY-MM-DD
  clockIn: Date,
  clockOut: Date,
  status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
  lateMinutes: { type: Number, default: 0 },
  earlyLeaveMinutes: { type: Number, default: 0 },
  workedMinutes: { type: Number, default: 0 },
  overtimeMinutes: { type: Number, default: 0 },
  source: { type: String, enum: ['Self', 'Manual', 'System'], default: 'Self' },
  leaveRequestId: { type: Schema.Types.ObjectId, ref: 'LeaveRequest' },
  note: String,
});
attendanceSchema.plugin(basePlugin);
attendanceSchema.index({ hospitalId: 1, employeeId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ hospitalId: 1, date: 1, status: 1 });
export const Attendance = model('Attendance', attendanceSchema);
export type AttendanceDoc = HydratedDocument<InferSchemaType<typeof attendanceSchema>>;

const decisionSchema = new Schema({ byName: String, byUserId: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date, approve: Boolean, note: String }, { _id: false });

const leaveRequestSchema = new Schema({
  requestNo: { type: String, required: true },
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  employeeName: String,
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
  managerId: { type: Schema.Types.ObjectId, ref: 'Employee', index: true },
  type: { type: String, enum: LEAVE_TYPES, required: true },
  from: { type: String, required: true },
  to: { type: String, required: true },
  halfDay: { type: Boolean, default: false },
  days: { type: Number, required: true, min: 0.5 },
  reason: { type: String, required: true },
  status: { type: String, enum: LEAVE_STATUSES, required: true, index: true },
  managerDecision: decisionSchema,
  hrDecision: decisionSchema,
  cancelledAt: Date,
  cancelledByName: String,
});
leaveRequestSchema.plugin(basePlugin);
leaveRequestSchema.index({ hospitalId: 1, requestNo: 1 }, { unique: true });
leaveRequestSchema.index({ hospitalId: 1, employeeId: 1, from: 1, to: 1 });
export const LeaveRequest = model('LeaveRequest', leaveRequestSchema);
export type LeaveRequestDoc = HydratedDocument<InferSchemaType<typeof leaveRequestSchema>>;

/** Entitlement and usage per employee, year and leave type. `pending` reserves days awaiting approval. */
const leaveBalanceSchema = new Schema({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  year: { type: Number, required: true },
  type: { type: String, enum: LEAVE_TYPES, required: true },
  entitled: { type: Number, required: true, min: 0 },
  used: { type: Number, default: 0, min: 0 },
  pending: { type: Number, default: 0, min: 0 },
});
leaveBalanceSchema.plugin(basePlugin);
leaveBalanceSchema.index({ hospitalId: 1, employeeId: 1, year: 1, type: 1 }, { unique: true });
export const LeaveBalance = model('LeaveBalance', leaveBalanceSchema);
