import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { connectDb, disconnectDb } from '../src/core/db';
import { seed } from '../src/seed/seed';
import { createApp } from '../src/app';
import { AuditLog } from '../src/core/audit/audit';
import { PASSWORD, freeSlot, localToday, signIn, type Session } from './helpers';

let app: Express;
let admin: Session, reception: Session, nurse: Session, doctor: Session, accounts: Session, hr: Session;

beforeAll(async () => {
  await connectDb(process.env.MONGODB_URI!);
  await seed(PASSWORD);
  app = createApp();
  [admin, reception, nurse, doctor, accounts, hr] = await Promise.all(
    ['admin', 'reception', 'nurse', 'doctor', 'accounts', 'hr'].map((r) => signIn(app, `${r}@hospital.com`)),
  );
  // Let the demo doctor work all day so the test can book "today" at any hour.
  const me = (await doctor.get('/api/auth/me')).body;
  await admin.patch(`/api/admin/doctors/${me.doctorId}`, { dutyStart: '00:00', dutyEnd: '23:59' }).expect(200);
});

afterAll(async () => {
  await disconnectDb();
});

describe('authentication & security', () => {
  it('rejects anonymous API calls', async () => {
    await request(app).get('/api/patients').expect(401);
  });

  it('rejects writes without the CSRF header', async () => {
    await reception.agent.post('/api/patients').send({}).expect(403);
  });

  it('locks the account after 5 failed logins', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').set('X-Requested-With', 'hms').send({ email: 'management@hospital.com', password: 'wrong-password' }).expect(401);
    }
    const res = await request(app).post('/api/auth/login').set('X-Requested-With', 'hms').send({ email: 'management@hospital.com', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.title).toMatch(/locked/i);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const login = await request(app).post('/api/auth/login').set('X-Requested-With', 'hms').send({ email: 'hr@hospital.com', password: PASSWORD });
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const rt = cookies.find((c) => c.startsWith('hms_rt='))!.split(';')[0];
    const first = await request(app).post('/api/auth/refresh').set('X-Requested-With', 'hms').set('Cookie', rt);
    expect(first.status).toBe(204);
    const replay = await request(app).post('/api/auth/refresh').set('X-Requested-With', 'hms').set('Cookie', rt);
    expect(replay.status).toBe(401);
  });

  it('enforces permissions at the API, not just the UI', async () => {
    await hr.get('/api/patients').expect(403); // HR cannot read patient records
    await nurse.get('/api/billing/invoices').expect(403);
    await reception.get('/api/audit').expect(403);
  });
});

