import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { connectDb, disconnectDb } from '../src/core/db';
import { runWithContext } from '../src/core/context';
import { seed } from '../src/seed/seed';
import { createApp } from '../src/app';
import { AuditLog } from '../src/core/audit/audit';
import { Hospital } from '../src/modules/organization/organization.models';
import { Notification } from '../src/modules/notifications/notification.model';
import { runPaymentReminders } from '../src/modules/billing/billing.jobs';
import { PASSWORD, freeSlot, localToday, signIn, type Session } from './helpers';

/**
 * The full demonstration journey, exactly as a hospital would run it, over the real HTTP API:
 * reception → appointment → nurse → doctor (diagnosis, prescription, lab order) → laboratory
 * (process, verify) → doctor review → pharmacy (FEFO dispense, stock) → billing (payment, receipt,
 * refund) → patient portal — with role restrictions, duplicate-submission protection, consent and
 * audit checked along the way.
 */
let app: Express;
let admin: Session, reception: Session, nurse: Session, doctor: Session, lab: Session, labsup: Session, pharmacy: Session, accounts: Session, otherPatient: Session;
const s: Record<string, any> = {};
const DAY = 86_400_000;
const asHospital = async <T>(fn: () => Promise<T>) => {
  const h = await runWithContext({ roles: [], permissions: new Set(), system: true }, () => Hospital.findOne({}).lean().exec());
  return runWithContext({ roles: [], permissions: new Set(), hospitalId: h!._id }, fn);
};

beforeAll(async () => {
  await connectDb(process.env.MONGODB_URI!);
  await seed(PASSWORD);
  app = createApp();
  [admin, reception, nurse, doctor, lab, labsup, pharmacy, accounts, otherPatient] = await Promise.all(
    ['admin', 'reception', 'nurse', 'doctor', 'lab', 'labsupervisor', 'pharmacy', 'accounts', 'patient'].map((r) => signIn(app, `${r}@hospital.com`)),
  );
  s.doctorId = (await doctor.get('/api/auth/me')).body.doctorId;
  await admin.patch(`/api/admin/doctors/${s.doctorId}`, { dutyStart: '00:00', dutyEnd: '23:59', workingDays: [1, 2, 3, 4, 5, 6, 7] }).expect(200);
});

afterAll(async () => {
  await disconnectDb();
});

