import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { connectDb, disconnectDb } from '../src/core/db';
import { seed } from '../src/seed/seed';
import { createApp } from '../src/app';
import { AuditLog } from '../src/core/audit/audit';
import { Admission } from '../src/modules/ipd/ipd.models';
import { runWithContext } from '../src/core/context';
import { PASSWORD, signIn, type Session } from './helpers';

let app: Express;
let admin: Session, reception: Session, nurse: Session, doctor: Session, accounts: Session;
const s: Record<string, any> = {};

/** First Available bed in a ward (by code) from the live bed board. */
async function availableBed(session: Session, wardCode: string, skip: string[] = []) {
  const board = (await session.get('/api/ipd/beds/board')).body;
  const ward = board.wards.find((w: any) => w.code === wardCode);
  for (const r of ward.rooms) for (const b of r.beds) if (b.status === 'Available' && !skip.includes(b._id)) return b;
  throw new Error(`No available bed in ${wardCode}`);
}

beforeAll(async () => {
  await connectDb(process.env.MONGODB_URI!);
  await seed(PASSWORD);
  app = createApp();
  [admin, reception, nurse, doctor, accounts] = await Promise.all(['admin', 'reception', 'nurse', 'doctor', 'accounts'].map((r) => signIn(app, `${r}@hospital.com`)));
  s.doctorId = (await doctor.get('/api/auth/me')).body.doctorId;
});

afterAll(async () => {
  await disconnectDb();
});

