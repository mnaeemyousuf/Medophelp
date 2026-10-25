import { z } from 'zod';
import {
  ATTENDANCE_STATUSES,
  CANDIDATE_SOURCES,
  CANDIDATE_STAGES,
  EMPLOYMENT_TYPES,
  GENDERS,
  INTERVIEW_MODES,
  JOB_STATUSES,
  LEAVE_TYPES,
  RECOMMENDATIONS,
} from '../enums';
import { email, isoDate, money, nationalId, objectId, optionalString, paginationQuery, phone, time24 } from './common';

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

// ── Employees ────────────────────────────────────────────────────────────────
export const employeeSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  cnic: nationalId.optional().or(z.literal('').transform(() => undefined)),
  gender: z.enum(GENDERS),
  dateOfBirth: isoDate.optional(),
  departmentId: objectId,
  designation: z.string().trim().min(2).max(80),
  joiningDate: isoDate,
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FullTime'),
  phone: phone.optional().or(z.literal('').transform(() => undefined)),
  email: email.optional().or(z.literal('').transform(() => undefined)),
  address: optionalString(300),
  emergencyContactName: optionalString(120),
  emergencyContactPhone: phone.optional().or(z.literal('').transform(() => undefined)),
  reportingManagerId: objectId.optional().or(z.literal('').transform(() => undefined)),
  shiftStart: time24.optional().or(z.literal('').transform(() => undefined)),
  shiftEnd: time24.optional().or(z.literal('').transform(() => undefined)),
  isActive: z.boolean().default(true),
});
export type EmployeeInput = z.infer<typeof employeeSchema>;

export const employeeListQuery = paginationQuery.extend({
  departmentId: objectId.optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
});

export const contractSchema = z
  .object({
    type: z.enum(EMPLOYMENT_TYPES),
    startDate: isoDate,
    endDate: isoDate.optional(),
    basicSalary: money,
    noticePeriodDays: z.coerce.number().int().min(0).max(180).default(30),
    probationMonths: z.coerce.number().int().min(0).max(12).default(3),
    terms: optionalString(4000),
  })
  .refine((c) => !c.endDate || c.endDate > c.startDate, { path: ['endDate'], message: 'End date must be after start date' });

export const performanceReviewSchema = z.object({
  period: z.string().trim().min(4).max(30), // e.g. "2026 H1"
  rating: z.coerce.number().int().min(1).max(5),
  goals: optionalString(3000),
  strengths: optionalString(3000),
  improvements: optionalString(3000),
  submit: z.boolean().default(false),
});

// ── Attendance ───────────────────────────────────────────────────────────────
export const manualAttendanceSchema = z
  .object({
    employeeId: objectId,
    date: isoDate,
    status: z.enum(ATTENDANCE_STATUSES).optional(),
    clockIn: time24.optional(),
    clockOut: time24.optional(),
    note: z.string().trim().min(3, 'Give a reason for the manual entry').max(300),
  })
  .refine((a) => !a.clockOut || !a.clockIn || a.clockOut > a.clockIn, { path: ['clockOut'], message: 'Clock-out must be after clock-in' })
  .refine((a) => a.status || a.clockIn, { path: ['clockIn'], message: 'Enter a clock-in time or a status' });

export const attendanceQuery = z.object({
  period: period.optional(),
  date: isoDate.optional(),
  departmentId: objectId.optional(),
  employeeId: objectId.optional(),
});

// ── Leave ────────────────────────────────────────────────────────────────────
export const leaveRequestSchema = z
  .object({
    type: z.enum(LEAVE_TYPES),
    from: isoDate,
    to: isoDate,
    halfDay: z.boolean().default(false),
    reason: z.string().trim().min(3, 'Give a reason').max(500),
  })
  .refine((l) => l.to >= l.from, { path: ['to'], message: 'End date is before start date' })
  .refine((l) => !l.halfDay || l.from === l.to, { path: ['halfDay'], message: 'Half day applies to a single date' });
