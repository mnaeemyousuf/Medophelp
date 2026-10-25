import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { connectDb, disconnectDb } from '../src/core/db';
import { seed } from '../src/seed/seed';
import { createApp } from '../src/app';
import { AuditLog } from '../src/core/audit/audit';
import { PASSWORD, freeSlot, localToday, signIn, type Session } from './helpers';

let app: Express;
let admin: Session, reception: Session, nurse: Session, doctor: Session, lab: Session, labSup: Session, pharmacy: Session, inventory: Session;
const s: Record<string, any> = {};

/** Registers a patient and walks them to an open consultation with the demo doctor. */
async function openConsultation(slotOffset: number, cnicSeed: string) {
  const p = await reception.post('/api/patients', {
    firstName: 'Phase',
    lastName: `Two${cnicSeed}`,
    cnic: `35202-${cnicSeed}-3`,
    dateOfBirth: '1990-02-02',
    gender: 'Female',
    phone: `+92 301 ${cnicSeed}`,
  });
  expect(p.status).toBe(201);
  const appt = await reception.post('/api/appointments', { patientId: p.body.id, doctorId: s.doctorId, date: localToday(), startTime: await freeSlot(reception, s.doctorId, slotOffset), reason: 'Phase 2 test' });
  expect(appt.status).toBe(201);
  await reception.post(`/api/appointments/${appt.body.id}/check-in`).expect(200);
  await nurse.post(`/api/clinical/nursing/appointments/${appt.body.id}/submit`, {
    vitals: { systolicBp: 120, diastolicBp: 80, heartRate: 75, temperatureC: 37, spo2: 98, weightKg: 60, heightCm: 160, painScale: 0 },
    symptoms: 'Routine check',
  }).expect(200);
  const ctx = await doctor.post(`/api/clinical/doctor/appointments/${appt.body.id}/start`);
  expect(ctx.status).toBe(200);
  return { patientId: p.body.id as string, appointmentId: appt.body.id as string, visitId: ctx.body.visitId as string };
}

beforeAll(async () => {
  await connectDb(process.env.MONGODB_URI!);
  await seed(PASSWORD);
  app = createApp();
  [admin, reception, nurse, doctor, lab, labSup, pharmacy, inventory] = await Promise.all(
    ['admin', 'reception', 'nurse', 'doctor', 'lab', 'labsupervisor', 'pharmacy', 'inventory'].map((r) => signIn(app, `${r}@hospital.com`)),
  );
  s.doctorId = (await doctor.get('/api/auth/me')).body.doctorId;
  await admin.patch(`/api/admin/doctors/${s.doctorId}`, { dutyStart: '00:00', dutyEnd: '23:59' }).expect(200);
});

afterAll(async () => {
  await disconnectDb();
});