describe('Emergency department', () => {
  it('registers an unknown patient in one step with a provisional record and ER case number', async () => {
    const res = await reception.post('/api/emergency/cases', { name: 'Unknown', gender: 'Male', age: 40, arrivalMode: 'Ambulance', presentingComplaint: 'Fall from height, leg deformity' });
    expect(res.status).toBe(201);
    expect(res.body.caseNo).toMatch(/^ER-\d{4}-\d{6}$/);
    expect(res.body.status).toBe('Registered');
    s.er = res.body;
    const p = (await reception.get(`/api/patients/${res.body.patient.id}`)).body;
    expect(p.isProvisional).toBe(true);
    expect(p.mrn).toMatch(/^SH-\d{4}-\d{6}$/);

    const dup = await reception.post('/api/emergency/cases', { patientId: res.body.patient.id, presentingComplaint: 'Same patient again' });
    expect(dup.status).toBe(422);
    expect(dup.body.code).toBe('duplicate_er_case');
  });

  it('attaches the case to an existing patient when the CNIC matches', async () => {
    const existing = (await reception.get('/api/patients?pageSize=50')).body.items.find((p: any) => p.cnic && !p.isProvisional);
    const res = await reception.post('/api/emergency/cases', { name: 'Typed Differently', gender: 'Male', cnic: existing.cnic, presentingComplaint: 'Asthma attack', triageLevel: 'Urgent' });
    expect(res.status).toBe(201);
    expect(res.body.patient.id).toBe(existing.id);
    expect(res.body.status).toBe('Triaged');
    s.er2 = res.body;
  });

  it('nurse triages Critical with vitals; doctors are alerted and the board puts the case first', async () => {
    const t = await nurse.post(`/api/emergency/cases/${s.er._id}/triage`, {
      level: 'Critical',
      notes: 'Open fracture, hypotensive',
      vitals: { systolicBp: 85, diastolicBp: 55, heartRate: 128, temperatureC: 36.4, spo2: 93, weightKg: 75, heightCm: 175, painScale: 9 },
    });
    expect(t.status).toBe(200);
    expect(t.body.triageLevel).toBe('Critical');
    const alerts = (await doctor.get('/api/notifications')).body.items;
    expect(alerts.some((n: any) => n.type === 'EmergencyAlert' && n.priority === 'Critical')).toBe(true);
    const board = (await reception.get('/api/emergency/board')).body;
    expect(board.cases[0].triageLevel).toBe('Critical');
    expect(board.today.byTriage.Critical).toBeGreaterThanOrEqual(1);
  });

  it('only doctors take cases; disposition needs treatment first', async () => {
    await reception.post(`/api/emergency/cases/${s.er._id}/take`).expect(403);
    const early = await doctor.post(`/api/emergency/cases/${s.er._id}/disposition`, { type: 'Discharged', notes: 'Fine' });
    expect(early.status).toBe(409);
    const take = await doctor.post(`/api/emergency/cases/${s.er._id}/take`);
    expect(take.body.status).toBe('InTreatment');
    expect(take.body.assignedDoctorName).toBeTruthy();
    await doctor.post(`/api/emergency/cases/${s.er._id}/notes`, { note: 'Splinted, IV fluids, analgesia. Ortho consult.' }).expect(200);
    await reception.post(`/api/emergency/cases/${s.er._id}/disposition`, { type: 'Discharged', notes: 'x x' }).expect(403); // non-doctor
  });

  it('admits from ER into a bed in one transaction, bills the emergency consultation', async () => {
    const bed = await availableBed(doctor, 'GEN-M');
    const res = await doctor.post(`/api/emergency/cases/${s.er._id}/disposition`, { type: 'Admitted', notes: 'Admit under ortho', admission: { bedId: bed._id, reason: 'Open fracture of tibia' } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Admitted');
    expect(res.body.disposition.admissionId).toBeTruthy();
    expect(res.body.invoiceId).toBeTruthy();
    s.erAdmissionId = res.body.disposition.admissionId;
    const board = (await reception.get('/api/ipd/beds/board')).body;
    const b = board.wards.flatMap((w: any) => w.rooms.flatMap((r: any) => r.beds)).find((x: any) => x._id === bed._id);
    expect(b.status).toBe('Occupied');
    expect(b.occupant.admissionId).toBe(s.erAdmissionId);
    const inv = (await accounts.get(`/api/billing/invoices/${res.body.invoiceId}`)).body;
    expect(inv.source).toBe('Emergency');
    expect(inv.total).toBe(2500);
  });

  it('left-without-being-seen needs no doctor and creates no charge', async () => {
    const res = await reception.post(`/api/emergency/cases/${s.er2._id}/disposition`, { type: 'LeftWithoutBeingSeen', notes: 'Not present when called' });
    expect(res.status).toBe(200);
    expect(res.body.invoiceId).toBeUndefined();
  });
});

describe('Admissions / IPD', () => {
  it('admits directly; the same patient or bed cannot be double-admitted', async () => {
    const patient = (await reception.get('/api/patients?pageSize=50')).body.items.find((p: any) => !p.isProvisional && p.mrn.endsWith('020'));
    const bed = await availableBed(reception, 'GEN-F');
    const res = await reception.post('/api/ipd/admissions', { patientId: patient.id, bedId: bed._id, attendingDoctorId: s.doctorId, reason: 'Observation after syncope', source: 'OPD' });
    expect(res.status).toBe(201);
    expect(res.body.admissionNo).toMatch(/^ADM-\d{4}-\d{6}$/);
    s.adm = res.body;
    s.bed1 = bed._id;
    const again = await reception.post('/api/ipd/admissions', { patientId: patient.id, bedId: (await availableBed(reception, 'GEN-F', [bed._id]))._id, attendingDoctorId: s.doctorId, reason: 'dup' });
    expect(again.status).toBe(409);
    const other = (await reception.get('/api/patients?pageSize=50')).body.items.find((p: any) => !p.isProvisional && p.mrn.endsWith('021'));
    const taken = await reception.post('/api/ipd/admissions', { patientId: other.id, bedId: bed._id, attendingDoctorId: s.doctorId, reason: 'x x' });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('bed_unavailable');
  });

  it('transfers between beds; the old bed goes to cleaning; occupancy cannot be set by hand', async () => {
    const target = await availableBed(reception, 'PVT');
    const t = await reception.post(`/api/ipd/admissions/${s.adm._id}/transfer`, { bedId: target._id, reason: 'Patient request (private room)' });
    expect(t.status).toBe(200);
    expect(t.body.stays).toHaveLength(2);
    const board = (await reception.get('/api/ipd/beds/board')).body;
    const beds = board.wards.flatMap((w: any) => w.rooms.flatMap((r: any) => r.beds));
    expect(beds.find((b: any) => b._id === s.bed1).status).toBe('Cleaning');
    expect(beds.find((b: any) => b._id === target._id).status).toBe('Occupied');
    await reception.post(`/api/ipd/beds/${s.bed1}/status`, { status: 'Occupied' }).expect(422);
    await nurse.post(`/api/ipd/beds/${s.bed1}/status`, { status: 'Available', note: 'Cleaned' }).expect(200);
  });

  it('nurses and doctors write ward notes; reception cannot', async () => {
    await nurse.post(`/api/ipd/admissions/${s.adm._id}/notes`, { note: 'Vitals stable overnight, slept well' }).expect(200);
    await doctor.post(`/api/ipd/admissions/${s.adm._id}/notes`, { note: 'Ward round: plan discharge tomorrow' }).expect(200);
    await reception.post(`/api/ipd/admissions/${s.adm._id}/notes`, { note: 'Hello' }).expect(403);
    const adm = (await doctor.get(`/api/ipd/admissions/${s.adm._id}`)).body;
    expect(adm.notes.map((n: any) => n.kind)).toEqual(expect.arrayContaining(['Nursing', 'Progress', 'Event']));
    const acc = (await accounts.get(`/api/ipd/admissions/${s.adm._id}`)).body;
    expect(acc.notes.every((n: any) => n.kind === 'Event')).toBe(true); // billing staff don't see clinical notes
  });

  it('only the attending doctor discharges; bed-day charges per ward are billed; summary PDF', async () => {
    // Back-date: 2 days in the general ward, then 1 day in the private room.
    await runWithContext({ roles: [], permissions: new Set(), system: true }, async () => {
      const a = await Admission.findById(s.adm._id);
      const now = Date.now();
      a!.admittedAt = new Date(now - 72 * 3_600_000);
      a!.stays[0].from = new Date(now - 72 * 3_600_000);
      a!.stays[0].to = new Date(now - 24 * 3_600_000);
      a!.stays[1].from = new Date(now - 24 * 3_600_000);
      await a!.save();
    });
    const body = { type: 'Routine', finalDiagnosis: 'Vasovagal syncope', treatmentGiven: 'Observation, IV fluids', conditionAtDischarge: 'Stable' };
    await reception.post(`/api/ipd/admissions/${s.adm._id}/discharge`, body).expect(403);
    const res = await doctor.post(`/api/ipd/admissions/${s.adm._id}/discharge`, body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Discharged');
    const inv = (await accounts.get(`/api/billing/invoices/${res.body.invoiceId}`)).body;
    expect(inv.source).toBe('IPD');
    expect(inv.items.map((i: any) => [i.quantity, i.unitPrice])).toEqual([[2, 5000], [1, 15000]]);
    expect(inv.total).toBe(25000);
    const pdf = await doctor.get(`/api/ipd/admissions/${s.adm._id}/discharge-summary.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    await doctor.post(`/api/ipd/admissions/${s.adm._id}/discharge`, body).expect(422); // already discharged
  });
});

describe('Insurance claims', () => {
  it('claims an invoice within coverage % and the policy limit; one live claim per invoice', async () => {
    const reg = await reception.post('/api/patients', {
      firstName: 'Insured',
      lastName: 'Member',
      dateOfBirth: '1980-05-05',
      gender: 'Female',
      phone: '+92 300 4440001',
      insurance: { provider: 'Jubilee Health', policyNumber: 'JH-777', coveragePercent: 80, coverageLimit: 5000, expiresOn: '2030-12-31' },
    });
    expect(reg.status).toBe(201);
    s.insured = reg.body;
    const inv = await accounts.post('/api/billing/invoices', { patientId: reg.body.id, source: 'Procedure', items: [{ description: 'Minor procedure', quantity: 1, unitPrice: 5000 }] });
    s.inv = inv.body;
    const eligible = (await accounts.get('/api/insurance/eligible-invoices')).body;
    expect(eligible.some((i: any) => i._id === inv.body._id)).toBe(true);

    const over = await accounts.post('/api/insurance/claims', { invoiceId: inv.body._id, claimAmount: 4500 });
    expect(over.status).toBe(422); // 80% of 5000 = 4000
    const claim = await accounts.post('/api/insurance/claims', { invoiceId: inv.body._id });
    expect(claim.status).toBe(201);
    expect(claim.body.claimNo).toMatch(/^CLM-\d{4}-\d{5}$/);
    expect(claim.body.claimAmount).toBe(4000);
    s.claim = claim.body;
    const dup = await accounts.post('/api/insurance/claims', { invoiceId: inv.body._id });
    expect(dup.status).toBe(409);
  });

  it('runs submit → partial approval → settlement, posting an insurance payment on the invoice', async () => {
    await accounts.post(`/api/insurance/claims/${s.claim._id}/paid`, { amount: 100, payerReference: 'X1' }).expect(409); // not approved yet
    await accounts.post(`/api/insurance/claims/${s.claim._id}/submit`).expect(200);
    await accounts.post(`/api/insurance/claims/${s.claim._id}/review`).expect(200);
    const bad = await accounts.post(`/api/insurance/claims/${s.claim._id}/decision`, { decision: 'PartiallyApproved', approvedAmount: 4000 });
    expect(bad.status).toBe(422);
    const d = await accounts.post(`/api/insurance/claims/${s.claim._id}/decision`, { decision: 'PartiallyApproved', approvedAmount: 3000, notes: 'Consumables excluded' });
    expect(d.body).toMatchObject({ status: 'PartiallyApproved', approvedAmount: 3000, rejectedAmount: 1000 });
    await accounts.post(`/api/insurance/claims/${s.claim._id}/paid`, { amount: 3500, payerReference: 'REM-1' }).expect(422);
    const paid = await accounts.post(`/api/insurance/claims/${s.claim._id}/paid`, { amount: 3000, payerReference: 'REM-1' });
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('Paid');
    const inv = (await accounts.get(`/api/billing/invoices/${s.inv._id}`)).body;
    expect(inv.paid).toBe(3000);
    expect(inv.balance).toBe(2000); // patient's share
    expect(inv.payments[0]).toMatchObject({ method: 'Insurance', reference: s.claim.claimNo });
    await accounts.post(`/api/insurance/claims/${s.claim._id}/paid`, { amount: 1, payerReference: 'REM-2' }).expect(409);
  });

  it('enforces the remaining coverage limit and supports reject → reopen', async () => {
    const inv2 = await accounts.post('/api/billing/invoices', { patientId: s.insured.id, source: 'Procedure', items: [{ description: 'Dressing', quantity: 1, unitPrice: 3000 }] });
    const tooMuch = await accounts.post('/api/insurance/claims', { invoiceId: inv2.body._id, claimAmount: 2400 });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.code).toBe('limit_exceeded'); // 5000 limit − 3000 used = 2000 left
    const c2 = await accounts.post('/api/insurance/claims', { invoiceId: inv2.body._id });
    expect(c2.body.claimAmount).toBe(2000);
    await accounts.post(`/api/insurance/claims/${c2.body._id}/submit`).expect(200);
    const rej = await accounts.post(`/api/insurance/claims/${c2.body._id}/decision`, { decision: 'Rejected', notes: 'Pre-authorisation missing' });
    expect(rej.body).toMatchObject({ status: 'Rejected', rejectedAmount: 2000 });
    const reopen = await accounts.post(`/api/insurance/claims/${c2.body._id}/reopen`);
    expect(reopen.body.status).toBe('Draft');
  });

  it('refuses expired policies and non-billing roles', async () => {
    const reg = await reception.post('/api/patients', { firstName: 'Expired', lastName: 'Policy', dateOfBirth: '1975-01-01', gender: 'Male', phone: '+92 300 4440002', insurance: { provider: 'State Life', policyNumber: 'SL-1', coveragePercent: 100, expiresOn: '2020-01-01' } });
    const inv = await accounts.post('/api/billing/invoices', { patientId: reg.body.id, source: 'Other', items: [{ description: 'Service', quantity: 1, unitPrice: 1000 }] });
    const c = await accounts.post('/api/insurance/claims', { invoiceId: inv.body._id });
    expect(c.status).toBe(422);
    expect(c.body.code).toBe('policy_expired');
    await nurse.get('/api/insurance/claims').expect(403);
  });
});

describe('Phase 3 cross-cutting', () => {
  it('dashboards report emergency and admission figures; actions are audited', async () => {
    const dash = (await admin.get('/api/dashboard/summary?preset=today')).body;
    expect(dash.kpis.emergencyCases).toBeGreaterThanOrEqual(2);
    expect(dash.kpis.todaysAdmissions).toBeGreaterThanOrEqual(2);
    expect(dash.kpis.bedOccupancyPct).toBeGreaterThan(0);
    const actions = await AuditLog.distinct('action');
    for (const a of ['emergency.registered', 'emergency.triaged', 'emergency.disposition', 'patient.admitted', 'patient.transferred', 'patient.discharged', 'claim.created', 'claim.approved', 'claim.paid']) {
      expect(actions).toContain(a);
    }
  });
});