export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;

export const leaveDecisionSchema = z
  .object({ approve: z.boolean(), note: optionalString(300) })
  .refine((d) => d.approve || !!d.note, { path: ['note'], message: 'Give a reason for rejecting' });

export const leaveListQuery = paginationQuery.extend({
  status: z.string().max(80).optional(), // comma-separated
  employeeId: objectId.optional(),
  scope: z.enum(['mine', 'team', 'all']).default('all'),
});

// ── Payroll ──────────────────────────────────────────────────────────────────
const lineItem = z.object({ name: z.string().trim().min(1).max(60), amount: money });

export const salaryStructureSchema = z.object({
  effectiveFrom: isoDate,
  basic: money,
  allowances: z.array(lineItem).max(20).default([]),
  deductions: z.array(lineItem).max(20).default([]),
  taxPercent: z.coerce.number().min(0).max(50).default(0),
  overtimeRatePerHour: money.optional(), // default: 1.5 × hourly basic
  bankName: optionalString(80),
  bankAccount: optionalString(40),
});
export type SalaryStructureInput = z.infer<typeof salaryStructureSchema>;

export const createPayrollRunSchema = z.object({ period });
export const payrollAdjustSchema = z.object({
  bonus: money.default(0),
  otherDeduction: money.default(0),
  note: optionalString(300),
});

// ── Recruitment ──────────────────────────────────────────────────────────────
export const jobSchema = z.object({
  title: z.string().trim().min(2).max(120),
  departmentId: objectId,
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FullTime'),
  openings: z.coerce.number().int().min(1).max(100).default(1),
  description: z.string().trim().min(10, 'Describe the role').max(5000),
  requirements: optionalString(5000),
  salaryMin: money.optional(),
  salaryMax: money.optional(),
  closingDate: isoDate.optional(),
  status: z.enum(JOB_STATUSES).default('Draft'),
});

export const candidateSchema = z.object({
  jobId: objectId,
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  gender: z.enum(GENDERS),
  email,
  phone,
  cnic: nationalId.optional().or(z.literal('').transform(() => undefined)),
  source: z.enum(CANDIDATE_SOURCES).default('Website'),
  currentEmployer: optionalString(120),
  experienceYears: z.coerce.number().min(0).max(60).optional(),
  expectedSalary: money.optional(),
  notes: optionalString(2000),
});

export const candidateStageSchema = z.object({
  stage: z.enum(CANDIDATE_STAGES),
  note: optionalString(500),
});

export const candidateListQuery = paginationQuery.extend({
  jobId: objectId.optional(),
  stage: z.enum(CANDIDATE_STAGES).optional(),
});

export const interviewSchema = z.object({
  candidateId: objectId,
  scheduledAt: z.string().datetime({ offset: true, message: 'Pick a date and time' }),
  durationMinutes: z.coerce.number().int().min(10).max(480).default(45),
  mode: z.enum(INTERVIEW_MODES).default('In person'),
  location: optionalString(200),
  panel: z.array(z.string().trim().min(2).max(80)).min(1, 'Add at least one interviewer').max(10),
});

export const evaluationSchema = z.object({
  technical: z.coerce.number().int().min(1).max(5),
  communication: z.coerce.number().int().min(1).max(5),
  experience: z.coerce.number().int().min(1).max(5),
  attitude: z.coerce.number().int().min(1).max(5),
  recommendation: z.enum(RECOMMENDATIONS),
  comments: z.string().trim().min(3, 'Add comments').max(3000),
});

export const offerSchema = z.object({
  candidateId: objectId,
  designation: z.string().trim().min(2).max(80),
  departmentId: objectId,
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FullTime'),
  basicSalary: money,
  allowances: z.array(lineItem).max(20).default([]),
  joiningDate: isoDate,
  expiresOn: isoDate,
  terms: optionalString(4000),
});
export type OfferInput = z.infer<typeof offerSchema>;
