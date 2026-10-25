import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { REPORTS } from '@hms/shared';
import { connectDb, disconnectDb } from '../src/core/db';
import { runWithContext } from '../src/core/context';
import { seed } from '../src/seed/seed';
import { createApp } from '../src/app';
import { AuditLog } from '../src/core/audit/audit';
import { Hospital } from '../src/modules/organization/organization.models';
import { Notification } from '../src/modules/notifications/notification.model';
import { MedicationDose, MedicationSchedule } from '../src/modules/medication/medication.models';
import { runMedicationPass } from '../src/modules/medication/medication.jobs';
import { PASSWORD, signIn, type Session } from './helpers';

let app: Express;
let superadmin: Session, patient: Session, pharmacist: Session, reception: Session, nurse: Session, accounts: Session, hr: Session;
const s: Record<string, any> = {};
const HOUR = 3_600_000;
/** Direct DB reads in tests run as the system (no tenant in context). */
const sys = <T>(fn: () => Promise<T>) => runWithContext({ roles: [], permissions: new Set(), system: true }, fn);

beforeAll(async () => {
  await connectDb(process.env.MONGODB_URI!);
  await seed(PASSWORD);
  app = createApp();
  [superadmin, patient, pharmacist, reception, nurse, accounts, hr] = await Promise.all(
    ['superadmin', 'patient', 'pharmacy', 'reception', 'nurse', 'accounts', 'hr'].map((r) => signIn(app, `${r}@hospital.com`)),
  );
});

afterAll(async () => {
  await disconnectDb();
});

