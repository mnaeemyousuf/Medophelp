import type { Types } from 'mongoose';
import {
  computePay,
  datesBetween,
  isoWeekday,
  payrollWorkflow,
  periodRange,
  round2,
  workingDaysBetween,
  type PayrollStatus,
  type SalaryStructureInput,
} from '@hms/shared';
import { can, requireCtx } from '../../core/context';
import { withTransaction } from '../../core/db';
import { BusinessRuleError, ConflictError, ForbiddenError } from '../../core/errors';
import { recordAudit } from '../../core/audit/audit';
import { dateOnly, oid, orNotFound, todayString } from '../../core/http';
import { nextNumber } from '../../core/numbering/numbering';
import { assertTransition } from '../../core/workflow';
import { notify } from '../../core/notifications/notify';
import { Employee } from '../staff/staff.models';
import { Attendance, LeaveRequest } from '../hr/hr.models';
import { hrPolicy } from '../hr/hr.service';
import { usersWithPermission } from '../identity/recipients';
import { PayrollItem, PayrollRun, Payslip, SalaryStructure, type PayrollItemDoc, type PayrollRunDoc } from './payroll.models';

// ── Salary structures ───────────────────────────────────────────────────────
export async function salaryHistory(employeeId: string) {
  return SalaryStructure.find({ employeeId: oid(employeeId) }).sort({ effectiveFrom: -1 }).lean();
}

export async function setSalary(employeeId: string, input: SalaryStructureInput) {
  const e = orNotFound(await Employee.findById(employeeId).lean(), 'Employee');
  const previous = await SalaryStructure.findOne({ employeeId: e._id }).sort({ effectiveFrom: -1 }).lean();
  const s = await SalaryStructure.create({ ...input, employeeId: e._id, effectiveFrom: dateOnly(input.effectiveFrom) });
  await recordAudit({ action: 'salary.changed', module: 'Payroll', entity: 'SalaryStructure', entityId: s._id, before: previous ? { basic: previous.basic, allowances: previous.allowances, deductions: previous.deductions, taxPercent: previous.taxPercent } : undefined, after: s, meta: { employeeNo: e.employeeNo } });
  return s.toObject();
}

// ── Runs ────────────────────────────────────────────────────────────────────

/** Attendance and leave figures for one employee in the period, used as payroll inputs. */
async function periodInputs(employeeId: Types.ObjectId, period: string, policy: Awaited<ReturnType<typeof hrPolicy>>, joiningDate: Date) {
  const { from, to } = periodRange(period);
  const att = await Attendance.find({ employeeId, date: { $gte: from, $lte: to } }).select('status overtimeMinutes').lean();
  const leaves = await LeaveRequest.find({ employeeId, status: 'Approved', from: { $lte: to }, to: { $gte: from } }).select('type from to halfDay').lean();
  let unpaid = 0;
  let paid = 0;
  for (const l of leaves) {
    const days = l.halfDay ? 0.5 : datesBetween(l.from < from ? from : l.from, l.to > to ? to : l.to).filter((d) => !policy.weeklyOff.includes(isoWeekday(d)) && !policy.holidays.includes(d)).length;
    if (l.type === 'Unpaid') unpaid += days;
    else paid += days;
  }
  // Days before joining in a part month are unpaid, not absences.
  const joined = joiningDate.toISOString().slice(0, 10);
  const preJoin = joined > from ? workingDaysBetween(from, joined < to ? new Date(Date.parse(joined) - 86_400_000).toISOString().slice(0, 10) : to, policy.weeklyOff, policy.holidays) : 0;
  return {
    presentDays: att.filter((a) => ['Present', 'Late'].includes(a.status)).length + att.filter((a) => a.status === 'HalfDay').length * 0.5,
    absentDays: att.filter((a) => a.status === 'Absent').length + att.filter((a) => a.status === 'HalfDay').length * 0.5,
    overtimeHours: round2(att.reduce((s, a) => s + (a.overtimeMinutes ?? 0), 0) / 60),
    unpaidLeaveDays: unpaid + preJoin,
    paidLeaveDays: paid,
  };
}

