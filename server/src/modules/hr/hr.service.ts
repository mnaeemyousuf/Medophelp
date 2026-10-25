import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  LEAVE_TYPES,
  datesBetween,
  evaluateDay,
  isoWeekday,
  leaveWorkflow,
  periodRange,
  toMin,
  workingDaysBetween,
  type EmployeeInput,
  type LeaveRequestInput,
  type LeaveStatus,
  type LeaveType,
  type contractSchema,
  type employeeListQuery,
  type manualAttendanceSchema,
  type performanceReviewSchema,
} from '@hms/shared';
import { can, requireCtx } from '../../core/context';
import { withTransaction } from '../../core/db';
import { BusinessRuleError, ConflictError, ForbiddenError } from '../../core/errors';
import { diff, recordAudit, snapshot } from '../../core/audit/audit';
import { dateOnly, escapeRegex, oid, orNotFound, skipOf, todayString, sortBy } from '../../core/http';
import { nextNumber } from '../../core/numbering/numbering';
import { assertTransition } from '../../core/workflow';
import { notify } from '../../core/notifications/notify';
import { Department, Hospital } from '../organization/organization.models';
import { Employee } from '../staff/staff.models';
import { usersWithPermission } from '../identity/recipients';
import { requireDesignation } from '../organization/catalog';
import { SalaryStructure } from '../payroll/payroll.models';
import { Attendance, Contract, LeaveBalance, LeaveRequest, PerformanceReview, type LeaveRequestDoc } from './hr.models';

// ── Policy ──────────────────────────────────────────────────────────────────
export async function hrPolicy() {
  const h = orNotFound(await Hospital.findById(requireCtx().hospitalId).select('code hr').lean(), 'Hospital');
  const hr = h.hr ?? ({} as NonNullable<typeof h.hr>);
  return {
    code: h.code,
    workStart: hr.workStart ?? '09:00',
    workEnd: hr.workEnd ?? '17:00',
    graceMinutes: hr.graceMinutes ?? 10,
    halfDayMinutes: hr.halfDayMinutes ?? 240,
    weeklyOff: hr.weeklyOff?.length ? hr.weeklyOff : [7],
    holidays: hr.holidays ?? [],
    entitlements: { Annual: 20, Sick: 10, Casual: 8, Maternity: 90, Other: 3, ...(hr.leaveEntitlements ?? {}) } as Record<string, number>,
  };
}
type Policy = Awaited<ReturnType<typeof hrPolicy>>;

const nowMinutes = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

function requireSelf() {
  const c = requireCtx();
  if (!c.employeeId) throw new ForbiddenError('Your account is not linked to an employee record');
  return c.employeeId;
}