describe('Medication reminders: dispense → schedule → doses', () => {
  it('dispensing creates a reminder schedule with one dose per administration', async () => {
    const queue = (await pharmacist.get('/api/pharmacy/queue?pageSize=50')).body.items;
    const rx = queue.find((r: any) => r.stockReady && r.lines.every((l: any) => l.linked));
    expect(rx, 'a dispensable prescription in the seeded queue').toBeTruthy();
    const ctx = (await pharmacist.get(`/api/pharmacy/prescriptions/${rx._id}`)).body;
    const lines = ctx.lines.filter((l: any) => l.remaining > 0 && l.item && !l.item.isControlled);
    const res = await pharmacist.post(`/api/pharmacy/prescriptions/${rx._id}/dispense`, { lines: lines.map((l: any) => ({ prescriptionItemId: l.prescriptionItemId, itemId: l.item._id, quantity: l.remaining })) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const schedules = (await pharmacist.get(`/api/medications/patients/${rx.patient.id}`)).body;
    const mine = schedules.filter((x: any) => x.prescriptionNo === rx.prescriptionNo);
    expect(mine.length).toBeGreaterThan(0);
    for (const sc of mine) {
      const line = ctx.lines.find((l: any) => l.medicineName === sc.medicineName);
      expect(sc.totalDoses).toBe(sc.timesPerDay * line.durationDays);
      expect(sc.times).toHaveLength(sc.timesPerDay);
      const doses = (await pharmacist.get(`/api/medications/schedules/${sc._id}/doses`)).body.doses;
      expect(doses).toHaveLength(sc.totalDoses);
    }
    // Dispensing the same lines again cannot happen, and schedules are never duplicated.
    expect(await sys(() => MedicationSchedule.countDocuments({ prescriptionNo: rx.prescriptionNo }).exec())).toBe(mine.length);
  });

  it('the patient sees their medicines, adherence and today’s doses', async () => {
    const me = (await patient.get('/api/medications/mine')).body;
    expect(me.schedules.length).toBeGreaterThanOrEqual(3);
    expect(me.adherence).toBeGreaterThan(50);
    const metformin = me.schedules.find((x: any) => x.medicineName === 'Metformin 500mg');
    expect(metformin).toMatchObject({ timesPerDay: 2, chronic: true, status: 'Active' });
    expect(metformin.taken).toBeGreaterThan(0);
    s.metformin = metformin;
    s.patientId = metformin.patientId;
  });

  it('a due dose can be marked taken once; future doses cannot', async () => {
    const { doses } = (await patient.get(`/api/medications/schedules/${s.metformin._id}/doses`)).body;
    const now = Date.now();
    // Whether a dose happens to be due right now depends on the clock, so make one due: move the
    // last pending dose to 30 minutes from now (inside the 2-hour early window).
    const pending = doses.filter((d: any) => d.status === 'Pending');
    const due = pending[pending.length - 1];
    await sys(() => MedicationDose.updateOne({ _id: due._id }, { scheduledAt: new Date(now + 30 * 60_000) }).exec());
    const ok = await patient.post(`/api/medications/doses/${due._id}`, { status: 'Taken' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'Taken', recordedBy: 'Patient' });
    await patient.post(`/api/medications/doses/${due._id}`, { status: 'Taken' }).expect(422);
    const future = pending.find((d: any) => d._id !== due._id && Date.parse(d.scheduledAt) > now + 3 * HOUR);
    const early = await patient.post(`/api/medications/doses/${future._id}`, { status: 'Taken' });
    expect(early.status).toBe(422);
    s.futureDose = future;
  });

  it('staff without medication rights are refused; the patient cannot reach another record', async () => {
    await reception.get(`/api/medications/patients/${s.patientId}`).expect(403);
    await reception.post(`/api/medications/doses/${s.futureDose._id}`, { status: 'Taken' }).expect(403);
    await patient.get(`/api/medications/patients/${s.patientId}`).expect(403);
    const other = await sys(() => MedicationSchedule.findOne({ patientId: { $ne: s.patientId } }).lean().exec());
    if (other) await patient.get(`/api/medications/schedules/${other._id}/doses`).expect(403);
  });

  it('reminder times can be changed; future doses are re-planned with the same count', async () => {
    const before = await sys(() => MedicationDose.countDocuments({ scheduleId: s.metformin._id, status: 'Pending', scheduledAt: { $gt: new Date() } }).exec());
    await patient.put(`/api/medications/schedules/${s.metformin._id}/times`, { times: ['07:30'] }).expect(422); // twice daily needs two
    const res = await patient.put(`/api/medications/schedules/${s.metformin._id}/times`, { times: ['21:00', '07:30'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.times).toEqual(['07:30', '21:00']);
    const after = await sys(() => MedicationDose.find({ scheduleId: s.metformin._id, status: 'Pending', scheduledAt: { $gt: new Date() } }).lean().exec());
    expect(after).toHaveLength(before);
    expect(after.every((d) => ['07:30', '21:00'].includes(d.scheduledAt.toTimeString().slice(0, 5)))).toBe(true);
  });

  it('only clinical staff can stop a medicine; stopping cancels pending doses and tells the patient', async () => {
    const amox = (await patient.get('/api/medications/mine')).body.schedules.find((x: any) => x.medicineName === 'Amlodipine 5mg');
    await patient.post(`/api/medications/schedules/${amox._id}/stop`, { reason: 'Feeling better' }).expect(403);
    await pharmacist.post(`/api/medications/schedules/${amox._id}/stop`, { reason: 'x' }).expect(400);
    const res = await pharmacist.post(`/api/medications/schedules/${amox._id}/stop`, { reason: 'Rash — switched by doctor' });
    expect(res.body.status).toBe('Stopped');
    expect(await sys(() => MedicationDose.countDocuments({ scheduleId: amox._id, status: 'Pending' }).exec())).toBe(0);
    const notes = (await patient.get('/api/notifications')).body.items;
    expect(notes.some((n: any) => n.title === 'Medicine stopped')).toBe(true);
  });

  it('the reminder engine sends due reminders, marks missed doses and alerts the prescriber', async () => {
    const hid = (await sys(() => Hospital.findOne({}).lean().exec()))!._id;
    // Jump 3 days ahead: everything due by then is reminded or missed.
    const later = new Date(Date.now() + 3 * 24 * HOUR);
    const result = await runWithContext({ roles: [], permissions: new Set(), hospitalId: hid }, () => runMedicationPass(later));
    expect(result.missed).toBeGreaterThan(0);
    expect(result.missedAlerts).toBeGreaterThan(0);
    const missedNote = await runWithContext({ roles: [], permissions: new Set(), hospitalId: hid }, () => Notification.findOne({ type: 'MissedDose', userId: { $ne: null } }).lean().exec());
    expect(missedNote?.priority).toBe('High');
    // Idempotent: a second pass does not alert the same schedules again.
    const again = await runWithContext({ roles: [], permissions: new Set(), hospitalId: hid }, () => runMedicationPass(later));
    expect(again.missedAlerts).toBe(0);
    const mine = (await patient.get('/api/notifications')).body.items;
    expect(mine.some((n: any) => n.type === 'MissedDose'), JSON.stringify(mine.map((n: any) => n.type))).toBe(true);
  });
});

describe('Reports: catalogue, filters, exports and permissions', () => {
  const from = new Date(Date.now() - 60 * 24 * HOUR).toLocaleDateString('en-CA');
  const to = new Date().toLocaleDateString('en-CA');

  it('every report runs and returns a consistent table', async () => {
    const list = (await superadmin.get('/api/reports')).body;
    expect(list.map((r: any) => r.key).sort()).toEqual(REPORTS.map((r) => r.key).sort());
    for (const r of REPORTS) {
      const res = await superadmin.get(`/api/reports/${r.key}?from=${from}&to=${to}`);
      expect(res.status, `${r.key}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(200);
      expect(res.body.columns.length).toBeGreaterThan(1);
      expect(Array.isArray(res.body.rows)).toBe(true);
      for (const row of res.body.rows.slice(0, 3)) for (const c of res.body.columns) expect(row).toHaveProperty(c.key);
    }
  });

  it('reports contain real data and honour filters', async () => {
    const inflow = (await superadmin.get(`/api/reports/patient-inflow?from=${from}&to=${to}`)).body;
    expect(inflow.totals.total).toBeGreaterThan(0);
    const appts = (await superadmin.get(`/api/reports/doctor-appointments?from=${from}&to=${to}`)).body;
    expect(appts.rows.length).toBeGreaterThan(0);
    const depts = (await superadmin.get('/api/admin/departments')).body;
    const cardio = depts.find((d: any) => d.code === 'CARD');
    const filtered = (await superadmin.get(`/api/reports/doctor-appointments?from=${from}&to=${to}&departmentId=${cardio._id}`)).body;
    expect(filtered.totals.total).toBeLessThan(appts.totals.total);
    expect(filtered.subtitle).toContain('Cardiology');
    const stock = (await superadmin.get('/api/reports/pharmacy-stock')).body;
    expect(stock.rows.some((r: any) => r.status === 'Reorder')).toBe(true);
    const expiry = (await superadmin.get('/api/reports/medicine-expiry')).body;
    expect(expiry.rows.some((r: any) => r.status === 'Expired')).toBe(true);
    const payroll = (await superadmin.get(`/api/reports/payroll-summary?from=${from}&to=${to}`)).body;
    expect(payroll.totals.net).toBeGreaterThan(0);
    const adherence = (await superadmin.get(`/api/reports/medication-adherence?from=${from}&to=${to}`)).body;
    expect(adherence.rows.some((r: any) => r.medicine === 'Metformin 500mg')).toBe(true);
  });

  it('exports to Excel, PDF and CSV', async () => {
    const xlsx = await superadmin.get(`/api/reports/revenue-department?from=${from}&to=${to}&format=xlsx`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const pdf = await superadmin.get(`/api/reports/staff-attendance?from=${from}&to=${to}&format=pdf`);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const csv = await superadmin.get(`/api/reports/outstanding?from=${from}&to=${to}&format=csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.replace('﻿', '').split('\r\n')[0]).toBe('Invoice,Patient,MRN,Source,Issued,Total,Paid,Balance,Age (days),Ageing');
    const exported = await AuditLog.find({ action: 'report.exported' }).lean();
    expect(exported.length).toBeGreaterThanOrEqual(3);
  });

  it('validates input and enforces per-report permissions', async () => {
    await superadmin.get('/api/reports/not-a-report').expect(400);
    await superadmin.get(`/api/reports/patient-inflow?from=${to}&to=${from}`).expect(400);
    const nurseList = (await nurse.get('/api/reports')).body.map((r: any) => r.key);
    expect(nurseList).toContain('medication-adherence');
    expect(nurseList).not.toContain('revenue-department');
    await nurse.get(`/api/reports/revenue-department?from=${from}&to=${to}`).expect(403);
    await accounts.get(`/api/reports/revenue-department?from=${from}&to=${to}`).expect(200);
    await accounts.get(`/api/reports/staff-attendance?from=${from}&to=${to}`).expect(403);
    await hr.get(`/api/reports/staff-attendance?from=${from}&to=${to}`).expect(200);
    await hr.get(`/api/reports/revenue-doctor?from=${from}&to=${to}`).expect(403);
    expect((await patient.get('/api/reports')).body).toEqual([]);
  });
});
