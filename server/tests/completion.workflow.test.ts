import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import type { Express } from 'express';
import { connectDb, disconnectDb } from '../src/core/db';
import { runWithContext } from '../src/core/context';
import { seed } from '../src/seed/seed';
import { createApp } from '../src/app';
import { AuditLog } from '../src/core/audit/audit';
import { Hospital } from '../src/modules/organization/organization.models';
import { Role } from '../src/modules/identity/identity.models';
import { Notification } from '../src/modules/notifications/notification.model';
import { runAppointmentReminders } from '../src/modules/appointments/appointment.jobs';
import { runPaymentReminders } from '../src/modules/billing/billing.jobs';
import { runMigrations } from '../src/migrations/migrations';
import { PASSWORD, freeSlot, localToday, signIn, type Session } from './helpers';

/** Requirements completed after the phase reviews: configurable catalog, prescribe-time medication
 *  schedules, appointment reminders, lab assignment & uploads, purchase requests, report filters,
 *  today's revenue and data migrations. */
let app: Express;
let admin: Session, reception: Session, nurse: Session, doctor: Session, lab: Session, labsup: Session, pharmacy: Session, inventory: Session, accounts: Session, patient: Session;
const s: Record<string, any> = {};
const sys = <T>(fn: () => Promise<T>) => runWithContext({ roles: [], permissions: new Set(), system: true }, fn);
const asHospital = async <T>(fn: () => Promise<T>) => {
  const h = await sys(() => Hospital.findOne({}).lean().exec());
  return runWithContext({ roles: [], permissions: new Set(), hospitalId: h!._id }, fn);
};

beforeAll(async () => {
  await connectDb(process.env.MONGODB_URI!);
  await seed(PASSWORD);
  app = createApp();
  [admin, reception, nurse, doctor, lab, labsup, pharmacy, inventory, accounts, patient] = await Promise.all(
    ['admin', 'reception', 'nurse', 'doctor', 'lab', 'labsupervisor', 'pharmacy', 'inventory', 'accounts', 'patient'].map((r) => signIn(app, `${r}@hospital.com`)),
  );
  // The test doctor works around the clock, every day, so slots exist whatever time the suite runs.
  const me = (await doctor.get('/api/auth/me')).body;
  await admin.patch(`/api/admin/doctors/${me.doctorId}`, { dutyStart: '00:00', dutyEnd: '23:59', workingDays: [1, 2, 3, 4, 5, 6, 7] }).expect(200);
});

afterAll(async () => {
  await disconnectDb();
});