// ── Employees ───────────────────────────────────────────────────────────────
export async function listEmployees(q: z.infer<typeof employeeListQuery>) {
  const filter: Record<string, unknown> = {};
  if (q.active !== 'all') filter.isActive = q.active === 'true';
  if (q.departmentId) filter.departmentId = oid(q.departmentId);
  if (q.employmentType) filter.employmentType = q.employmentType;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ firstName: rx }, { lastName: rx }, { employeeNo: q.search.toUpperCase() }, { designation: rx }, { cnic: q.search }];
  }
  const [items, total] = await Promise.all([
    Employee.find(filter).populate('departmentId', 'name').populate('reportingManagerId', 'firstName lastName').sort(sortBy(q.sort, { name: 'firstName', employeeNo: 'employeeNo', designation: 'designation', joiningDate: 'joiningDate' }, { firstName: 1 })).skip(skipOf(q)).limit(q.pageSize).lean(),
    Employee.countDocuments(filter),
  ]);
  const today = await Attendance.find({ date: todayString(), employeeId: { $in: items.map((e) => e._id) } }).select('employeeId status clockIn clockOut').lean();
  const byEmp = new Map(today.map((a) => [a.employeeId.toString(), a]));
  return {
    items: items.map((e) => ({
      ...e,
      fullName: `${e.firstName} ${e.lastName}`,
      departmentName: (e.departmentId as unknown as { name?: string })?.name,
      managerName: e.reportingManagerId ? `${(e.reportingManagerId as unknown as { firstName: string }).firstName} ${(e.reportingManagerId as unknown as { lastName: string }).lastName}` : undefined,
      today: byEmp.get(e._id.toString()) ?? null,
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

async function assertManager(managerId: string | undefined, selfId?: Types.ObjectId) {
  if (!managerId) return;
  if (selfId?.equals(managerId)) throw new BusinessRuleError('An employee cannot report to themselves');
  if (!(await Employee.exists({ _id: oid(managerId), isActive: true }))) throw new BusinessRuleError('Reporting manager not found');
}

const employeeFields = (input: EmployeeInput) => ({
  ...input,
  departmentId: oid(input.departmentId),
  reportingManagerId: input.reportingManagerId ? oid(input.reportingManagerId) : undefined,
  joiningDate: dateOnly(input.joiningDate),
  dateOfBirth: input.dateOfBirth ? dateOnly(input.dateOfBirth) : undefined,
});

export async function createEmployee(input: EmployeeInput) {
  await assertManager(input.reportingManagerId);
  await requireDesignation(input.designation);
  orNotFound(await Department.exists({ _id: oid(input.departmentId) }), 'Department');
  const policy = await hrPolicy();
  return withTransaction(async () => {
    const employeeNo = await nextNumber('employee', 'EMP-{n:5}', policy.code);
    const [e] = await Employee.create([{ ...employeeFields(input), employeeNo }]);
    await recordAudit({ action: 'employee.created', module: 'HR', entity: 'Employee', entityId: e._id, after: e });
    return e.toObject();
  });
}

export async function updateEmployee(id: string, input: EmployeeInput) {
  const e = orNotFound(await Employee.findById(id), 'Employee');
  await assertManager(input.reportingManagerId, e._id);
  if (input.designation !== e.designation) await requireDesignation(input.designation);
  const before = snapshot(e) as Record<string, unknown>;
  e.set(employeeFields(input));
  if (!input.isActive && !e.exitDate) e.exitDate = new Date();
  if (input.isActive) e.exitDate = undefined;
  await e.save();
  await recordAudit({ action: 'employee.updated', module: 'HR', entity: 'Employee', entityId: e._id, ...diff(before, snapshot(e) as Record<string, unknown>) });
  return e.toObject();
}

/** Full HR profile. Salary details only for payroll/HR; reviews and leave for HR or the employee. */
export async function getEmployee(id: string) {
  const c = requireCtx();
  const self = c.employeeId?.equals(id);
  if (!self && !can('hr.employees') && !can('payroll.manage') && !can('hr.attendance')) throw new ForbiddenError();
  const e = orNotFound(await Employee.findById(id).populate('departmentId', 'name').populate('reportingManagerId', 'firstName lastName designation').lean(), 'Employee');
  const year = new Date().getFullYear();
  const period = todayString().slice(0, 7);
  const [contracts, reviews, reports, salary, balances, summary] = await Promise.all([
    Contract.find({ employeeId: e._id }).sort({ startDate: -1 }).lean(),
    PerformanceReview.find({ employeeId: e._id }).sort({ createdAt: -1 }).lean(),
    Employee.find({ reportingManagerId: e._id, isActive: true }).select('firstName lastName designation').lean(),
    can('payroll.manage') || can('hr.employees') ? SalaryStructure.find({ employeeId: e._id }).sort({ effectiveFrom: -1 }).lean() : Promise.resolve([]),
    leaveBalances(e._id, year),
    monthlySummary(period, { employeeId: e._id.toString() }),
  ]);
  return {
    ...e,
    fullName: `${e.firstName} ${e.lastName}`,
    contracts,
    reviews: self || can('hr.employees') ? reviews : [],
    directReports: reports,
    salaryHistory: salary,
    leaveBalances: balances,
    attendanceThisMonth: summary.rows[0] ?? null,
  };
}

// ── Contracts & reviews ─────────────────────────────────────────────────────
export async function addContract(employeeId: string, input: z.infer<typeof contractSchema>) {
  const policy = await hrPolicy();
  return withTransaction(async () => {
    const e = orNotFound(await Employee.findById(employeeId).lean(), 'Employee');
    // A new contract supersedes the current one.
    await Contract.updateMany({ employeeId: e._id, status: 'Active' }, { status: 'Expired' });
    const contractNo = await nextNumber('contract', 'CON-{yyyy}-{n:5}', policy.code);
    const [ct] = await Contract.create([{ ...input, employeeId: e._id, contractNo, startDate: dateOnly(input.startDate), endDate: input.endDate ? dateOnly(input.endDate) : undefined }]);
    await recordAudit({ action: 'contract.created', module: 'HR', entity: 'Contract', entityId: ct._id, after: ct });
    return ct.toObject();
  });
}

export async function terminateContract(contractId: string, reason: string) {
  const ct = orNotFound(await Contract.findById(contractId), 'Contract');
  if (ct.status !== 'Active') throw new BusinessRuleError(`Contract is ${ct.status}`);
  ct.status = 'Terminated';
  ct.terminatedAt = new Date();
  ct.terminationReason = reason;
  await ct.save();
  await recordAudit({ action: 'contract.terminated', module: 'HR', entity: 'Contract', entityId: ct._id, after: { reason } });
  return ct.toObject();
}

export async function saveReview(employeeId: string, input: z.infer<typeof performanceReviewSchema>) {
  const c = requireCtx();
  if (c.employeeId?.equals(employeeId)) throw new ForbiddenError('You cannot review yourself');
  const existing = await PerformanceReview.findOne({ employeeId: oid(employeeId), period: input.period });
  if (existing && existing.status !== 'Draft') throw new BusinessRuleError('This review has been submitted and can no longer be edited');
  const r = existing ?? new PerformanceReview({ employeeId: oid(employeeId), period: input.period });
  r.set({ rating: input.rating, goals: input.goals, strengths: input.strengths, improvements: input.improvements, reviewerName: c.userName, reviewerUserId: c.userId });
  if (input.submit) {
    r.status = 'Submitted';
    r.submittedAt = new Date();
  }
  await r.save();
  await recordAudit({ action: input.submit ? 'review.submitted' : 'review.saved', module: 'HR', entity: 'PerformanceReview', entityId: r._id, after: { period: r.period, rating: r.rating } });
  if (input.submit) {
    const emp = await Employee.findById(employeeId).select('userId').lean();
    if (emp?.userId) await notify({ type: 'General', title: 'Performance review shared', message: `Your ${r.period} review is ready to acknowledge.`, userIds: [emp.userId], link: '/me' });
  }
  return r.toObject();
}

export async function acknowledgeReview(reviewId: string, comment?: string) {
  const self = requireSelf();
  const r = orNotFound(await PerformanceReview.findById(reviewId), 'Review');
  if (!r.employeeId.equals(self)) throw new ForbiddenError();
  if (r.status !== 'Submitted') throw new BusinessRuleError('Only submitted reviews can be acknowledged');
  r.status = 'Acknowledged';
  r.acknowledgedAt = new Date();
  r.employeeComment = comment;
  await r.save();
  await recordAudit({ action: 'review.acknowledged', module: 'HR', entity: 'PerformanceReview', entityId: r._id });
  return r.toObject();
}

// ── Attendance ──────────────────────────────────────────────────────────────
function shiftFor(e: { shiftStart?: string | null; shiftEnd?: string | null }, policy: Policy) {
  return { workStart: e.shiftStart || policy.workStart, workEnd: e.shiftEnd || policy.workEnd, graceMinutes: policy.graceMinutes, halfDayMinutes: policy.halfDayMinutes };
}

async function approvedLeaveOn(employeeId: Types.ObjectId, date: string) {
  return LeaveRequest.findOne({ employeeId, status: 'Approved', from: { $lte: date }, to: { $gte: date } }).lean();
}

export async function clockIn() {
  const employeeId = requireSelf();
  const policy = await hrPolicy();
  const date = todayString();
  const e = orNotFound(await Employee.findById(employeeId).lean(), 'Employee');
  if (!e.isActive) throw new ForbiddenError('Inactive employees cannot clock in');
  if (await approvedLeaveOn(e._id, date)) throw new BusinessRuleError('You are on approved leave today');
  const existing = await Attendance.findOne({ employeeId: e._id, date });
  if (existing?.clockIn) throw new ConflictError(`Already clocked in at ${existing.clockIn.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`, 'already_clocked_in');
  const now = new Date();
  const day = evaluateDay(nowMinutes(now), null, shiftFor(e, policy));
  const rec = existing ?? new Attendance({ employeeId: e._id, departmentId: e.departmentId, date });
  rec.set({ clockIn: now, status: day.status, lateMinutes: day.lateMinutes, source: 'Self' });
  await rec.save();
  await recordAudit({ action: 'attendance.clock_in', module: 'HR', entity: 'Attendance', entityId: rec._id, after: { date, status: rec.status, lateMinutes: rec.lateMinutes } });
  return rec.toObject();
}

export async function clockOut() {
  const employeeId = requireSelf();
  const policy = await hrPolicy();
  const date = todayString();
  const rec = await Attendance.findOne({ employeeId, date });
  if (!rec?.clockIn) throw new BusinessRuleError('You have not clocked in today');
  if (rec.clockOut) throw new ConflictError('Already clocked out', 'already_clocked_out');
  const e = orNotFound(await Employee.findById(employeeId).lean(), 'Employee');
  const now = new Date();
  const day = evaluateDay(nowMinutes(rec.clockIn), nowMinutes(now), shiftFor(e, policy));
  rec.set({ clockOut: now, ...day });
  await rec.save();
  await recordAudit({ action: 'attendance.clock_out', module: 'HR', entity: 'Attendance', entityId: rec._id, after: { date, status: rec.status, workedMinutes: rec.workedMinutes, overtimeMinutes: rec.overtimeMinutes } });
  return rec.toObject();
}

const atLocal = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`);

/** HR correction or entry for a missed punch; always audited with the reason. */
export async function manualEntry(input: z.infer<typeof manualAttendanceSchema>) {
  const policy = await hrPolicy();
  if (input.date > todayString()) throw new BusinessRuleError('Cannot record attendance for a future date');
  const e = orNotFound(await Employee.findById(input.employeeId).lean(), 'Employee');
  const existing = await Attendance.findOne({ employeeId: e._id, date: input.date });
  const before = existing ? snapshot(existing) : undefined;
  const rec = existing ?? new Attendance({ employeeId: e._id, departmentId: e.departmentId, date: input.date });
  if (input.clockIn) {
    const day = evaluateDay(toMin(input.clockIn), input.clockOut ? toMin(input.clockOut) : null, shiftFor(e, policy));
    rec.set({ clockIn: atLocal(input.date, input.clockIn), clockOut: input.clockOut ? atLocal(input.date, input.clockOut) : undefined, ...day, status: input.status ?? day.status });
  } else {
    rec.set({ status: input.status, clockIn: undefined, clockOut: undefined, lateMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 0, overtimeMinutes: 0 });
  }
  rec.set({ source: 'Manual', note: input.note });
  await rec.save();
  await recordAudit({ action: existing ? 'attendance.corrected' : 'attendance.manual_entry', module: 'HR', entity: 'Attendance', entityId: rec._id, before, after: rec });
  return rec.toObject();
}

/**
 * End-of-day close: everyone without a record gets WeeklyOff/Holiday, OnLeave (approved leave)
 * or Absent. Idempotent; never overwrites a punch.
 */
export async function closeDay(date: string) {
  if (date > todayString()) throw new BusinessRuleError('Cannot close a future day');
  const policy = await hrPolicy();
  const employees = await Employee.find({ isActive: true, joiningDate: { $lte: dateOnly(date) } }).select('_id departmentId').lean();
  const existing = new Set((await Attendance.find({ date }).select('employeeId').lean()).map((a) => a.employeeId.toString()));
  const off = policy.weeklyOff.includes(isoWeekday(date));
  const holiday = policy.holidays.includes(date);
  const leaves = await LeaveRequest.find({ status: 'Approved', from: { $lte: date }, to: { $gte: date } }).select('_id employeeId').lean();
  const onLeave = new Map(leaves.map((l) => [l.employeeId.toString(), l._id]));
  const rows = employees
    .filter((e) => !existing.has(e._id.toString()))
    .map((e) => ({
      hospitalId: requireCtx().hospitalId,
      employeeId: e._id,
      departmentId: e.departmentId,
      date,
      source: 'System' as const,
      status: off ? 'WeeklyOff' : holiday ? 'Holiday' : onLeave.has(e._id.toString()) ? 'OnLeave' : 'Absent',
      leaveRequestId: onLeave.get(e._id.toString()),
    }));
  if (rows.length) await Attendance.insertMany(rows, { ordered: false });
  const counts = rows.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  await recordAudit({ action: 'attendance.day_closed', module: 'HR', entity: 'Attendance', entityId: date, meta: counts });
  return { date, marked: rows.length, ...counts };
}

export async function dayRegister(date: string, departmentId?: string) {
  const filter: Record<string, unknown> = { isActive: true };
  if (departmentId) filter.departmentId = oid(departmentId);
  const [employees, records] = await Promise.all([
    Employee.find(filter).populate('departmentId', 'name').sort({ firstName: 1 }).lean(),
    Attendance.find({ date }).lean(),
  ]);
  const byEmp = new Map(records.map((r) => [r.employeeId.toString(), r]));
  return employees.map((e) => ({
    employeeId: e._id,
    employeeNo: e.employeeNo,
    name: `${e.firstName} ${e.lastName}`,
    designation: e.designation,
    departmentName: (e.departmentId as unknown as { name?: string })?.name,
    record: byEmp.get(e._id.toString()) ?? null,
  }));
}

/** Per-employee monthly counts: present, late, half-day, absent, leave, overtime and late minutes. */
export async function monthlySummary(period: string, opts: { departmentId?: string; employeeId?: string } = {}) {
  const { from, to } = periodRange(period);
  const match: Record<string, unknown> = { date: { $gte: from, $lte: to } };
  if (opts.departmentId) match.departmentId = oid(opts.departmentId);
  if (opts.employeeId) match.employeeId = oid(opts.employeeId);
  const rows = await Attendance.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$employeeId',
        present: { $sum: { $cond: [{ $in: ['$status', ['Present', 'Late']] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ['$status', 'Late'] }, 1, 0] } },
        halfDay: { $sum: { $cond: [{ $eq: ['$status', 'HalfDay'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'Absent'] }, 1, 0] } },
        onLeave: { $sum: { $cond: [{ $eq: ['$status', 'OnLeave'] }, 1, 0] } },
        lateMinutes: { $sum: '$lateMinutes' },
        earlyLeaveMinutes: { $sum: '$earlyLeaveMinutes' },
        overtimeMinutes: { $sum: '$overtimeMinutes' },
        workedMinutes: { $sum: '$workedMinutes' },
      },
    },
    { $lookup: { from: 'employees', localField: '_id', foreignField: '_id', as: 'e' } },
    { $set: { e: { $first: '$e' } } },
    { $lookup: { from: 'departments', localField: 'e.departmentId', foreignField: '_id', as: 'd' } },
    { $project: { employeeId: '$_id', _id: 0, employeeNo: '$e.employeeNo', name: { $concat: ['$e.firstName', ' ', '$e.lastName'] }, department: { $first: '$d.name' }, present: 1, late: 1, halfDay: 1, absent: 1, onLeave: 1, lateMinutes: 1, earlyLeaveMinutes: 1, overtimeMinutes: 1, workedMinutes: 1 } },
    { $sort: { name: 1 } },
  ]);
  const policy = await hrPolicy();
  return { period, workingDays: workingDaysBetween(from, to, policy.weeklyOff, policy.holidays), rows };
}

export async function myAttendance(period: string) {
  const employeeId = requireSelf();
  const { from, to } = periodRange(period);
  const [records, summary] = await Promise.all([
    Attendance.find({ employeeId, date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean(),
    monthlySummary(period, { employeeId: employeeId.toString() }),
  ]);
  return { records, summary: summary.rows[0] ?? null, workingDays: summary.workingDays, today: records.find((r) => r.date === todayString()) ?? null };
}

/** Daily status counts for the last `days` days (attendance trend chart). */
export async function attendanceTrend(days = 14) {
  const to = todayString();
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await Attendance.aggregate([{ $match: { date: { $gte: from, $lte: to } } }, { $group: { _id: { date: '$date', status: '$status' }, n: { $sum: 1 } } }]);
  return datesBetween(from, to).map((date) => {
    const get = (s: string) => rows.find((r) => r._id.date === date && r._id.status === s)?.n ?? 0;
    return { date, present: get('Present'), late: get('Late') + get('HalfDay'), absent: get('Absent'), onLeave: get('OnLeave') };
  });
}

// ── Leave ───────────────────────────────────────────────────────────────────
/** Balances for a year, created on first access from the hospital's entitlement policy. */
export async function leaveBalances(employeeId: Types.ObjectId, year: number) {
  const policy = await hrPolicy();
  const existing = await LeaveBalance.find({ employeeId, year }).lean();
  const missing = LEAVE_TYPES.filter((t) => !existing.some((b) => b.type === t));
  if (missing.length) {
    await LeaveBalance.insertMany(missing.map((type) => ({ hospitalId: requireCtx().hospitalId, employeeId, year, type, entitled: type === 'Unpaid' ? 0 : policy.entitlements[type] ?? 0 })), { ordered: false }).catch((err) => {
      if (err?.code !== 11000) throw err; // created concurrently
    });
  }
  const all = await LeaveBalance.find({ employeeId, year }).lean();
  return LEAVE_TYPES.map((t) => {
    const b = all.find((x) => x.type === t)!;
    return { type: t, entitled: b.entitled, used: b.used, pending: b.pending, available: t === 'Unpaid' ? null : Math.max(0, b.entitled - b.used - b.pending) };
  });
}

async function adjustBalance(employeeId: Types.ObjectId, year: number, type: LeaveType, delta: { used?: number; pending?: number }) {
  await leaveBalances(employeeId, year);
  await LeaveBalance.updateOne({ employeeId, year, type }, { $inc: { used: delta.used ?? 0, pending: delta.pending ?? 0 } });
}

export async function requestLeave(input: LeaveRequestInput) {
  const employeeId = requireSelf();
  const policy = await hrPolicy();
  const e = orNotFound(await Employee.findById(employeeId).lean(), 'Employee');
  if (input.from.slice(0, 4) !== input.to.slice(0, 4)) throw new BusinessRuleError('Split leave that crosses a year end into two requests');
  if (input.from < todayString() && input.type !== 'Sick') throw new BusinessRuleError('Only sick leave can be applied for past dates');
  const days = input.halfDay ? 0.5 : workingDaysBetween(input.from, input.to, policy.weeklyOff, policy.holidays);
  if (days <= 0) throw new BusinessRuleError('The selected dates contain no working days');
  const year = Number(input.from.slice(0, 4));

  const created = await withTransaction(async () => {
    const overlap = await LeaveRequest.exists({ employeeId: e._id, status: { $in: ['PendingManager', 'PendingHR', 'Approved'] }, from: { $lte: input.to }, to: { $gte: input.from } });
    if (overlap) throw new ConflictError('You already have leave requested for some of these dates', 'leave_overlap');
    if (input.type !== 'Unpaid') {
      const bal = (await leaveBalances(e._id, year)).find((b) => b.type === input.type)!;
      if (bal.available! < days) throw new BusinessRuleError(`Insufficient ${input.type.toLowerCase()} leave: ${bal.available} day(s) available, ${days} requested`, 'insufficient_balance');
      await adjustBalance(e._id, year, input.type, { pending: days });
    }
    const manager = e.reportingManagerId ? await Employee.findOne({ _id: e.reportingManagerId, isActive: true }).select('_id userId').lean() : null;
    const requestNo = await nextNumber('leave', 'LV-{yyyy}-{n:5}', policy.code);
    const [lr] = (await LeaveRequest.create([
      { requestNo, employeeId: e._id, employeeName: `${e.firstName} ${e.lastName}`, departmentId: e.departmentId, managerId: manager?._id, ...input, days, status: manager ? 'PendingManager' : 'PendingHR' },
    ])) as LeaveRequestDoc[];
    await recordAudit({ action: 'leave.requested', module: 'HR', entity: 'LeaveRequest', entityId: lr._id, after: lr });
    return { lr, managerUserId: manager?.userId };
  });
  const { lr, managerUserId } = created;
  const recipients = lr.status === 'PendingManager' && managerUserId ? [managerUserId] : await usersWithPermission('hr.leave.approve');
  if (recipients.length) await notify({ type: 'LeaveApproval', title: 'Leave request to approve', message: `${lr.employeeName}: ${lr.type} leave ${lr.from} → ${lr.to} (${lr.days} day(s))`, userIds: recipients, link: '/hr/leave' });
  return lr.toObject();
}

async function loadLeave(id: string) {
  return orNotFound((await LeaveRequest.findById(id)) as LeaveRequestDoc | null, 'Leave request');
}

async function notifyEmployee(lr: LeaveRequestDoc, title: string, message: string) {
  const emp = await Employee.findById(lr.employeeId).select('userId').lean();
  if (emp?.userId) await notify({ type: 'LeaveApproval', title, message, userIds: [emp.userId], link: '/me' });
}

/** Step 1: the employee's reporting manager. */
export async function managerDecision(id: string, approve: boolean, note?: string) {
  const c = requireCtx();
  const self = requireSelf();
  const lr = await withTransaction(async () => {
    const lr = await loadLeave(id);
    if (!lr.managerId?.equals(self)) throw new ForbiddenError('Only the reporting manager can make this decision');
    assertTransition(leaveWorkflow, lr.status as LeaveStatus, approve ? 'PendingHR' : 'Rejected');
    lr.status = approve ? 'PendingHR' : 'Rejected';
    lr.managerDecision = { byName: c.userName, byUserId: c.userId, at: new Date(), approve, note } as never;
    if (!approve && lr.type !== 'Unpaid') await adjustBalance(lr.employeeId, Number(lr.from.slice(0, 4)), lr.type as LeaveType, { pending: -lr.days });
    await lr.save();
    await recordAudit({ action: approve ? 'leave.manager_approved' : 'leave.manager_rejected', module: 'HR', entity: 'LeaveRequest', entityId: lr._id, after: { status: lr.status, note } });
    return lr;
  });
  if (approve) {
    const hr = await usersWithPermission('hr.leave.approve');
    if (hr.length) await notify({ type: 'LeaveApproval', title: 'Leave awaiting HR review', message: `${lr.employeeName}: ${lr.type} ${lr.from} → ${lr.to}`, userIds: hr, link: '/hr/leave' });
  } else await notifyEmployee(lr, 'Leave rejected', `Your ${lr.type} leave ${lr.from} → ${lr.to} was declined by your manager${note ? `: ${note}` : ''}.`);
  return lr.toObject();
}

/** Step 2: HR review. Approval moves the reserved days to used and marks the days as leave. */
export async function hrDecision(id: string, approve: boolean, note?: string) {
  const c = requireCtx();
  const lr = await withTransaction(async () => {
    const lr = await loadLeave(id);
    if (c.employeeId?.equals(lr.employeeId)) throw new ForbiddenError('You cannot approve your own leave');
    assertTransition(leaveWorkflow, lr.status as LeaveStatus, approve ? 'Approved' : 'Rejected');
    lr.status = approve ? 'Approved' : 'Rejected';
    lr.hrDecision = { byName: c.userName, byUserId: c.userId, at: new Date(), approve, note } as never;
    const year = Number(lr.from.slice(0, 4));
    if (lr.type !== 'Unpaid') await adjustBalance(lr.employeeId, year, lr.type as LeaveType, approve ? { pending: -lr.days, used: lr.days } : { pending: -lr.days });
    else if (approve) await adjustBalance(lr.employeeId, year, 'Unpaid', { used: lr.days });
    await lr.save();
    if (approve) {
      const policy = await hrPolicy();
      const emp = await Employee.findById(lr.employeeId).select('departmentId').lean();
      for (const date of datesBetween(lr.from, lr.to)) {
        if (policy.weeklyOff.includes(isoWeekday(date)) || policy.holidays.includes(date)) continue;
        // Never overwrite a real punch; otherwise mark the day as leave.
        await Attendance.updateOne(
          { employeeId: lr.employeeId, date, clockIn: null },
          { $set: { status: 'OnLeave', source: 'System', leaveRequestId: lr._id, departmentId: emp?.departmentId }, $setOnInsert: { hospitalId: c.hospitalId } },
          { upsert: true },
        ).catch((err) => {
          if (err?.code !== 11000) throw err;
        });
      }
    }
    await recordAudit({ action: approve ? 'leave.approved' : 'leave.rejected', module: 'HR', entity: 'LeaveRequest', entityId: lr._id, after: { status: lr.status, note } });
    return lr;
  });
  await notifyEmployee(lr, approve ? 'Leave approved' : 'Leave rejected', `Your ${lr.type} leave ${lr.from} → ${lr.to} was ${approve ? 'approved' : 'rejected'}${note ? `: ${note}` : ''}.`);
  return lr.toObject();
}

export async function cancelLeave(id: string) {
  const c = requireCtx();
  return withTransaction(async () => {
    const lr = await loadLeave(id);
    const own = c.employeeId?.equals(lr.employeeId);
    if (!own && !can('hr.leave.approve')) throw new ForbiddenError();
    if (lr.status === 'Approved' && lr.from <= todayString()) throw new BusinessRuleError('Leave that has started cannot be cancelled');
    const wasApproved = lr.status === 'Approved';
    assertTransition(leaveWorkflow, lr.status as LeaveStatus, 'Cancelled');
    lr.status = 'Cancelled';
    lr.cancelledAt = new Date();
    lr.cancelledByName = c.userName;
    const year = Number(lr.from.slice(0, 4));
    if (lr.type !== 'Unpaid') await adjustBalance(lr.employeeId, year, lr.type as LeaveType, wasApproved ? { used: -lr.days } : { pending: -lr.days });
    else if (wasApproved) await adjustBalance(lr.employeeId, year, 'Unpaid', { used: -lr.days });
    if (wasApproved) await Attendance.deleteMany({ employeeId: lr.employeeId, leaveRequestId: lr._id, clockIn: null });
    await lr.save();
    await recordAudit({ action: 'leave.cancelled', module: 'HR', entity: 'LeaveRequest', entityId: lr._id });
    return lr.toObject();
  });
}

export async function listLeave(q: { page: number; pageSize: number; status?: string; employeeId?: string; scope: 'mine' | 'team' | 'all'; sort?: string }) {
  const filter: Record<string, unknown> = {};
  if (q.scope === 'mine') filter.employeeId = requireSelf();
  else if (q.scope === 'team') filter.managerId = requireSelf();
  else {
    if (!can('hr.leave.approve') && !can('hr.employees')) throw new ForbiddenError();
    if (q.employeeId) filter.employeeId = oid(q.employeeId);
  }
  if (q.status) filter.status = { $in: q.status.split(',') };
  const [items, total] = await Promise.all([
    LeaveRequest.find(filter).populate('departmentId', 'name').sort(sortBy(q.sort, { requested: 'createdAt', from: 'from', days: 'days', status: 'status' }, { createdAt: -1 })).skip(skipOf(q)).limit(q.pageSize).lean(),
    LeaveRequest.countDocuments(filter),
  ]);
  return { items: items.map((l) => ({ ...l, departmentName: (l.departmentId as unknown as { name?: string })?.name })), total, page: q.page, pageSize: q.pageSize };
}

export async function myLeave() {
  const employeeId = requireSelf();
  const [balances, requests] = await Promise.all([
    leaveBalances(employeeId, new Date().getFullYear()),
    LeaveRequest.find({ employeeId }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);
  return { balances, requests };
}

/** HR dashboard figures. */
export async function hrStats() {
  const today = todayString();
  const [headcount, byDept, todayRows, pendingHr, pendingMgr, onLeaveToday] = await Promise.all([
    Employee.countDocuments({ isActive: true }),
    Employee.aggregate([{ $match: { isActive: true } }, { $lookup: { from: 'departments', localField: 'departmentId', foreignField: '_id', as: 'd' } }, { $group: { _id: { $first: '$d.name' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    Attendance.aggregate([{ $match: { date: today } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    LeaveRequest.countDocuments({ status: 'PendingHR' }),
    LeaveRequest.countDocuments({ status: 'PendingManager' }),
    LeaveRequest.countDocuments({ status: 'Approved', from: { $lte: today }, to: { $gte: today } }),
  ]);
  const t = (s: string) => todayRows.find((r) => r._id === s)?.n ?? 0;
  const clockedIn = t('Present') + t('Late') + t('HalfDay');
  return {
    headcount,
    byDepartment: byDept.map((d) => ({ department: d._id ?? 'Unassigned', employees: d.n })),
    today: { clockedIn, late: t('Late'), absent: t('Absent'), onLeave: onLeaveToday, notYetIn: Math.max(0, headcount - clockedIn - onLeaveToday - t('Absent') - t('WeeklyOff') - t('Holiday')) },
    pendingLeave: { manager: pendingMgr, hr: pendingHr },
    trend: await attendanceTrend(14),
  };
}