describe('Phase 1 clinical workflow (acceptance criteria)', () => {
  const state: Record<string, any> = {};

  it('reception registers a patient and an MRN is generated', async () => {
    const res = await reception.post('/api/patients', {
      firstName: 'Test',
      lastName: 'Patient',
      guardianName: 'Ali Patient',
      cnic: '35202-1234567-1',
      dateOfBirth: '1985-04-12',
      gender: 'Male',
      bloodGroup: 'B+',
      phone: '+92 300 1112233',
      city: 'Lahore',
      allergies: [{ allergen: 'Penicillin', severity: 'Severe' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.mrn).toMatch(/^SH-\d{4}-\d{6}$/);
    state.patient = res.body;
  });

  it('blocks a duplicate CNIC and warns on a likely duplicate', async () => {
    const dup = await reception.post('/api/patients', { firstName: 'X', lastName: 'Y', cnic: '35202-1234567-1', dateOfBirth: '1990-01-01', gender: 'Male', phone: '+92 300 9999999' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('duplicate_patient');
    const likely = await reception.post('/api/patients', { firstName: 'Test', lastName: 'Patient', dateOfBirth: '1985-04-12', gender: 'Male', phone: '+92 300 1112233' });
    expect(likely.status).toBe(409);
    expect(likely.body.code).toBe('possible_duplicate');
  });

  it('validates input on the server', async () => {
    const res = await reception.post('/api/patients', { firstName: '', lastName: 'A', dateOfBirth: '2999-01-01', gender: 'Robot', phone: '12' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.details.fieldErrors)).toEqual(expect.arrayContaining(['firstName', 'dateOfBirth', 'gender', 'phone']));
  });

  it('reception books an appointment and double booking is prevented', async () => {
    const me = (await doctor.get('/api/auth/me')).body;
    state.doctorId = me.doctorId;
    const slot = await freeSlot(reception, me.doctorId);
    const res = await reception.post('/api/appointments', { patientId: state.patient.id, doctorId: me.doctorId, date: localToday(), startTime: slot, type: 'New', reason: 'Chest discomfort' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('Scheduled');
    state.appt = res.body;

    const other = (await reception.get('/api/patients?pageSize=5')).body.items.find((p: any) => p.id !== state.patient.id);
    const clash = await reception.post('/api/appointments', { patientId: other.id, doctorId: me.doctorId, date: localToday(), startTime: slot });
    expect(clash.status).toBe(409);
  });

  it('rejects an invalid status transition', async () => {
    const res = await doctor.post(`/api/clinical/doctor/appointments/${state.appt.id}/start`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_transition');
  });

  it('reception checks the patient in, opening a visit', async () => {
    const res = await reception.post(`/api/appointments/${state.appt.id}/check-in`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CheckedIn');
    expect(res.body.visitId).toBeTruthy();
    expect(res.body.tokenNumber).toBeGreaterThan(0);
  });

  it('nurse opens the appointment, records vitals (BMI auto-calculated) and submits', async () => {
    const queue = (await nurse.get('/api/clinical/nursing/queue')).body;
    expect(queue.some((a: any) => a.id === state.appt.id)).toBe(true);
    await nurse.post(`/api/clinical/nursing/appointments/${state.appt.id}/start`).expect(200);
    const res = await nurse.post(`/api/clinical/nursing/appointments/${state.appt.id}/submit`, {
      vitals: { systolicBp: 150, diastolicBp: 95, heartRate: 88, temperatureC: 37.1, spo2: 97, weightKg: 80, heightCm: 175, painScale: 3 },
      symptoms: 'Intermittent chest discomfort for 2 days',
    });
    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('WaitingForDoctor');
    const v = res.body.assessment.vitalSignId;
    expect(v.bmi).toBe(26.1);
    expect(v.flags).toContain('BP');
  });

  it('nurse cannot write doctor clinical notes', async () => {
    await nurse.put(`/api/clinical/visits/${state.appt.visitId ?? (await reception.get(`/api/appointments/${state.appt.id}`)).body.visitId}/note`, { chiefComplaint: 'x', clinicalNotes: 'y' }).expect(403);
  });

  it('doctor sees the patient in the queue, opens EMR and reviews vitals', async () => {
    const q = (await doctor.get('/api/clinical/doctor/queue')).body;
    expect(q.waiting.some((a: any) => a.id === state.appt.id)).toBe(true);
    const emr = await doctor.get(`/api/clinical/emr/${state.patient.id}`);
    expect(emr.status).toBe(200);
    expect(emr.body.vitals[0].systolicBp).toBe(150);
    expect(emr.body.patient.allergies[0].allergen).toBe('Penicillin');
  });

  it('doctor consults: note, diagnosis, prescription (allergy-checked), then completes', async () => {
    const ctx = (await doctor.post(`/api/clinical/doctor/appointments/${state.appt.id}/start`)).body;
    expect(ctx.appointment.status).toBe('InConsultation');
    const visitId = ctx.visitId;
    state.visitId = visitId;

    await doctor.post(`/api/clinical/doctor/appointments/${state.appt.id}/complete`, {}).expect(422); // no note/diagnosis yet

    await doctor.put(`/api/clinical/visits/${visitId}/note`, { chiefComplaint: 'Chest discomfort', clinicalNotes: 'BP elevated, ECG advised.' }).expect(200);
    await doctor.post(`/api/clinical/visits/${visitId}/diagnoses`, { icdCode: 'I10', description: 'Essential hypertension', type: 'Final' }).expect(201);

    const blocked = await doctor.post(`/api/clinical/visits/${visitId}/prescriptions`, {
      items: [{ medicineName: 'Penicillin V 250mg', dosage: '1 tablet', frequency: '4 times daily', timesPerDay: 4, durationDays: 5, quantity: 20 }],
    });
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('allergy_conflict');

    const rx = await doctor.post(`/api/clinical/visits/${visitId}/prescriptions`, {
      items: [{ medicineName: 'Amlodipine 5mg', dosage: '1 tablet', frequency: 'Once daily', timesPerDay: 1, durationDays: 30, quantity: 30, instructions: 'Morning' }],
    });
    expect(rx.status).toBe(201);
    expect(rx.body.prescriptionNo).toMatch(/^RX-\d{4}-\d{6}$/);
    state.rx = rx.body;

    const pdf = await doctor.get(`/api/clinical/prescriptions/${rx.body._id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');

    const done = await doctor.post(`/api/clinical/doctor/appointments/${state.appt.id}/complete`, { followUpDate: '2030-01-01' });
    expect(done.status).toBe(200);
    expect(done.body.appointment.status).toBe('Completed');
  });

  it('billing was generated automatically for the consultation', async () => {
    const list = (await accounts.get(`/api/billing/invoices?patientId=${state.patient.id}`)).body;
    expect(list.items).toHaveLength(1);
    expect(list.items[0].status).toBe('Issued');
    expect(list.items[0].source).toBe('OPD');
    state.invoice = list.items[0];
  });

  it('accounts records a payment; overpayment is rejected; receipt is generated', async () => {
    const over = await accounts.post(`/api/billing/invoices/${state.invoice._id}/payments`, { amount: state.invoice.total + 1, method: 'Cash' });
    expect(over.status).toBe(422);

    const part = await accounts.post(`/api/billing/invoices/${state.invoice._id}/payments`, { amount: 500, method: 'Cash' });
    expect(part.status).toBe(201);
    expect(part.body.invoice.status).toBe('PartiallyPaid');

    const rest = await accounts.post(`/api/billing/invoices/${state.invoice._id}/payments`, { amount: state.invoice.total - 500, method: 'Card', reference: 'POS-123' });
    expect(rest.body.invoice.status).toBe('Paid');
    expect(rest.body.invoice.balance).toBe(0);

    const receipt = await accounts.get(`/api/billing/payments/${rest.body.payment._id}/receipt`);
    expect(receipt.status).toBe(200);
    expect(receipt.headers['content-type']).toContain('application/pdf');

    const refund = await accounts.post(`/api/billing/invoices/${state.invoice._id}/refunds`, { paymentId: part.body.payment._id, amount: 200, reason: 'Goodwill discount' });
    expect(refund.status).toBe(201);
    expect(refund.body.invoice.status).toBe('PartiallyPaid');
    expect(refund.body.invoice.balance).toBe(200);
  });

  it('patient portal sees own prescription and billing, never another patient', async () => {
    const portal = await signIn(app, 'patient@hospital.com');
    const me = (await portal.get('/api/auth/me')).body;
    await portal.get(`/api/clinical/emr/${me.patientId}`).expect(200);
    await portal.get(`/api/clinical/emr/${state.patient.id}`).expect(403);
    await portal.get(`/api/billing/invoices/${state.invoice._id}`).expect(403);
    const own = (await portal.get('/api/billing/invoices')).body;
    expect(own.items.every((i: any) => i.patientId === me.patientId)).toBe(true);
    await portal.get('/api/patients').expect(403);
  });

  it('every sensitive step was audited', async () => {
    const actions = await AuditLog.distinct('action');
    for (const a of ['patient.registered', 'appointment.created', 'vitals.recorded', 'nursing.assessment_submitted', 'clinical_note.created', 'diagnosis.created', 'prescription.created', 'invoice.created', 'payment.received', 'refund.processed', 'emr.viewed', 'auth.login', 'auth.login_failed']) {
      expect(actions).toContain(a);
    }
    await expect(AuditLog.updateOne({}, { action: 'tampered' })).rejects.toThrow(/immutable/);
  });

  it('admin can change role permissions and dashboards respond', async () => {
    const roles = (await admin.get('/api/admin/roles')).body;
    const nurseRole = roles.find((r: any) => r.name === 'Nurse');
    const res = await admin.put(`/api/admin/roles/${nurseRole._id}`, { name: 'Nurse', description: nurseRole.description, permissions: [...nurseRole.permissions, 'billing.view'] });
    expect(res.status).toBe(200);
    const dash = await admin.get('/api/dashboard/summary?preset=month');
    expect(dash.status).toBe(200);
    expect(dash.body.kpis.totalPatients).toBeGreaterThanOrEqual(25);
    expect(dash.body.kpis.revenue).toBeGreaterThan(0);
  });
});
