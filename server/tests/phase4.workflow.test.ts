import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { computePay, isoWeekday } from '@hms/shared';
import { connectDb, disconnectDb } from '../src/core/db';
import { seed } from '../src/seed/seed';
import { createApp } from '../src/app';
import { AuditLog } from '../src/core/audit/audit';
import { PASSWORD, localToday, signIn, type Session } from './helpers';

let app: Express;
let admin: Session, superadmin: Session, hr: Session, headNurse: Session, staffNurse: Session, payroll: Session, recruiter: Session, patient: Session;
const s: Record<string, any> = {};

/** n-th working day (Mon–Sat) after today, as YYYY-MM-DD. */
function workday(n: number) {
  let t = Date.parse(`${localToday()}T00:00:00Z`);
  let found = 0;
  while (found < n) {
    t += 86_400_000;
    if (isoWeekday(new Date(t).toISOString().slice(0, 10)) !== 7) found++;
  }
  return new Date(t).toISOString().slice(0, 10);
}

beforeAll(async () => {
  await connectDb(process.env.MONGODB_URI!);
  await seed(PASSWORD);
  app = createApp();
  [admin, superadmin, hr, headNurse, payroll, recruiter, patient] = await Promise.all(
    ['admin', 'superadmin', 'hr', 'nurse', 'payroll', 'recruitment', 'patient'].map((r) => signIn(app, `${r}@hospital.com`)),
  );
  // A staff nurse who reports to the head nurse (nurse@)
  const users = (await admin.get('/api/admin/users?search=nurse.&pageSize=20')).body.items;
  s.staffNurseEmail = users.find((u: any) => u.email !== 'nurse@hospital.com').email;
  staffNurse = await signIn(app, s.staffNurseEmail);
});

afterAll(async () => {
  await disconnectDb();
});

describe('Attendance self-service', () => {
  it('clocks in once, then out, with worked minutes recorded', async () => {
    const me = (await staffNurse.get('/api/auth/me')).body;
    expect(me.employeeId).toBeTruthy();
    s.staffNurseEmployeeId = me.employeeId;
    const inRes = await staffNurse.post('/api/me/attendance/clock-in');
    expect(inRes.status, JSON.stringify(inRes.body)).toBe(200);
    expect(['Present', 'Late']).toContain(inRes.body.status);
    await staffNurse.post('/api/me/attendance/clock-in').expect(409);
    const out = await staffNurse.post('/api/me/attendance/clock-out');
    expect(out.status).toBe(200);
    expect(out.body.clockOut).toBeTruthy();
    await staffNurse.post('/api/me/attendance/clock-out').expect(409);
    const mine = (await staffNurse.get('/api/me/attendance')).body;
    expect(mine.today.status).toBeTruthy();
  });

  it('patients have no self-service; staff cannot read the HR register', async () => {
    await patient.get('/api/me/attendance').expect(403);
    await staffNurse.get('/api/hr/employees').expect(403);
    await staffNurse.get('/api/hr/attendance/day').expect(403);
  });

  it('HR closes the day: absentees are marked once, punches are never overwritten', async () => {
    const first = await hr.post('/api/hr/attendance/close-day', { date: localToday() });
    expect(first.status).toBe(200);
    expect(first.body.marked).toBeGreaterThan(0);
    const again = await hr.post('/api/hr/attendance/close-day', { date: localToday() });
    expect(again.body.marked).toBe(0);
    const reg = (await hr.get(`/api/hr/attendance/day?date=${localToday()}`)).body;
    const nurseRow = reg.find((r: any) => r.employeeId === s.staffNurseEmployeeId);
    expect(nurseRow.record.clockIn).toBeTruthy();
    await hr.post('/api/hr/attendance/close-day', { date: workday(3) }).expect(422);
  });

  it('HR corrects a punch with a reason; summary reports late/overtime', async () => {
    const res = await hr.post('/api/hr/attendance/manual', { employeeId: s.staffNurseEmployeeId, date: localToday(), clockIn: '09:45', clockOut: '19:30', note: 'Badge reader fault' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'Manual', status: 'Late', lateMinutes: 35, overtimeMinutes: 105 });
    const sum = (await hr.get(`/api/hr/attendance/summary?employeeId=${s.staffNurseEmployeeId}`)).body;
    expect(sum.rows[0].late).toBeGreaterThanOrEqual(1);
    await hr.post('/api/hr/attendance/manual', { employeeId: s.staffNurseEmployeeId, date: localToday(), clockIn: '09:00', note: 'x' }).expect(400);
  });
});