describe('Laboratory workflow', () => {
  it('doctor orders tests during consultation and the lab charges are billed', async () => {
    const c = await openConsultation(0, '1110001');
    s.lab = c;
    const tests = (await doctor.get('/api/laboratory/tests')).body;
    const cbc = tests.find((t: any) => t.code === 'CBC');
    const fbs = tests.find((t: any) => t.code === 'FBS');
    const res = await doctor.post(`/api/laboratory/visits/${c.visitId}/orders`, { testIds: [cbc._id, fbs._id], priority: 'Urgent', clinicalNotes: 'Pallor, fatigue' });
    expect(res.status).toBe(201);
    expect(res.body.orderNo).toMatch(/^LAB-\d{4}-\d{6}$/);
    expect(res.body.status).toBe('Ordered');
    s.order = res.body;
    const inv = (await admin.get(`/api/billing/invoices?patientId=${c.patientId}&source=Laboratory`)).body;
    expect(inv.items).toHaveLength(1);
    expect(inv.items[0].total).toBe(cbc.price + fbs.price);
  });

  it('lab receives, collects the sample and processes; invalid moves are rejected', async () => {
    const worklist = (await lab.get('/api/laboratory/orders?statuses=Ordered,SamplePending')).body;
    expect(worklist.items.some((o: any) => o._id === s.order._id)).toBe(true);
    await lab.post(`/api/laboratory/orders/${s.order._id}/start`).expect(409); // cannot skip sample collection
    await lab.post(`/api/laboratory/orders/${s.order._id}/receive`).expect(200);
    const col = await lab.post(`/api/laboratory/orders/${s.order._id}/collect`, { sampleType: 'Blood' });
    expect(col.body.status).toBe('SampleCollected');
    expect(col.body.sample.barcode).toBe(s.order.orderNo);
    await lab.post(`/api/laboratory/orders/${s.order._id}/start`).expect(200);
  });

  it('results are flagged against reference and critical ranges; incomplete final entry is refused', async () => {
    const order = (await lab.get(`/api/laboratory/orders/${s.order._id}`)).body;
    const cbc = order.items.find((i: any) => i.testCode === 'CBC');
    const fbs = order.items.find((i: any) => i.testCode === 'FBS');
    const partial = await lab.put(`/api/laboratory/orders/${s.order._id}/results`, { results: [{ itemId: cbc._id, parameter: 'Haemoglobin', value: '6.5' }] });
    expect(partial.status).toBe(422);
    const res = await lab.put(`/api/laboratory/orders/${s.order._id}/results`, {
      results: [
        { itemId: cbc._id, parameter: 'Haemoglobin', value: '6.5' },
        { itemId: cbc._id, parameter: 'WBC', value: '7.2' },
        { itemId: cbc._id, parameter: 'Platelets', value: '420' },
        { itemId: cbc._id, parameter: 'Neutrophils', value: '60' },
        { itemId: fbs._id, parameter: 'Glucose (fasting)', value: '92' },
      ],
      comments: 'Severe anaemia — clinician informed by phone',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Completed');
    const flags = Object.fromEntries(res.body.items.flatMap((i: any) => i.results.map((r: any) => [r.parameter, r.flag])));
    expect(flags).toMatchObject({ Haemoglobin: 'LL', WBC: 'N', Platelets: 'H', 'Glucose (fasting)': 'N' });
    expect(res.body.hasCritical).toBe(true);
  });

  it('verification needs a second person; patient cannot see results before verification', async () => {
    await lab.post(`/api/laboratory/orders/${s.order._id}/verify`).expect(403);
    const portal = await signIn(app, 'patient@hospital.com');
    const own = (await portal.get('/api/laboratory/orders')).body.items;
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((o: any) => o.status === 'Verified')).toBe(true);
    await portal.get(`/api/laboratory/orders/${s.order._id}`).expect(403); // someone else's order
    const v = await labSup.post(`/api/laboratory/orders/${s.order._id}/verify`);
    expect(v.status).toBe(200);
    expect(v.body.status).toBe('Verified');
    await lab.post(`/api/laboratory/orders/${s.order._id}/start`).expect(409);
  });

  it('doctor is alerted, reviews the verified report and prints it', async () => {
    const notes = (await doctor.get('/api/notifications')).body.items;
    expect(notes.some((n: any) => n.type === 'LabResultAvailable' && n.priority === 'Critical')).toBe(true);
    const r = await doctor.post(`/api/laboratory/orders/${s.order._id}/review`);
    expect(r.status).toBe(200);
    expect(r.body.reviewedAt).toBeTruthy();
    const pdf = await doctor.get(`/api/laboratory/orders/${s.order._id}/report`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const emr = (await doctor.get(`/api/clinical/emr/${s.lab.patientId}`)).body;
    expect(emr.labOrders[0].status).toBe('Verified');
  });

  it('pharmacy and reception cannot touch lab results', async () => {
    await pharmacy.put(`/api/laboratory/orders/${s.order._id}/results`, { results: [] }).expect(403);
    await reception.get(`/api/laboratory/orders/${s.order._id}`).expect(403);
  });
});

describe('Pharmacy dispensing with FEFO', () => {
  it('doctor prescribes from the formulary', async () => {
    const c = await openConsultation(1, '2220002');
    s.rxVisit = c;
    const f = (await doctor.get('/api/pharmacy/formulary?search=amoxi')).body;
    s.amox = f.find((m: any) => m.name === 'Amoxicillin 500mg');
    expect(s.amox.available).toBeGreaterThan(50);
    const insulin = (await doctor.get('/api/pharmacy/formulary?search=insulin')).body[0];
    s.insulin = insulin;
    const tram = (await doctor.get('/api/pharmacy/formulary?search=tramadol')).body[0];
    s.tram = tram;
    const rx = await doctor.post(`/api/clinical/visits/${c.visitId}/prescriptions`, {
      items: [
        { medicineId: s.amox._id, medicineName: s.amox.name, dosage: '1 capsule', frequency: '3 times daily', timesPerDay: 3, durationDays: 17, quantity: 50 },
        { medicineId: insulin._id, medicineName: insulin.name, dosage: '10 IU', frequency: 'Twice daily', timesPerDay: 2, durationDays: 30, quantity: 500 },
        { medicineId: tram._id, medicineName: tram.name, dosage: '1 capsule', frequency: 'When required', timesPerDay: 0, durationDays: 5, quantity: 10 },
      ],
    });
    expect(rx.status).toBe(201);
    s.rx = rx.body;
  });

  it('nurse cannot dispense; pharmacy queue shows the prescription', async () => {
    await nurse.post(`/api/pharmacy/prescriptions/${s.rx._id}/dispense`, { lines: [] }).expect(403);
    const q = (await pharmacy.get('/api/pharmacy/queue?pageSize=100')).body;
    expect(q.items.some((r: any) => r._id === s.rx._id)).toBe(true);
  });

  it('dispenses earliest-expiry stock first, never expired batches; stock and billing update', async () => {
    const ctx = (await pharmacy.get(`/api/pharmacy/prescriptions/${s.rx._id}`)).body;
    const line = ctx.lines.find((l: any) => l.medicineName === s.amox.name);
    expect(line.fefo.allocations[0].batchNo).toBe('AMX2399N'); // expires in ~25 days
    const before = (await inventory.get(`/api/inventory/items/${s.amox._id}`)).body.item.currentStock;

    const res = await pharmacy.post(`/api/pharmacy/prescriptions/${s.rx._id}/dispense`, { lines: [{ prescriptionItemId: line.prescriptionItemId, itemId: s.amox._id, quantity: 50 }] });
    expect(res.status).toBe(201);
    const alloc = res.body.dispense.lines[0].allocations;
    expect(alloc[0]).toMatchObject({ batchNo: 'AMX2399N', quantity: 40 });
    expect(alloc[1].quantity).toBe(10);
    expect(alloc.some((a: any) => a.batchNo === 'AMX2301X')).toBe(false); // expired batch untouched
    expect(res.body.prescriptionStatus).toBe('PartiallyDispensed');

    const after = (await inventory.get(`/api/inventory/items/${s.amox._id}`)).body;
    expect(after.item.currentStock).toBe(before - 50);
    expect(after.transactions[0].type).toBe('Dispensing');

    const inv = (await admin.get(`/api/billing/invoices?patientId=${s.rxVisit.patientId}&source=Pharmacy`)).body.items;
    expect(inv).toHaveLength(1);
    expect(inv[0].total).toBe(50 * s.amox.sellingPrice);
    s.amoxLine = line.prescriptionItemId;
  });

  it('rejects over-dispensing, insufficient stock and controlled drugs without a witness', async () => {
    const ctx = (await pharmacy.get(`/api/pharmacy/prescriptions/${s.rx._id}`)).body;
    const over = await pharmacy.post(`/api/pharmacy/prescriptions/${s.rx._id}/dispense`, { lines: [{ prescriptionItemId: s.amoxLine, itemId: s.amox._id, quantity: 1 }] });
    expect(over.status).toBe(422);

    const ins = ctx.lines.find((l: any) => l.medicineName === s.insulin.name);
    const before = (await inventory.get(`/api/inventory/items/${s.insulin._id}`)).body.item.currentStock;
    const short = await pharmacy.post(`/api/pharmacy/prescriptions/${s.rx._id}/dispense`, { lines: [{ prescriptionItemId: ins.prescriptionItemId, itemId: s.insulin._id, quantity: 500 }] });
    expect(short.status).toBe(422);
    expect(short.body.code).toBe('insufficient_stock');
    expect((await inventory.get(`/api/inventory/items/${s.insulin._id}`)).body.item.currentStock).toBe(before); // rolled back

    const tram = ctx.lines.find((l: any) => l.medicineName === s.tram.name);
    const noWitness = await pharmacy.post(`/api/pharmacy/prescriptions/${s.rx._id}/dispense`, { lines: [{ prescriptionItemId: tram.prescriptionItemId, itemId: s.tram._id, quantity: 10 }] });
    expect(noWitness.status).toBe(422);
    const ok = await pharmacy.post(`/api/pharmacy/prescriptions/${s.rx._id}/dispense`, { lines: [{ prescriptionItemId: tram.prescriptionItemId, itemId: s.tram._id, quantity: 10 }], witnessName: 'Staff Nurse Hira' });
    expect(ok.status).toBe(201);
    const register = (await pharmacy.get('/api/pharmacy/controlled-register')).body.items;
    expect(register[0]).toMatchObject({ itemName: s.tram.name, quantity: 10, witnessName: 'Staff Nurse Hira' });
  });
});

describe('Inventory controls', () => {
  it('blocks negative stock, writes off expired stock, transfers store → pharmacy', async () => {
    const item = (await inventory.get(`/api/inventory/items/${s.amox._id}`)).body;
    const expired = item.batches.find((b: any) => b.batchNo === 'AMX2301X');
    expect(expired.isExpired).toBe(true);
    const tooMuch = await inventory.post('/api/inventory/adjustments', { batchId: expired._id, type: 'Damage', quantity: expired.quantity + 1, reason: 'Broken' });
    expect(tooMuch.status).toBe(422);
    const wo = await inventory.post('/api/inventory/adjustments', { batchId: expired._id, type: 'Expiry', quantity: expired.quantity, reason: 'Expired — destroyed' });
    expect(wo.status).toBe(201);
    expect(wo.body.quantity).toBe(0);

    const store = item.batches.find((b: any) => b.location === 'Main Store');
    const t = await inventory.post('/api/inventory/transfers', { batchId: store._id, to: 'Pharmacy', quantity: 20 });
    expect(t.status).toBe(201);
    expect(t.body.location).toBe('Pharmacy');
    const alerts = (await inventory.get('/api/inventory/alerts')).body;
    expect(alerts.lowStock.length).toBeGreaterThan(0);
    await pharmacy.post('/api/inventory/adjustments', { batchId: store._id, type: 'Adjustment', quantity: -1, reason: 'Count correction' }).expect(201); // pharmacist has inventory.manage
    await nurse.post('/api/inventory/adjustments', { batchId: store._id, type: 'Adjustment', quantity: -1, reason: 'Count correction' }).expect(403);
  });
});

describe('Purchase order workflow', () => {
  it('runs draft → approval (segregated) → ordered → partial and full receipt', async () => {
    const suppliers = (await inventory.get('/api/purchasing/suppliers')).body;
    const items = (await inventory.get('/api/inventory/items?search=insulin')).body.items;
    const po = await inventory.post('/api/purchasing/orders', { supplierId: suppliers[1]._id, expectedDelivery: localToday(), items: [{ itemId: items[0]._id, quantity: 40, unitPrice: 650, taxRate: 0, discount: 0 }] });
    expect(po.status).toBe(201);
    expect(po.body.poNo).toMatch(/^PO-\d{4}-\d{5}$/);
    expect(po.body.total).toBe(26000);
    const id = po.body._id;

    await inventory.post(`/api/purchasing/orders/${id}/order`).expect(409); // must be approved first
    await inventory.post(`/api/purchasing/orders/${id}/submit`).expect(200);
    const self = await inventory.post(`/api/purchasing/orders/${id}/approve`);
    expect(self.status).toBe(403); // cannot approve own PO
    await pharmacy.post(`/api/purchasing/orders/${id}/approve`).expect(403); // lacks purchasing.approve
    await admin.post(`/api/purchasing/orders/${id}/approve`).expect(200);
    await inventory.post(`/api/purchasing/orders/${id}/order`).expect(200);

    const before = (await inventory.get(`/api/inventory/items/${items[0]._id}`)).body.item.currentStock;
    const detail = (await inventory.get(`/api/purchasing/orders/${id}`)).body;
    const lineId = detail.items[0]._id;
    const r1 = await inventory.post(`/api/purchasing/orders/${id}/receive`, { location: 'Main Store', lines: [{ lineId, quantity: 15, batchNo: 'INS-T1', expiryDate: '2028-06-30' }] });
    expect(r1.status).toBe(201);
    expect(r1.body.purchaseOrder.status).toBe('PartiallyReceived');
    const expiredLot = await inventory.post(`/api/purchasing/orders/${id}/receive`, { location: 'Main Store', lines: [{ lineId, quantity: 5, batchNo: 'INS-OLD', expiryDate: '2020-01-01' }] });
    expect(expiredLot.status).toBe(422);
    const over = await inventory.post(`/api/purchasing/orders/${id}/receive`, { location: 'Main Store', lines: [{ lineId, quantity: 26, batchNo: 'INS-T2', expiryDate: '2028-06-30' }] });
    expect(over.status).toBe(422);
    const r2 = await inventory.post(`/api/purchasing/orders/${id}/receive`, { location: 'Pharmacy', lines: [{ lineId, quantity: 25, batchNo: 'INS-T2', expiryDate: '2028-07-31' }] });
    expect(r2.body.purchaseOrder.status).toBe('Received');
    const after = (await inventory.get(`/api/inventory/items/${items[0]._id}`)).body.item;
    expect(after.currentStock).toBe(before + 40);
    await inventory.post(`/api/purchasing/orders/${id}/cancel`, { note: 'too late' }).expect(422);
  });

  it('every Phase 2 action is audited and the stock ledger is immutable', async () => {
    const actions = await AuditLog.distinct('action');
    for (const a of ['lab_order.created', 'lab_result.entered', 'lab_result.reviewed', 'medicine.dispensed', 'stock.expiry', 'stock.transferred', 'purchase_order.created', 'goods.received']) {
      expect(actions).toContain(a);
    }
    const { InventoryTransaction } = await import('../src/modules/inventory/inventory.models');
    const { runWithContext } = await import('../src/core/context');
    await expect(runWithContext({ roles: [], permissions: new Set(), system: true }, () => InventoryTransaction.updateOne({}, { quantity: 0 }).exec())).rejects.toThrow(/immutable/);
  });
});