describe('Configurable catalog (appointment types, payment methods, medicine categories)', () => {
  it('everyone can read the catalog; admins change it in hospital settings', async () => {
    const cat = (await reception.get('/api/admin/catalog')).body;
    expect(cat.appointmentTypes.map((t: any) => t.code)).toEqual(['New', 'FollowUp']);
    expect(cat.medicationScheduleFrom).toBe('Prescribed');
    const settings = (await admin.get('/api/admin/hospital')).body;
    s.settings = settings;
    const res = await admin.put('/api/admin/hospital', {
      ...settings,
      catalog: {
        ...settings.catalog,
        appointmentTypes: [...settings.catalog.appointmentTypes, { code: 'Teleconsult', label: 'Tele-consultation', feeBasis: 'FollowUp', isActive: true }],
        paymentMethods: ['Cash', 'Card', 'Insurance'],
        medicineCategories: [...settings.catalog.medicineCategories, 'Anticoagulant'],
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await reception.put('/api/admin/hospital', settings).expect(403);
  });

  it('codes in use cannot be removed; duplicate codes are rejected', async () => {
    const cat = (await admin.get('/api/admin/catalog')).body;
    const removeNew = await admin.put('/api/admin/hospital', { ...s.settings, catalog: { ...cat, appointmentTypes: cat.appointmentTypes.filter((t: any) => t.code !== 'New') } });
    expect(removeNew.status).toBe(422);
    const dup = await admin.put('/api/admin/hospital', { ...s.settings, catalog: { ...cat, appointmentTypes: [...cat.appointmentTypes, { code: 'new', label: 'Again', feeBasis: 'Consultation', isActive: true }] } });
    expect(dup.status).toBe(400);
  });

  it('booking accepts only configured types; the consultation is billed at the type’s fee basis', async () => {
    const me = (await doctor.get('/api/auth/me')).body;
    const p = await reception.post('/api/patients', { firstName: 'Catalog', lastName: 'Tester', cnic: '35202-7654321-9', dateOfBirth: '1979-02-03', gender: 'Female', phone: '+92 301 7654321' });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    s.patient = p.body;
    const slot = await freeSlot(reception, me.doctorId);
    await reception.post('/api/appointments', { patientId: p.body.id, doctorId: me.doctorId, date: localToday(), startTime: slot, type: 'Bogus' }).expect(422);
    const appt = await reception.post('/api/appointments', { patientId: p.body.id, doctorId: me.doctorId, date: localToday(), startTime: slot, type: 'Teleconsult', reason: 'Medication review' });
    expect(appt.status, JSON.stringify(appt.body)).toBe(201);
    s.appt = appt.body;
    await reception.post(`/api/appointments/${appt.body.id}/check-in`).expect(200);
    await nurse.post(`/api/clinical/nursing/appointments/${appt.body.id}/start`).expect(200);
    await nurse.post(`/api/clinical/nursing/appointments/${appt.body.id}/submit`, { vitals: { systolicBp: 120, diastolicBp: 80, heartRate: 72, temperatureC: 36.9, spo2: 98, weightKg: 70, heightCm: 165 }, symptoms: 'Routine review' }).expect(200);
    const ctx = (await doctor.post(`/api/clinical/doctor/appointments/${appt.body.id}/start`)).body;
    s.visitId = ctx.visitId;
    await doctor.put(`/api/clinical/visits/${ctx.visitId}/note`, { chiefComplaint: 'Review', clinicalNotes: 'Stable on current treatment.' }).expect(200);
    await doctor.post(`/api/clinical/visits/${ctx.visitId}/diagnoses`, { icdCode: 'E11', description: 'Type 2 diabetes mellitus', type: 'Final' }).expect(201);
  });
});

describe('Sorting and designations', () => {
  it('list endpoints sort by whitelisted keys only', async () => {
    const asc = (await reception.get('/api/patients?sort=mrn&pageSize=10')).body.items.map((p: any) => p.mrn);
    expect(asc).toEqual([...asc].sort());
    const desc = (await reception.get('/api/patients?sort=-mrn&pageSize=10')).body.items.map((p: any) => p.mrn);
    expect(desc).toEqual([...desc].sort().reverse());
    const totals = (await accounts.get('/api/billing/invoices?sort=-total&pageSize=10')).body.items.map((i: any) => i.total);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    const bad = await reception.get('/api/patients?sort=cnic');
    expect(bad.status).toBe(400);
    expect(bad.body.details.fieldErrors.sort[0]).toContain('mrn');
  });

  it('once a designation list exists, employees can only use listed titles', async () => {
    const hr = await signIn(app, 'hr@hospital.com');
    const cat = (await admin.get('/api/admin/catalog')).body;
    await admin.put('/api/admin/hospital', { ...s.settings, catalog: { ...cat, designations: ['Staff Nurse', 'Pharmacist', 'Receptionist'] } }).expect(200);
    const depts = (await admin.get('/api/admin/departments')).body;
    const base = { firstName: 'Desig', lastName: 'Test', gender: 'Female', departmentId: depts[0]._id, joiningDate: localToday(), employmentType: 'FullTime', isActive: true };
    const bad = await hr.post('/api/hr/employees', { ...base, designation: 'Astronaut' });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('unknown_designation');
    await hr.post('/api/hr/employees', { ...base, designation: 'staff nurse' }).expect(201);
    // Back to free text so later suites are unaffected.
    await admin.put('/api/admin/hospital', { ...s.settings, catalog: { ...cat, designations: [] } }).expect(200);
    await hr.post('/api/hr/employees', { ...base, firstName: 'Free', designation: 'Astronaut' }).expect(201);
  });
});

describe('Medication schedules start when the doctor prescribes', () => {
  it('a new prescription creates its reminder schedule immediately (before dispensing)', async () => {
    const rx = await doctor.post(`/api/clinical/visits/${s.visitId}/prescriptions`, { items: [{ medicineName: 'Metformin 500mg', dosage: '1 tablet', frequency: 'Twice daily', timesPerDay: 2, durationDays: 10, quantity: 20 }] });
    expect(rx.status, JSON.stringify(rx.body)).toBe(201);
    s.rx = rx.body;
    const schedules = (await doctor.get(`/api/medications/patients/${s.patient.id}`)).body;
    const sch = schedules.find((x: any) => x.prescriptionNo === rx.body.prescriptionNo);
    expect(sch).toMatchObject({ status: 'Active', totalDoses: 20, timesPerDay: 2 });
  });

  it('cancelling the prescription stops its schedule and cancels pending doses', async () => {
    const cancel = await doctor.post(`/api/clinical/prescriptions/${s.rx._id}/cancel`, { reason: 'Switched to extended release' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    const sch = (await doctor.get(`/api/medications/patients/${s.patient.id}`)).body.find((x: any) => x.prescriptionNo === s.rx.prescriptionNo);
    expect(sch.status).toBe('Stopped');
    expect(sch.pending).toBe(0);
  });

  it('the consultation completes and bills the follow-up fee with the type label', async () => {
    await doctor.post(`/api/clinical/doctor/appointments/${s.appt.id}/complete`, {}).expect(200);
    const doctors = (await admin.get('/api/admin/doctors')).body;
    const me = (await doctor.get('/api/auth/me')).body;
    const d = doctors.find((x: any) => x._id === me.doctorId);
    const invoices = (await accounts.get(`/api/billing/invoices?search=${s.patient.mrn}`)).body.items;
    const inv = invoices.find((i: any) => i.source === 'OPD');
    const full = (await accounts.get(`/api/billing/invoices/${inv._id}`)).body;
    expect(full.items[0].description).toContain('Tele-consultation');
    expect(full.total).toBe(d.followUpFee);
    s.invoice = full;
  });

  it('disabled payment methods are refused; enabled ones work', async () => {
    const online = await accounts.post(`/api/billing/invoices/${s.invoice._id}/payments`, { amount: 100, method: 'Online', reference: 'TXN-1' });
    expect(online.status).toBe(422);
    expect(online.body.code).toBe('payment_method_disabled');
    await accounts.post(`/api/billing/invoices/${s.invoice._id}/payments`, { amount: 100, method: 'Cash' }).expect(201);
  });

  it('medicines can only use configured therapeutic classes', async () => {
    const base = { name: 'Warfarin 5mg', category: 'Medicine', unit: 'tablet', purchasePrice: 4, sellingPrice: 7, reorderLevel: 50, isControlled: false, isActive: true };
    await inventory.post('/api/inventory/items', { ...base, sku: 'MED-WAR5', therapeuticClass: 'Made-up class' }).expect(422);
    const ok = await inventory.post('/api/inventory/items', { ...base, sku: 'MED-WAR5', therapeuticClass: 'Anticoagulant' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.therapeuticClass).toBe('Anticoagulant');
  });
});

describe('Appointment reminders', () => {
  it('a booked appointment within 24 hours gets exactly one reminder', async () => {
    const me = (await doctor.get('/api/auth/me')).body;
    const slot = await freeSlot(reception, me.doctorId);
    const appt = await reception.post('/api/appointments', { patientId: s.patient.id, doctorId: me.doctorId, date: localToday(), startTime: slot, type: 'FollowUp' });
    expect(appt.status, JSON.stringify(appt.body)).toBe(201);
    const startsAt = new Date(`${localToday()}T${slot}:00`);
    const before = new Date(startsAt.getTime() - 60 * 60_000); // an hour before
    const first = await asHospital(() => runAppointmentReminders(before));
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const again = await asHospital(() => runAppointmentReminders(before));
    expect(again.sent).toBe(0);
    const note = await asHospital(() => Notification.findOne({ type: 'AppointmentReminder', patientId: new mongoose.Types.ObjectId(s.patient.id) }).lean().exec());
    expect(note?.message).toContain(appt.body.appointmentNo);
    expect(note?.deliveries?.map((d) => d.channel)).toEqual(expect.arrayContaining(['Sms', 'Email']));
  });
});

describe('Payment reminders', () => {
  it('open balances get at most three reminders, a week apart, with amounts only', async () => {
    const DAY = 86_400_000;
    const t0 = new Date(Date.now() + 30 * DAY); // every open invoice is older than the threshold
    const first = await asHospital(() => runPaymentReminders(t0, 7));
    expect(first.sent).toBeGreaterThan(0);
    expect((await asHospital(() => runPaymentReminders(new Date(t0.getTime() + DAY), 7))).sent).toBe(0); // within the week
    const second = await asHospital(() => runPaymentReminders(new Date(t0.getTime() + 8 * DAY), 7));
    const third = await asHospital(() => runPaymentReminders(new Date(t0.getTime() + 16 * DAY), 7));
    expect(second.sent).toBe(first.sent);
    expect(third.sent).toBe(first.sent);
    expect((await asHospital(() => runPaymentReminders(new Date(t0.getTime() + 24 * DAY), 7))).sent).toBe(0); // capped at three
    const note = await asHospital(() => Notification.findOne({ type: 'PaymentDue', title: 'Payment reminder' }).lean().exec());
    expect(note?.message).toMatch(/outstanding balance of PKR [\d,.]+/);
    expect(note?.link).toBe('/portal/bills');
    expect((await asHospital(() => runPaymentReminders(t0, 0))).sent).toBe(0); // 0 disables the job
  });
});

describe('Laboratory: technician assignment and uploaded reports', () => {
  it('a supervisor assigns an order to a technician, who sees it in "assigned to me"', async () => {
    const techs = (await labsup.get('/api/laboratory/technicians')).body;
    const labUser = techs.find((t: any) => t.email === 'lab@hospital.com');
    expect(labUser).toBeTruthy();
    expect(techs.map((t: any) => t.email)).not.toEqual(expect.arrayContaining(['admin@hospital.com']));
    expect(techs.map((t: any) => t.email)).not.toEqual(expect.arrayContaining(['superadmin@hospital.com']));
    const adminUser = (await admin.get('/api/admin/users?search=superadmin')).body.items[0];
    await labsup.post(`/api/laboratory/orders/${(await labsup.get('/api/laboratory/orders?pageSize=1')).body.items[0]._id}/assign`, { userId: adminUser.id ?? adminUser._id }).expect(422);
    const order = (await labsup.get('/api/laboratory/orders?statuses=Ordered,SamplePending,SampleCollected&pageSize=5')).body.items[0];
    s.labOrder = order;
    await nurse.post(`/api/laboratory/orders/${order._id}/assign`, { userId: labUser._id }).expect(403);
    const receptionUser = (await admin.get('/api/admin/users?search=reception')).body.items[0];
    await labsup.post(`/api/laboratory/orders/${order._id}/assign`, { userId: receptionUser.id ?? receptionUser._id }).expect(422);
    const res = await labsup.post(`/api/laboratory/orders/${order._id}/assign`, { userId: labUser._id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.technicianName).toBe(labUser.fullName);
    const mine = (await lab.get('/api/laboratory/orders?assignedToMe=true&pageSize=50')).body.items;
    expect(mine.some((o: any) => o._id === order._id)).toBe(true);
  });

  it('technicians upload report files (validated by content) that the care team can open', async () => {
    const pdf = Buffer.from('%PDF-1.4\n% instrument printout\n%%EOF');
    const up = await lab.agent.post(`/api/laboratory/orders/${s.labOrder._id}/attachments`).set('X-Requested-With', 'hms').field('description', 'Analyser printout').attach('file', pdf, { filename: 'cbc-printout.pdf', contentType: 'application/pdf' });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const att = up.body.attachments[0];
    expect(att.fileName).toBe('cbc-printout.pdf');
    const fake = await lab.agent.post(`/api/laboratory/orders/${s.labOrder._id}/attachments`).set('X-Requested-With', 'hms').attach('file', Buffer.from('MZ not a pdf'), { filename: 'report.pdf', contentType: 'application/pdf' });
    expect(fake.status).toBe(422);
    const dl = await labsup.get(`/api/laboratory/orders/${s.labOrder._id}/attachments/${att._id}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('application/pdf');
    await patient.get(`/api/laboratory/orders/${s.labOrder._id}/attachments/${att._id}`).expect(403);
    await reception.post(`/api/laboratory/orders/${s.labOrder._id}/attachments`).expect(403);
  });
});

describe('Purchase requests → purchase orders', () => {
  it('pharmacy requests stock; someone else approves; purchasing converts it into a draft PO', async () => {
    const items = (await pharmacy.get('/api/inventory/items?search=Paracetamol&pageSize=5')).body.items;
    const pr = await pharmacy.post('/api/purchasing/requests', { justification: 'Below reorder level ahead of flu season', items: [{ itemId: items[0]._id, quantity: 500 }] });
    expect(pr.status, JSON.stringify(pr.body)).toBe(201);
    expect(pr.body.requestNo).toMatch(/^PR-\d{4}-\d{5}$/);
    await pharmacy.post(`/api/purchasing/requests/${pr.body._id}/approve`).expect(403); // pharmacist cannot approve
    await inventory.post(`/api/purchasing/requests/${pr.body._id}/approve`).expect(409); // still a draft
    await pharmacy.post(`/api/purchasing/requests/${pr.body._id}/submit`).expect(200);
    await inventory.post(`/api/purchasing/requests/${pr.body._id}/reject`).expect(422); // reason required
    await inventory.post(`/api/purchasing/requests/${pr.body._id}/approve`, { note: 'OK' }).expect(200);
    const suppliers = (await inventory.get('/api/purchasing/suppliers')).body;
    const conv = await inventory.post(`/api/purchasing/requests/${pr.body._id}/convert`, { supplierId: suppliers[0]._id });
    expect(conv.status, JSON.stringify(conv.body)).toBe(201);
    expect(conv.body.purchaseOrder.status).toBe('Draft');
    expect(conv.body.purchaseOrder.items[0].quantity).toBe(500);
    expect(conv.body.purchaseOrder.notes).toContain(pr.body.requestNo);
    expect(conv.body.request.status).toBe('Converted');
    await inventory.post(`/api/purchasing/requests/${pr.body._id}/convert`, { supplierId: suppliers[0]._id }).expect(409);
  });

  it('requesters cannot approve their own request', async () => {
    const items = (await inventory.get('/api/inventory/items?search=Gauze&pageSize=5')).body.items;
    const pr = (await inventory.post('/api/purchasing/requests', { justification: 'Theatre restock', items: [{ itemId: items[0]._id, quantity: 20 }] })).body;
    await inventory.post(`/api/purchasing/requests/${pr._id}/submit`).expect(200);
    await inventory.post(`/api/purchasing/requests/${pr._id}/approve`).expect(403);
  });
});

describe('Reports, dashboard and migrations', () => {
  it('more reports filter by department; the expiry report keeps expired stock in a date range', async () => {
    const depts = (await admin.get('/api/admin/departments')).body;
    const gm = depts.find((d: any) => d.code === 'GM') ?? depts[0];
    const from = new Date(Date.now() - 60 * 86_400_000).toLocaleDateString('en-CA');
    for (const key of ['outstanding', 'demographics', 'lab-tat', 'insurance-claims', 'medication-adherence']) {
      const r = await admin.get(`/api/reports/${key}?from=${from}&to=${localToday()}&departmentId=${gm._id}`);
      expect(r.status, `${key}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
      expect(r.body.subtitle).toContain(gm.name);
    }
    const expiry = (await admin.get(`/api/reports/medicine-expiry?from=${localToday()}&to=${new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('en-CA')}`)).body;
    expect(expiry.rows.some((r: any) => r.status === 'Expired')).toBe(true);
  });

  it("the executive dashboard shows today's revenue", async () => {
    const dash = (await admin.get('/api/dashboard/summary?preset=month')).body;
    expect(typeof dash.kpis.todaysRevenue).toBe('number');
    expect(dash.kpis.todaysRevenue).toBeGreaterThanOrEqual(100); // the cash payment above
  });

  it('migrations run once, are recorded, and restore permissions new to system roles', async () => {
    await sys(() => mongoose.connection.collection('schemamigrations').deleteMany({}));
    await asHospital(() => Role.updateOne({ name: 'Nurse' }, { $pull: { permissions: 'medication.manage' } }).exec());
    const applied = await runMigrations();
    expect(applied).toEqual(['001-system-role-permissions', '002-hospital-catalog-defaults', '003-employee-number-counter']);
    const role = await asHospital(() => Role.findOne({ name: 'Nurse' }).lean().exec());
    expect(role?.permissions).toContain('medication.manage');
    expect(await runMigrations()).toEqual([]);
  });

  it('all new actions are audited', async () => {
    const actions = await AuditLog.distinct('action');
    for (const a of ['hospital.updated', 'lab_order.assigned', 'lab_report.uploaded', 'lab_report.downloaded', 'purchase_request.created', 'purchase_request.approved', 'purchase_request.converted', 'medication.schedule_created', 'medication.schedule_stopped']) {
      expect(actions).toContain(a);
    }
  });
});