describe('End-to-end: registration → consultation → lab → pharmacy → billing → portal', () => {
  it('1. reception registers the patient (unique MRN, duplicate CNIC refused)', async () => {
    const body = { firstName: 'Zara', lastName: 'Demo', fatherHusbandName: 'Imran Demo', cnic: '42101-5550123-4', dateOfBirth: '1986-07-14', gender: 'Female', phone: '+92 300 5550123', email: 'zara.demo@example.com', city: 'Karachi', bloodGroup: 'B+' };
    const res = await reception.post('/api/patients', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.mrn).toMatch(/^SH-\d{4}-\d{6}$/);
    s.patient = res.body;
    const dup = await reception.post('/api/patients', { ...body, firstName: 'Other' });
    expect(dup.status).toBe(409);
  });

  it('2. an appointment is booked; the same slot cannot be booked twice', async () => {
    s.slot = await freeSlot(reception, s.doctorId);
    const appt = await reception.post('/api/appointments', { patientId: s.patient.id, doctorId: s.doctorId, date: localToday(), startTime: s.slot, type: 'New', reason: 'Fever and body aches for 3 days' });
    expect(appt.status, JSON.stringify(appt.body)).toBe(201);
    s.appt = appt.body;
    const other = (await reception.get('/api/patients?pageSize=5')).body.items.find((p: any) => p.id !== s.patient.id);
    await reception.post('/api/appointments', { patientId: other.id, doctorId: s.doctorId, date: localToday(), startTime: s.slot }).expect(409);
    await reception.post(`/api/appointments/${appt.body.id}/check-in`).expect(200);
  });

  it('3. the nurse records vitals; BMI is calculated and abnormal values flagged', async () => {
    await nurse.post(`/api/clinical/nursing/appointments/${s.appt.id}/start`).expect(200);
    const res = await nurse.post(`/api/clinical/nursing/appointments/${s.appt.id}/submit`, {
      vitals: { systolicBp: 128, diastolicBp: 84, heartRate: 104, temperatureC: 38.9, spo2: 97, weightKg: 68, heightCm: 162, painScale: 4 },
      symptoms: 'Fever, myalgia, headache',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.assessment.vitalSignId.bmi).toBe(25.9);
    expect(res.body.assessment.vitalSignId.flags).toEqual(expect.arrayContaining(['TEMP', 'HR'])); // fever and tachycardia highlighted
    expect(res.body.appointment.status).toBe('WaitingForDoctor');
  });

  it('4. the doctor sees the patient, reviews vitals, writes notes (versioned) and a diagnosis', async () => {
    const q = (await doctor.get('/api/clinical/doctor/queue')).body;
    expect(q.waiting.some((a: any) => a.id === s.appt.id)).toBe(true);
    const ctx = (await doctor.post(`/api/clinical/doctor/appointments/${s.appt.id}/start`)).body;
    s.visitId = ctx.visitId;
    expect(ctx.assessment.vitalSignId.temperatureC).toBe(38.9);
    await pharmacy.put(`/api/clinical/visits/${s.visitId}/note`, { chiefComplaint: 'x', clinicalNotes: 'pharmacist edit' }).expect(403);
    await doctor.put(`/api/clinical/visits/${s.visitId}/note`, { chiefComplaint: 'Fever x3 days', clinicalNotes: 'Febrile, throat congested. Suspect viral fever; rule out dengue.' }).expect(200);
    const amended = await doctor.put(`/api/clinical/visits/${s.visitId}/note`, { chiefComplaint: 'Fever x3 days', clinicalNotes: 'Febrile, throat congested, no rash. Suspect viral fever; rule out dengue.', amendmentReason: 'Added skin examination' });
    expect(amended.body.versions).toHaveLength(1);
    expect(amended.body.versions[0].content).toContain('rule out dengue');
    expect(amended.body.amendmentReason).toBe('Added skin examination');
    await doctor.post(`/api/clinical/visits/${s.visitId}/diagnoses`, { icdCode: 'B34.9', description: 'Viral infection, unspecified', type: 'Provisional' }).expect(201);
  });

  it('5. the doctor prescribes (sent to pharmacy, reminders scheduled) and orders a lab test', async () => {
    const para = (await doctor.get('/api/pharmacy/formulary?search=paracetamol')).body[0];
    s.para = para;
    const rx = await doctor.post(`/api/clinical/visits/${s.visitId}/prescriptions`, {
      items: [{ medicineId: para._id, medicineName: para.name, dosage: '1 tablet', frequency: 'Three times daily', timesPerDay: 3, durationDays: 3, quantity: 9, instructions: 'After meals' }],
    });
    expect(rx.status, JSON.stringify(rx.body)).toBe(201);
    s.rx = rx.body;
    const schedules = (await doctor.get(`/api/medications/patients/${s.patient.id}`)).body;
    expect(schedules.find((x: any) => x.prescriptionNo === rx.body.prescriptionNo)?.totalDoses).toBe(9);
    const tests = (await doctor.get('/api/laboratory/tests')).body;
    const cbc = tests.find((t: any) => t.code === 'CBC');
    const order = await doctor.post(`/api/laboratory/visits/${s.visitId}/orders`, { testIds: [cbc._id], priority: 'Urgent', clinicalNotes: 'Fever — rule out thrombocytopenia' });
    expect(order.status).toBe(201);
    s.order = order.body;
    await doctor.post(`/api/clinical/doctor/appointments/${s.appt.id}/complete`, { followUpDate: new Date(Date.now() + 5 * DAY).toLocaleDateString('en-CA') }).expect(200);
  });

  it('6. the laboratory processes, enters results and a second person verifies', async () => {
    await lab.post(`/api/laboratory/orders/${s.order._id}/receive`).expect(200);
    await lab.post(`/api/laboratory/orders/${s.order._id}/collect`, { sampleType: 'Blood' }).expect(200);
    await lab.post(`/api/laboratory/orders/${s.order._id}/start`).expect(200);
    const order = (await lab.get(`/api/laboratory/orders/${s.order._id}`)).body;
    const cbc = order.items[0];
    const res = await lab.put(`/api/laboratory/orders/${s.order._id}/results`, {
      results: [
        { itemId: cbc._id, parameter: 'Haemoglobin', value: '12.9' },
        { itemId: cbc._id, parameter: 'WBC', value: '3.6' },
        { itemId: cbc._id, parameter: 'Platelets', value: '118' },
        { itemId: cbc._id, parameter: 'Neutrophils', value: '48' },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hasAbnormal).toBe(true);
    await lab.post(`/api/laboratory/orders/${s.order._id}/verify`).expect(403); // same technician
    await labsup.post(`/api/laboratory/orders/${s.order._id}/verify`).expect(200);
    const pdf = await labsup.get(`/api/laboratory/orders/${s.order._id}/report`);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });

  it('7. the doctor is notified and reviews the verified result', async () => {
    const notes = (await doctor.get('/api/notifications')).body.items;
    expect(notes.some((n: any) => n.type === 'LabResultAvailable' && n.message.includes(s.order.orderNo))).toBe(true);
    await doctor.post(`/api/laboratory/orders/${s.order._id}/review`).expect(200);
  });

  it('8. the pharmacy dispenses by FEFO once — a retried request does not dispense twice', async () => {
    const before = (await pharmacy.get(`/api/inventory/items/${s.para._id}`)).body.item.currentStock;
    const ctx = (await pharmacy.get(`/api/pharmacy/prescriptions/${s.rx._id}`)).body;
    const line = ctx.lines[0];
    expect(line.fefo.shortfall ?? 0).toBe(0);
    const body = { lines: [{ prescriptionItemId: line.prescriptionItemId, itemId: line.item._id, quantity: 9 }] };
    const key = 'e2e-dispense-0001';
    const first = await pharmacy.agent.post(`/api/pharmacy/prescriptions/${s.rx._id}/dispense`).set('X-Requested-With', 'hms').set('Idempotency-Key', key).send(body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const retry = await pharmacy.agent.post(`/api/pharmacy/prescriptions/${s.rx._id}/dispense`).set('X-Requested-With', 'hms').set('Idempotency-Key', key).send(body);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.dispense.dispenseNo).toBe(first.body.dispense.dispenseNo);
    const after = (await pharmacy.get(`/api/inventory/items/${s.para._id}`)).body.item.currentStock;
    expect(after).toBe(before - 9);
    const ledger = (await pharmacy.get(`/api/inventory/items/${s.para._id}`)).body;
    expect(JSON.stringify(ledger)).toContain(first.body.dispense.dispenseNo);
    // Without a key a second attempt is refused by business rules (nothing left to dispense).
    await pharmacy.post(`/api/pharmacy/prescriptions/${s.rx._id}/dispense`, body).expect(422);
  });

  it('9. billing was generated automatically for consultation, laboratory and pharmacy', async () => {
    const inv = (await accounts.get(`/api/billing/invoices?patientId=${s.patient.id}`)).body.items;
    const sources = inv.map((i: any) => i.source).sort();
    expect(sources).toEqual(['Laboratory', 'OPD', 'Pharmacy']);
    s.invoices = inv;
  });

  it('10. payments are recorded exactly once (idempotent), receipts printed, refunds controlled', async () => {
    const opd = s.invoices.find((i: any) => i.source === 'OPD');
    const key = 'e2e-payment-0001';
    const pay = (k: string, amount: number) => accounts.agent.post(`/api/billing/invoices/${opd._id}/payments`).set('X-Requested-With', 'hms').set('Idempotency-Key', k).send({ amount, method: 'Cash' });
    const half = Math.round(opd.total / 2);
    const p1 = await pay(key, half);
    expect(p1.status, JSON.stringify(p1.body)).toBe(201);
    const p1again = await pay(key, half);
    expect(p1again.headers['idempotent-replayed']).toBe('true');
    expect(p1again.body.payment.receiptNo).toBe(p1.body.payment.receiptNo);
    expect((await pay(key, half + 1)).status).toBe(422); // same key, different request
    let invoice = (await accounts.get(`/api/billing/invoices/${opd._id}`)).body;
    expect(invoice.status).toBe('PartiallyPaid');
    expect(invoice.payments).toHaveLength(1);
    await accounts.post(`/api/billing/invoices/${opd._id}/payments`, { amount: invoice.balance + 1, method: 'Cash' }).expect(422); // overpayment
    const p2 = await pay('e2e-payment-0002', invoice.balance);
    expect(p2.status).toBe(201);
    invoice = (await accounts.get(`/api/billing/invoices/${opd._id}`)).body;
    expect(invoice.status).toBe('Paid');
    const receipt = await accounts.get(`/api/billing/payments/${p2.body.payment._id}/receipt`);
    expect(receipt.headers['content-type']).toContain('application/pdf');
    await reception.post(`/api/billing/invoices/${opd._id}/refunds`, { paymentId: p2.body.payment._id, amount: 10, reason: 'Overcharge' }).expect(403);
    const refund = await accounts.post(`/api/billing/invoices/${opd._id}/refunds`, { paymentId: p2.body.payment._id, amount: 100, reason: 'Courtesy discount approved by admin' });
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    invoice = (await accounts.get(`/api/billing/invoices/${opd._id}`)).body;
    expect(invoice.balance).toBe(100);
  });

  it('11. reception enables portal access; the temporary password must be changed first', async () => {
    const res = await reception.post(`/api/patients/${s.patient.id}/portal-account`, { email: 'zara.demo@example.com' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await reception.post(`/api/patients/${s.patient.id}/portal-account`, { email: 'zara.demo@example.com' }).expect(409);
    const temp = res.body.temporaryPassword as string;
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set('X-Requested-With', 'hms').send({ email: 'zara.demo@example.com', password: temp }).expect(204);
    const blocked = await agent.get('/api/medications/mine');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('password_change_required');
    await agent.post('/api/auth/change-password').set('X-Requested-With', 'hms').send({ currentPassword: temp, newPassword: 'Zara@Portal2026', confirmPassword: 'Zara@Portal2026' }).expect((r) => expect([200, 204]).toContain(r.status));
    s.portal = await signIn(app, 'zara.demo@example.com', 'Zara@Portal2026');
  });

  it('12. the patient sees their own prescription, verified lab result, bills and reminders — nobody else’s', async () => {
    const portal: Session = s.portal;
    const emr = (await portal.get(`/api/clinical/emr/${s.patient.id}`)).body;
    expect(emr.prescriptions.some((r: any) => r.prescriptionNo === s.rx.prescriptionNo)).toBe(true);
    const labs = (await portal.get('/api/laboratory/orders')).body.items;
    expect(labs.some((o: any) => o.orderNo === s.order.orderNo && o.status === 'Verified')).toBe(true);
    const bills = (await portal.get('/api/billing/invoices')).body;
    expect(bills.items.map((i: any) => i.source).sort()).toEqual(['Laboratory', 'OPD', 'Pharmacy']);
    const meds = (await portal.get('/api/medications/mine')).body;
    expect(meds.schedules.length).toBeGreaterThan(0);
    // Isolation: another patient cannot read this record, and this patient cannot read theirs.
    await otherPatient.get(`/api/clinical/emr/${s.patient.id}`).expect(403);
    await otherPatient.get(`/api/laboratory/orders/${s.order._id}`).expect(403);
    const others = (await reception.get('/api/patients?pageSize=5')).body.items.find((p: any) => p.id !== s.patient.id);
    await portal.get(`/api/clinical/emr/${others.id}`).expect(403);
    await portal.get('/api/patients?pageSize=5').expect(403);
  });

  it('13. consent: a patient who opts out of SMS gets no SMS; undelivered channels are never reported as sent', async () => {
    const portal: Session = s.portal;
    await portal.post(`/api/patients/${s.patient.id}/consents`, { type: 'SmsMessages', granted: false }).expect(201);
    await portal.post(`/api/patients/${s.patient.id}/consents`, { type: 'Treatment', granted: true }).expect(403); // clinical consents are staff-recorded
    await reception.post(`/api/patients/${s.patient.id}/consents`, { type: 'Treatment', granted: true, method: 'Written', note: 'Signed general consent form' }).expect(201);
    const consents = (await reception.get(`/api/patients/${s.patient.id}/consents`)).body;
    expect(consents.current.find((c: any) => c.type === 'SmsMessages').granted).toBe(false);
    // Switch SMS on for the hospital, then run the overdue-balance reminder as if 10 days had passed.
    const settings = (await admin.get('/api/admin/hospital')).body;
    await admin.put('/api/admin/hospital', { ...settings, notifications: { ...settings.notifications, sms: true, email: true } }).expect(200);
    const result = await asHospital(() => runPaymentReminders(new Date(Date.now() + 10 * DAY), 7));
    expect(result.sent).toBeGreaterThan(0);
    const note = await asHospital(() => Notification.findOne({ type: 'PaymentDue', title: 'Payment reminder', patientId: s.patient.id }).lean().exec());
    const byChannel = Object.fromEntries((note?.deliveries ?? []).map((d) => [d.channel, d.status]));
    expect(byChannel).toEqual({ Sms: 'OptedOut', Email: 'Logged' }); // email: no provider configured → demo mode, not "Sent"
    const integrations = (await admin.get('/api/admin/integrations')).body;
    expect(integrations.every((i: any) => i.configured === false)).toBe(true);
  });

  it('14. every step left an audit trail', async () => {
    const actions = await AuditLog.distinct('action');
    for (const a of ['patient.registered', 'appointment.created', 'vitals.recorded', 'nursing.assessment_submitted', 'clinical_note.created', 'clinical_note.amended', 'diagnosis.created', 'prescription.created', 'lab_order.created', 'lab_result.entered', 'lab_order.status_changed', 'lab_result.reviewed', 'medicine.dispensed', 'payment.received', 'refund.processed', 'portal_access.enabled', 'consent.withdrawn', 'consent.granted']) {
      expect(actions, a).toContain(a);
    }
  });
});