describe('Leave: employee → manager → HR', () => {
  it('requests leave against the balance; reserved days show as pending', async () => {
    const before = (await staffNurse.get('/api/me/leave')).body.balances.find((b: any) => b.type === 'Casual');
    const res = await staffNurse.post('/api/me/leave', { type: 'Casual', from: workday(5), to: workday(6), reason: 'Family event' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('PendingManager');
    expect(res.body.days).toBe(2);
    s.leave = res.body;
    const after = (await staffNurse.get('/api/me/leave')).body.balances.find((b: any) => b.type === 'Casual');
    expect(after.pending).toBe(before.pending + 2);
    expect(after.available).toBe(before.available - 2);
  });

  it('rejects overlaps and requests beyond the balance', async () => {
    const overlap = await staffNurse.post('/api/me/leave', { type: 'Annual', from: workday(6), to: workday(7), reason: 'Overlap test' });
    expect(overlap.status).toBe(409);
    const tooLong = await staffNurse.post('/api/me/leave', { type: 'Casual', from: workday(20), to: workday(35), reason: 'Too long' });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.code).toBe('insufficient_balance');
  });

  it('enforces the order: only the manager first, then HR', async () => {
    await hr.post(`/api/hr/leave/${s.leave._id}/hr-decision`, { approve: true }).expect(409); // still with manager
    await payroll.post(`/api/hr/leave/${s.leave._id}/manager-decision`, { approve: true }).expect(403); // not the manager
    const team = (await headNurse.get('/api/hr/leave?scope=team&status=PendingManager')).body.items;
    expect(team.some((l: any) => l._id === s.leave._id)).toBe(true);
    const m = await headNurse.post(`/api/hr/leave/${s.leave._id}/manager-decision`, { approve: true, note: 'Covered by roster' });
    expect(m.body.status).toBe('PendingHR');
    const h = await hr.post(`/api/hr/leave/${s.leave._id}/hr-decision`, { approve: true });
    expect(h.body.status).toBe('Approved');
    const bal = (await staffNurse.get('/api/me/leave')).body.balances.find((b: any) => b.type === 'Casual');
    expect(bal.used).toBeGreaterThanOrEqual(2);
    const notes = (await staffNurse.get('/api/notifications')).body.items;
    expect(notes.some((n: any) => n.type === 'LeaveApproval' && n.title === 'Leave approved')).toBe(true);
  });

  it('cancelling approved future leave restores the balance', async () => {
    const before = (await staffNurse.get('/api/me/leave')).body.balances.find((b: any) => b.type === 'Casual');
    const c = await staffNurse.post(`/api/hr/leave/${s.leave._id}/cancel`);
    expect(c.body.status).toBe('Cancelled');
    const after = (await staffNurse.get('/api/me/leave')).body.balances.find((b: any) => b.type === 'Casual');
    expect(after.used).toBe(before.used - 2);
  });

  it('a rejection needs a reason and releases the reservation', async () => {
    const lr = (await staffNurse.post('/api/me/leave', { type: 'Annual', from: workday(15), to: workday(15), reason: 'Appointment' })).body;
    await headNurse.post(`/api/hr/leave/${lr._id}/manager-decision`, { approve: false }).expect(400);
    const r = await headNurse.post(`/api/hr/leave/${lr._id}/manager-decision`, { approve: false, note: 'Short staffed that day' });
    expect(r.body.status).toBe('Rejected');
  });
});

describe('Payroll: prepare → review → approve (segregated) → process → payslips', () => {
  it('builds a run from salary, attendance and leave; one run per period', async () => {
    const period = localToday().slice(0, 7);
    const run = await superadmin.post('/api/payroll/runs', { period });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    expect(run.body.runNo).toMatch(/^PAY-\d{4}-\d{3}$/);
    expect(run.body.employees).toBeGreaterThan(20);
    s.run = run.body;
    await payroll.post('/api/payroll/runs', { period }).expect(409);
    const future = `${Number(period.slice(0, 4)) + 1}-01`;
    await payroll.post('/api/payroll/runs', { period: future }).expect(422);
  });

  it('net pay equals the shared pay formula; adjustments recompute', async () => {
    const detail = (await payroll.get(`/api/payroll/runs/${s.run._id}`)).body;
    const item = detail.items.find((i: any) => i.employeeId === s.staffNurseEmployeeId);
    const expected = computePay({ basic: item.basic, allowances: item.allowances, deductions: item.deductions, taxPercent: item.taxPercent, overtimeRatePerHour: item.overtimeRatePerHour, overtimeHours: item.overtimeHours, bonus: 0, otherDeduction: 0, workingDays: item.workingDays, unpaidLeaveDays: item.unpaidLeaveDays, absentDays: item.absentDays });
    expect(item.net).toBe(expected.net);
    const adj = await payroll.patch(`/api/payroll/items/${item._id}`, { bonus: 10000, otherDeduction: 0, note: 'Night-shift bonus' });
    expect(adj.body.net).toBeGreaterThan(item.net);
    s.itemId = item._id;
  });

  it('the preparer cannot approve; payroll officers cannot approve at all', async () => {
    await superadmin.post(`/api/payroll/runs/${s.run._id}/submit`).expect(200);
    await superadmin.post(`/api/payroll/runs/${s.run._id}/approve`).expect(403); // prepared it
    await payroll.post(`/api/payroll/runs/${s.run._id}/approve`).expect(403); // no permission
    await payroll.post(`/api/payroll/runs/${s.run._id}/process`).expect(409); // not approved yet
    await hr.post(`/api/payroll/runs/${s.run._id}/approve`, { note: 'OK' }).expect(200);
    await payroll.patch(`/api/payroll/items/${s.itemId}`, { bonus: 1, otherDeduction: 0 }).expect(422); // locked after approval
    const p = await payroll.post(`/api/payroll/runs/${s.run._id}/process`);
    expect(p.body.status).toBe('Processed');
  });

  it('employees see and download only their own payslips', async () => {
    const slips = (await staffNurse.get('/api/me/payslips')).body;
    const current = slips.find((x: any) => x.period === s.run.period);
    expect(current).toBeTruthy();
    const pdf = await staffNurse.get(`/api/payroll/payslips/${current._id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const others = (await headNurse.get('/api/me/payslips')).body;
    await staffNurse.get(`/api/payroll/payslips/${others[0]._id}/pdf`).expect(403);
  });
});

describe('Recruitment: job → candidate → interview → offer → hire', () => {
  it('runs the pipeline with stage rules and segregated offer approval', async () => {
    const depts = (await admin.get('/api/admin/departments')).body;
    const job = await recruiter.post('/api/recruitment/jobs', { title: 'Pharmacy Assistant', departmentId: depts.find((d: any) => d.code === 'PHAR')._id, openings: 1, description: 'Assist pharmacists with dispensing and stock.', status: 'Open' });
    expect(job.status).toBe(201);
    const cand = await recruiter.post('/api/recruitment/candidates', { jobId: job.body._id, firstName: 'Bilal', lastName: 'Haider', gender: 'Male', email: 'bilal.haider@example.com', phone: '+92 300 7654321' });
    expect(cand.status).toBe(201);
    const id = cand.body._id;
    await recruiter.post('/api/recruitment/candidates', { jobId: job.body._id, firstName: 'B', lastName: 'H', gender: 'Male', email: 'bilal.haider@example.com', phone: '+92 300 7654321' }).expect(409);
    await recruiter.post(`/api/recruitment/candidates/${id}/stage`, { stage: 'Selected' }).expect(409); // must go through the pipeline
    await recruiter.post(`/api/recruitment/candidates/${id}/stage`, { stage: 'Shortlisted' }).expect(200);
    const iv = await recruiter.post('/api/recruitment/interviews', { candidateId: id, scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), panel: ['Amna Sheikh'] });
    expect(iv.status).toBe(201);
    expect((await recruiter.get(`/api/recruitment/candidates/${id}`)).body.stage).toBe('Interview');
    const ev = await recruiter.post(`/api/recruitment/interviews/${iv.body._id}/evaluation`, { technical: 4, communication: 5, experience: 3, attitude: 4, recommendation: 'Hire', comments: 'Good fit' });
    expect(ev.body.evaluation.overall).toBe(4);
    await recruiter.post(`/api/recruitment/candidates/${id}/stage`, { stage: 'Selected' }).expect(200);

    const offer = await recruiter.post('/api/recruitment/offers', { candidateId: id, designation: 'Pharmacy Assistant', departmentId: depts.find((d: any) => d.code === 'PHAR')._id, basicSalary: 55000, allowances: [{ name: 'House rent', amount: 24750 }], joiningDate: workday(10), expiresOn: workday(5) });
    expect(offer.status).toBe(201);
    expect(offer.body.offerNo).toMatch(/^OFR-\d{4}-\d{4}$/);
    await recruiter.post(`/api/recruitment/offers/${offer.body._id}/submit`).expect(200);
    await recruiter.post(`/api/recruitment/offers/${offer.body._id}/approve`).expect(403);
    await hr.post(`/api/recruitment/offers/${offer.body._id}/approve`).expect(200);
    const pdf = await recruiter.get(`/api/recruitment/offers/${offer.body._id}/pdf`);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    await recruiter.post(`/api/recruitment/offers/${offer.body._id}/send`).expect(200);
    expect((await recruiter.get(`/api/recruitment/candidates/${id}`)).body.stage).toBe('Offer');
    await hr.post(`/api/recruitment/candidates/${id}/hire`).expect(422); // not accepted yet
    await recruiter.post(`/api/recruitment/offers/${offer.body._id}/accept`).expect(200);

    const hire = await hr.post(`/api/recruitment/candidates/${id}/hire`);
    expect(hire.status, JSON.stringify(hire.body)).toBe(201);
    expect(hire.body.employee.employeeNo).toMatch(/^EMP-\d{5}$/);
    expect(hire.body.candidate.stage).toBe('Hired');
    const profile = (await hr.get(`/api/hr/employees/${hire.body.employee._id}`)).body;
    expect(profile.contracts[0].basicSalary).toBe(55000);
    expect(profile.salaryHistory[0].allowances[0].amount).toBe(24750);
    expect(profile.gender).toBe('Male');
    await hr.post(`/api/recruitment/candidates/${id}/hire`).expect(409);
    const jobs = (await recruiter.get('/api/recruitment/jobs')).body;
    expect(jobs.find((j: any) => j._id === job.body._id).status).toBe('Closed'); // the only opening is filled
  });
});

describe('Phase 4 cross-cutting', () => {
  it('HR dashboard figures, executive attendance chart and audit trail', async () => {
    const stats = (await hr.get('/api/hr/stats')).body;
    expect(stats.headcount).toBeGreaterThan(30);
    expect(stats.trend).toHaveLength(14);
    const dash = (await admin.get('/api/dashboard/summary?preset=month')).body;
    expect(dash.charts.staffAttendance).toHaveLength(14);
    const actions = await AuditLog.distinct('action');
    for (const a of ['attendance.clock_in', 'attendance.day_closed', 'attendance.corrected', 'leave.requested', 'leave.manager_approved', 'leave.approved', 'leave.cancelled', 'payroll.run_created', 'payroll.item_adjusted', 'payroll.approved', 'payroll.processed', 'payslip.viewed', 'offer.approved', 'candidate.hired']) {
      expect(actions).toContain(a);
    }
  });
});
