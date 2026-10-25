import { Schema, model } from 'mongoose';
import { EMPLOYMENT_TYPES, GENDERS } from '@hms/shared';
import { basePlugin } from '../../core/plugins/base.plugin';

/** Every staff member. Doctor and Nurse profiles reference an employee. Extended by HR in Phase 4. */
const employeeSchema = new Schema({
  employeeNo: { type: String, required: true },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  cnic: String,
  gender: { type: String, enum: GENDERS, required: true },
  dateOfBirth: Date,
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
  designation: { type: String, required: true },
  joiningDate: { type: Date, required: true },
  employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'FullTime' },
  phone: String,
  email: String,
  address: String,
  emergencyContactName: String,
  emergencyContactPhone: String,
  isActive: { type: Boolean, default: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  /** Approves this employee's leave before HR. */
  reportingManagerId: { type: Schema.Types.ObjectId, ref: 'Employee', index: true },
  /** Personal shift; falls back to the hospital's HR policy. */
  shiftStart: String,
  shiftEnd: String,
  exitDate: Date,
  hiredFromCandidateId: { type: Schema.Types.ObjectId, ref: 'Candidate' },
});
employeeSchema.plugin(basePlugin, { softDelete: true });
employeeSchema.index({ hospitalId: 1, employeeNo: 1 }, { unique: true });
employeeSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});
export const Employee = model('Employee', employeeSchema);

const doctorSchema = new Schema({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  name: { type: String, required: true }, // denormalised display name, e.g. "Dr. Ayesha Khan"
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
  specialization: { type: String, required: true },
  qualification: String,
  licenseNumber: { type: String, required: true },
  consultationFee: { type: Number, default: 0, min: 0 },
  followUpFee: { type: Number, default: 0, min: 0 },
  slotMinutes: { type: Number, default: 15, min: 5, max: 120 },
  dutyStart: { type: String, default: '09:00' },
  dutyEnd: { type: String, default: '17:00' },
  /** ISO weekdays 1=Mon .. 7=Sun */
  workingDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
  isAvailable: { type: Boolean, default: true },
});
doctorSchema.plugin(basePlugin, { softDelete: true });
doctorSchema.index({ hospitalId: 1, licenseNumber: 1 }, { unique: true });
export const Doctor = model('Doctor', doctorSchema);

const nurseSchema = new Schema({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  name: { type: String, required: true },
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
  qualification: String,
  licenseNumber: { type: String, required: true },
});
nurseSchema.plugin(basePlugin, { softDelete: true });
nurseSchema.index({ hospitalId: 1, licenseNumber: 1 }, { unique: true });
export const Nurse = model('Nurse', nurseSchema);