function applyPay(item: PayrollItemDoc) {
  const pay = computePay({
    basic: item.basic ?? 0,
    allowances: item.allowances,
    deductions: item.deductions,
    taxPercent: item.taxPercent ?? 0,
    overtimeRatePerHour: item.overtimeRatePerHour ?? 0,
    overtimeHours: item.overtimeHours ?? 0,
    bonus: item.bonus ?? 0,
    otherDeduction: item.otherDeduction ?? 0,
    workingDays: item.workingDays ?? 0,
    unpaidLeaveDays: item.unpaidLeaveDays ?? 0,
    absentDays: item.absentDays ?? 0,
  });
  item.set({ allowanceTotal: pay.allowanceTotal, overtimePay: pay.overtimePay, gross: pay.gross, unpaidLeaveDeduction: pay.unpaidLeaveDeduction, absenceDeduction: pay.absenceDeduction, tax: pay.tax, totalDeductions: pay.totalDeductions, net: pay.net });
}

async function retotal(run: PayrollRunDoc) {
  const t = await PayrollItem.aggregate([{ $match: { runId: run._id } }, { $group: { _id: null, gross: { $sum: '$gross' }, deductions: { $sum: '$totalDeductions' }, tax: { $sum: '$tax' }, net: { $sum: '$net' }, n: { $sum: 1 } } }]);
  run.totals = { gross: round2(t[0]?.gross ?? 0), deductions: round2(t[0]?.deductions ?? 0), tax: round2(t[0]?.tax ?? 0), net: round2(t[0]?.net ?? 0) } as never;
  run.employees = t[0]?.n ?? 0;
}

async function buildItems(run: PayrollRunDoc) {
  const policy = await hrPolicy();
  const { to } = periodRange(run.period);
  const employees = await Employee.find({ isActive: true, joiningDate: { $lte: dateOnly(to) } }).populate('departmentId', 'name').lean();
  const skipped: string[] = [];
  for (const e of employees) {
    const s = await SalaryStructure.findOne({ employeeId: e._id, effectiveFrom: { $lte: dateOnly(to) } }).sort({ effectiveFrom: -1 }).lean();
    if (!s) {
      skipped.push(`${e.firstName} ${e.lastName}`);
      continue;
    }
    const inputs = await periodInputs(e._id, run.period, policy, e.joiningDate);
    const hourly = run.workingDays > 0 ? s.basic / (run.workingDays * 8) : 0;
    const item = new PayrollItem({
      runId: run._id,
      period: run.period,
      employeeId: e._id,
      employeeNo: e.employeeNo,
      employeeName: `${e.firstName} ${e.lastName}`,
      designation: e.designation,
      departmentId: (e.departmentId as unknown as { _id: Types.ObjectId })?._id,
      departmentName: (e.departmentId as unknown as { name?: string })?.name,
      bankName: s.bankName,
      bankAccount: s.bankAccount,
      basic: s.basic,
      allowances: s.allowances,
      deductions: s.deductions,
      taxPercent: s.taxPercent,
      overtimeRatePerHour: s.overtimeRatePerHour ?? round2(hourly * 1.5),
      workingDays: run.workingDays,
      ...inputs,
    }) as PayrollItemDoc;
    applyPay(item);
    await item.save();
  }
  return skipped;
}

export async function createRun(period: string) {
  const c = requireCtx();
  if (period > todayString().slice(0, 7)) throw new BusinessRuleError('Payroll cannot be prepared for a future month');
  const policy = await hrPolicy();
  const { from, to } = periodRange(period);
  return withTransaction(async () => {
    if (await PayrollRun.exists({ period, isLive: true })) throw new ConflictError(`A payroll run for ${period} already exists`, 'duplicate_run');
    const runNo = await nextNumber('payrollRun', 'PAY-{yyyy}-{n:3}', policy.code);
    const [run] = (await PayrollRun.create([{ runNo, period, workingDays: workingDaysBetween(from, to, policy.weeklyOff, policy.holidays), preparedByName: c.userName, history: [{ status: 'Draft', byName: c.userName }] }])) as PayrollRunDoc[];
    const skipped = await buildItems(run);
    await retotal(run);
    await run.save();
    await recordAudit({ action: 'payroll.run_created', module: 'Payroll', entity: 'PayrollRun', entityId: run._id, after: { period, employees: run.employees, totals: run.totals }, meta: skipped.length ? { skippedNoSalary: skipped } : undefined });
    return { ...run.toObject(), skipped };
  });
}

async function loadRun(id: string) {
  return orNotFound((await PayrollRun.findById(id)) as PayrollRunDoc | null, 'Payroll run');
}

/** Rebuilds a draft from current attendance, leave and salary data (keeps nothing manual). */
export async function regenerate(id: string) {
  return withTransaction(async () => {
    const run = await loadRun(id);
    if (run.status !== 'Draft') throw new BusinessRuleError('Only draft runs can be regenerated');
    await PayrollItem.deleteMany({ runId: run._id });
    const skipped = await buildItems(run);
    await retotal(run);
    await run.save();
    await recordAudit({ action: 'payroll.run_regenerated', module: 'Payroll', entity: 'PayrollRun', entityId: run._id, after: { totals: run.totals } });
    return { ...run.toObject(), skipped };
  });
}

export async function adjustItem(itemId: string, input: { bonus: number; otherDeduction: number; note?: string }) {
  return withTransaction(async () => {
    const item = orNotFound((await PayrollItem.findById(itemId)) as PayrollItemDoc | null, 'Payroll item');
    const run = await loadRun(item.runId.toString());
    if (!['Draft', 'Review'].includes(run.status)) throw new BusinessRuleError(`Run is ${run.status}; adjustments are closed`);
    const before = { bonus: item.bonus, otherDeduction: item.otherDeduction, net: item.net };
    item.set({ bonus: input.bonus, otherDeduction: input.otherDeduction, adjustmentNote: input.note });
    applyPay(item);
    if (item.net === 0 && input.otherDeduction > 0) throw new BusinessRuleError('Deductions exceed gross pay');
    await item.save();
    await retotal(run);
    await run.save();
    await recordAudit({ action: 'payroll.item_adjusted', module: 'Payroll', entity: 'PayrollItem', entityId: item._id, before, after: { bonus: item.bonus, otherDeduction: item.otherDeduction, net: item.net, note: input.note } });
    return item.toObject();
  });
}

export type RunAction = 'submit' | 'approve' | 'reject' | 'process' | 'cancel';

export async function actOnRun(id: string, action: RunAction, note?: string) {
  const c = requireCtx();
  const policy = await hrPolicy();
  const result = await withTransaction(async () => {
    const run = await loadRun(id);
    const target: Record<RunAction, PayrollStatus> = { submit: 'Review', approve: 'Approved', reject: 'Draft', process: 'Processed', cancel: 'Cancelled' };
    if (action === 'approve' || action === 'reject') {
      if (!can('payroll.approve')) throw new ForbiddenError();
      if (run.createdBy && c.userId?.equals(run.createdBy)) throw new ForbiddenError('Payroll must be approved by someone other than the preparer');
    }
    if (action === 'process' && !can('payroll.manage')) throw new ForbiddenError();
    assertTransition(payrollWorkflow, run.status as PayrollStatus, target[action]);
    run.status = target[action];
    run.history.push({ status: run.status, byName: c.userName, at: new Date(), note });
    if (action === 'approve') {
      run.approvedBy = c.userId;
      run.approvedByName = c.userName;
      run.approvedAt = new Date();
    }
    let payslips = 0;
    if (action === 'process') {
      run.processedAt = new Date();
      const items = await PayrollItem.find({ runId: run._id }).lean();
      for (const it of items) {
        const payslipNo = await nextNumber('payslip', 'PS-{yyyy}-{n:6}', policy.code);
        await Payslip.create([{ payslipNo, runId: run._id, itemId: it._id, employeeId: it.employeeId, period: run.period, gross: it.gross, totalDeductions: it.totalDeductions, net: it.net }]);
        payslips++;
      }
    }
    await run.save();
    await recordAudit({ action: `payroll.${action === 'submit' ? 'submitted' : action === 'approve' ? 'approved' : action === 'reject' ? 'returned' : action === 'process' ? 'processed' : 'cancelled'}`, module: 'Payroll', entity: 'PayrollRun', entityId: run._id, after: { status: run.status, totals: run.totals, payslips: payslips || undefined, note } });
    return run;
  });
  if (action === 'process') {
    const items = await PayrollItem.find({ runId: result._id }).select('employeeId').lean();
    const users = (await Employee.find({ _id: { $in: items.map((i) => i.employeeId) }, userId: { $ne: null } }).select('userId').lean()).map((e) => e.userId!);
    if (users.length) await notify({ type: 'PayrollGenerated', title: 'Payslip available', message: `Your payslip for ${result.period} is ready.`, userIds: users, link: '/me', external: ['Email'] });
  }
  if (action === 'submit') {
    const approvers = await usersWithPermission('payroll.approve');
    if (approvers.length) await notify({ type: 'PayrollGenerated', title: 'Payroll awaiting approval', message: `${result.runNo} (${result.period}) is ready for review.`, userIds: approvers, link: `/payroll/runs/${result._id}` });
  }
  return result.toObject();
}

export async function listRuns() {
  return PayrollRun.find().select('-history').sort({ period: -1, createdAt: -1 }).limit(36).lean();
}

export async function getRun(id: string) {
  const run = orNotFound(await PayrollRun.findById(id).lean(), 'Payroll run');
  const [rawItems, slips] = await Promise.all([
    PayrollItem.find({ runId: run._id }).sort({ departmentName: 1, employeeName: 1 }).lean(),
    Payslip.find({ runId: run._id }).select('itemId payslipNo').lean(),
  ]);
  const slipByItem = new Map(slips.map((s) => [s.itemId.toString(), s]));
  const items = rawItems.map((i) => ({ ...i, payslipId: slipByItem.get(i._id.toString())?._id, payslipNo: slipByItem.get(i._id.toString())?.payslipNo }));
  const byDepartment = Object.values(
    items.reduce<Record<string, { department: string; employees: number; gross: number; net: number }>>((m, i) => {
      const k = i.departmentName ?? 'Unassigned';
      m[k] ??= { department: k, employees: 0, gross: 0, net: 0 };
      m[k].employees++;
      m[k].gross = round2(m[k].gross + (i.gross ?? 0));
      m[k].net = round2(m[k].net + (i.net ?? 0));
      return m;
    }, {}),
  );
  return { ...run, items, byDepartment };
}

// ── Payslips ────────────────────────────────────────────────────────────────
export async function myPayslips() {
  const c = requireCtx();
  if (!c.employeeId) throw new ForbiddenError('Your account is not linked to an employee record');
  return Payslip.find({ employeeId: c.employeeId }).sort({ period: -1 }).lean();
}

/** A payslip is readable by its employee and by payroll/HR staff. */
export async function payslipData(id: string) {
  const c = requireCtx();
  const ps = orNotFound(await Payslip.findById(id).lean(), 'Payslip');
  if (!c.employeeId?.equals(ps.employeeId) && !can('payroll.manage') && !can('payroll.approve')) throw new ForbiddenError();
  const item = orNotFound(await PayrollItem.findById(ps.itemId).lean(), 'Payroll item');
  await recordAudit({ action: 'payslip.viewed', module: 'Payroll', entity: 'Payslip', entityId: ps._id });
  return { payslip: ps, item };
}
