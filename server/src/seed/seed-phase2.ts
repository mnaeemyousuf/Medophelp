import type { Types } from 'mongoose';
import { formatRange, labFlag, lineTotals } from '@hms/shared';
import { nextNumber } from '../core/numbering/numbering';
import { Supplier, PurchaseOrder, GoodsReceipt } from '../modules/purchasing/purchasing.models';
import { Batch, InventoryTransaction, Item } from '../modules/inventory/inventory.models';
import { LabOrder, LabTest } from '../modules/laboratory/lab.models';
import { Invoice } from '../modules/billing/billing.models';
import { Prescription } from '../modules/clinical/clinical.models';
import { Visit } from '../modules/appointments/appointment.models';
import { Patient } from '../modules/patients/patient.models';
import { Doctor } from '../modules/staff/staff.models';

const DAY = 86_400_000;
const addDays = (n: number) => new Date(Date.now() + n * DAY);
const monthsOut = (n: number) => addDays(Math.round(n * 30.4));

const SUPPLIERS = [
  ['GSK-PK', 'GSK Pakistan Distribution', 'Imran Saeed', '+92 21 111 475 725'],
  ['GETZ', 'Getz Pharma Trade', 'Nadia Hussain', '+92 21 3865 0000'],
  ['SEARLE', 'Searle Company Supplies', 'Asad Qamar', '+92 42 3587 1111'],
  ['MEDSURG', 'MedSurg Instruments', 'Bilal Rafiq', '+92 42 3630 2222'],
  ['CARECON', 'CareCon Consumables', 'Sara Ilyas', '+92 51 2870 3333'],
] as const;

// sku, name, generic, form, strength, unit, buy, sell, reorder, controlled, supplier index
const MEDICINES: Array<[string, string, string, string, string, string, number, number, number, boolean, number]> = [
  ['MED-PCM500', 'Paracetamol 500mg', 'Paracetamol', 'Tablet', '500mg', 'tablet', 1.2, 2, 500, false, 0],
  ['MED-AMX500', 'Amoxicillin 500mg', 'Amoxicillin', 'Capsule', '500mg', 'capsule', 6, 10, 300, false, 0],
  ['MED-OMP20', 'Omeprazole 20mg', 'Omeprazole', 'Capsule', '20mg', 'capsule', 4, 7, 300, false, 1],
  ['MED-AML5', 'Amlodipine 5mg', 'Amlodipine', 'Tablet', '5mg', 'tablet', 3, 5, 300, false, 1],
  ['MED-MET500', 'Metformin 500mg', 'Metformin', 'Tablet', '500mg', 'tablet', 2, 3.5, 400, false, 1],
  ['MED-CTZ10', 'Cetirizine 10mg', 'Cetirizine', 'Tablet', '10mg', 'tablet', 1.5, 3, 200, false, 2],
  ['MED-IBU400', 'Ibuprofen 400mg', 'Ibuprofen', 'Tablet', '400mg', 'tablet', 2, 3.5, 300, false, 2],
  ['MED-DXM', 'Dextromethorphan syrup 120ml', 'Dextromethorphan', 'Syrup', '15mg/5ml', 'bottle', 90, 150, 40, false, 2],
  ['MED-AZI500', 'Azithromycin 500mg', 'Azithromycin', 'Tablet', '500mg', 'tablet', 25, 40, 100, false, 0],
  ['MED-CIP500', 'Ciprofloxacin 500mg', 'Ciprofloxacin', 'Tablet', '500mg', 'tablet', 8, 14, 150, false, 1],
  ['MED-LOS50', 'Losartan 50mg', 'Losartan', 'Tablet', '50mg', 'tablet', 5, 9, 200, false, 1],
  ['MED-ATV20', 'Atorvastatin 20mg', 'Atorvastatin', 'Tablet', '20mg', 'tablet', 7, 12, 200, false, 0],
  ['MED-SAL', 'Salbutamol inhaler 100mcg', 'Salbutamol', 'Inhaler', '100mcg/dose', 'inhaler', 300, 450, 20, false, 0],
  ['MED-ORS', 'ORS sachet', 'Oral rehydration salts', 'Sachet', '20.5g', 'sachet', 12, 20, 100, false, 2],
  ['MED-CEF1G', 'Ceftriaxone 1g injection', 'Ceftriaxone', 'Injection', '1g', 'vial', 120, 200, 50, false, 0],
  ['MED-DIC75', 'Diclofenac 75mg injection', 'Diclofenac', 'Injection', '75mg/3ml', 'ampoule', 25, 45, 50, false, 2],
  ['MED-INS', 'Insulin regular 100IU/ml', 'Human insulin', 'Injection', '100IU/ml', 'vial', 650, 900, 15, false, 1],
  ['MED-TRM50', 'Tramadol 50mg', 'Tramadol', 'Capsule', '50mg', 'capsule', 6, 12, 100, true, 2],
  ['MED-MOR10', 'Morphine sulfate 10mg injection', 'Morphine', 'Injection', '10mg/ml', 'ampoule', 80, 140, 20, true, 0],
  ['MED-DZP5', 'Diazepam 5mg', 'Diazepam', 'Tablet', '5mg', 'tablet', 2, 4, 100, true, 2],
  ['MED-LEV500', 'Levofloxacin 500mg', 'Levofloxacin', 'Tablet', '500mg', 'tablet', 12, 20, 100, false, 1],
  ['MED-FOL5', 'Folic acid 5mg', 'Folic acid', 'Tablet', '5mg', 'tablet', 0.8, 1.5, 200, false, 2],
];

const SUPPLIES: Array<[string, string, string, string, number, number, number, number]> = [
  ['SUR-GLV-M', 'Surgical gloves (M), box of 100', 'Surgical Supplies', 'box', 900, 1200, 20, 3],
  ['SUR-SUT-30', 'Silk suture 3-0', 'Surgical Supplies', 'pack', 180, 260, 30, 3],
  ['CON-SYR-5', 'Syringe 5ml disposable', 'Consumables', 'piece', 12, 20, 500, 4],
  ['CON-CAN-20', 'IV cannula 20G', 'Consumables', 'piece', 45, 70, 200, 4],
  ['CON-GAUZE', 'Gauze swabs 10x10, pack of 100', 'Consumables', 'pack', 350, 500, 30, 4],
  ['GEN-MASK', 'Face masks, box of 50', 'General Medical Supplies', 'box', 250, 400, 40, 4],
];

// code, name, category, sample, price, TAT, parameters
type Param = { name: string; unit?: string; refLow?: number; refHigh?: number; criticalLow?: number; criticalHigh?: number; refText?: string; type?: 'numeric' | 'text' };
const LAB_TESTS: Array<[string, string, string, string, number, number, Param[]]> = [
  ['CBC', 'Complete Blood Count', 'Haematology', 'Blood', 1200, 6, [
    { name: 'Haemoglobin', unit: 'g/dL', refLow: 12, refHigh: 17.5, criticalLow: 7, criticalHigh: 20 },
    { name: 'WBC', unit: '×10⁹/L', refLow: 4, refHigh: 11, criticalLow: 2, criticalHigh: 30 },
    { name: 'Platelets', unit: '×10⁹/L', refLow: 150, refHigh: 400, criticalLow: 50, criticalHigh: 1000 },
    { name: 'Neutrophils', unit: '%', refLow: 40, refHigh: 75 },
  ]],
  ['FBS', 'Fasting Blood Sugar', 'Biochemistry', 'Serum', 300, 4, [{ name: 'Glucose (fasting)', unit: 'mg/dL', refLow: 70, refHigh: 100, criticalLow: 40, criticalHigh: 400 }]],
  ['HBA1C', 'HbA1c', 'Biochemistry', 'Blood', 1800, 24, [{ name: 'HbA1c', unit: '%', refLow: 4, refHigh: 5.6 }]],
  ['LFT', 'Liver Function Tests', 'Biochemistry', 'Serum', 1600, 12, [
    { name: 'ALT', unit: 'U/L', refLow: 7, refHigh: 56 },
    { name: 'AST', unit: 'U/L', refLow: 10, refHigh: 40 },
    { name: 'Bilirubin (total)', unit: 'mg/dL', refLow: 0.1, refHigh: 1.2 },
    { name: 'Alkaline phosphatase', unit: 'U/L', refLow: 44, refHigh: 147 },
  ]],
  ['RFT', 'Renal Function Tests', 'Biochemistry', 'Serum', 1400, 12, [
    { name: 'Urea', unit: 'mg/dL', refLow: 15, refHigh: 45 },
    { name: 'Creatinine', unit: 'mg/dL', refLow: 0.6, refHigh: 1.3, criticalHigh: 5 },
    { name: 'Sodium', unit: 'mmol/L', refLow: 135, refHigh: 145, criticalLow: 120, criticalHigh: 160 },
    { name: 'Potassium', unit: 'mmol/L', refLow: 3.5, refHigh: 5.1, criticalLow: 2.5, criticalHigh: 6.5 },
  ]],
  ['LIPID', 'Lipid Profile', 'Biochemistry', 'Serum', 1700, 12, [
    { name: 'Total cholesterol', unit: 'mg/dL', refHigh: 200 },
    { name: 'LDL', unit: 'mg/dL', refHigh: 130 },
    { name: 'HDL', unit: 'mg/dL', refLow: 40 },
    { name: 'Triglycerides', unit: 'mg/dL', refHigh: 150 },
  ]],
  ['TSH', 'Thyroid Stimulating Hormone', 'Immunology', 'Serum', 1500, 24, [{ name: 'TSH', unit: 'mIU/L', refLow: 0.4, refHigh: 4.0 }]],
  ['UA', 'Urine Routine Examination', 'Clinical Pathology', 'Urine', 500, 4, [
    { name: 'Colour', type: 'text', refText: 'Pale yellow' },
    { name: 'pH', refLow: 4.5, refHigh: 8 },
    { name: 'Protein', type: 'text', refText: 'Nil' },
    { name: 'Pus cells', unit: '/HPF', refLow: 0, refHigh: 5 },
  ]],
  ['CRP', 'C-Reactive Protein', 'Immunology', 'Serum', 900, 6, [{ name: 'CRP', unit: 'mg/L', refLow: 0, refHigh: 5 }]],
  ['DENGUE', 'Dengue NS1 Antigen', 'Serology', 'Serum', 2200, 6, [{ name: 'NS1 antigen', type: 'text', refText: 'Negative' }]],
  ['MP', 'Malaria Parasite (smear)', 'Haematology', 'Blood', 400, 4, [{ name: 'Malaria parasite', type: 'text', refText: 'Not seen' }]],
];

/**
 * Phase 2 demo data: suppliers, 22 medicines + 6 supplies with batches spread across store and
 * pharmacy (including a near-expiry, an expired and several low-stock items), 11 lab tests,
 * purchase orders in every state, lab orders across the workflow, and stock movements in the ledger.
 */
export async function seedPhase2(hid: Types.ObjectId, hospital: { code: string; numbering?: Record<string, unknown> | null }, actor: { id: Types.ObjectId; name: string }, portalPatientId?: Types.ObjectId) {
  const num = (key: Parameters<typeof nextNumber>[0], fallback: string) => nextNumber(key, (hospital.numbering?.[key] as string) ?? fallback, hospital.code, hid);
  const suppliers = await Supplier.insertMany(SUPPLIERS.map(([code, name, contactPerson, phone]) => ({ hospitalId: hid, code, name, contactPerson, phone, paymentTermsDays: 30 })));

  const items = await Item.insertMany([
    ...MEDICINES.map(([sku, name, genericName, form, strength, unit, purchasePrice, sellingPrice, reorderLevel, isControlled, s]) => ({
      hospitalId: hid, sku, name, genericName, form, strength, unit, purchasePrice, sellingPrice, reorderLevel, isControlled, category: 'Medicine', defaultSupplierId: suppliers[s]._id,
      searchName: `${name} ${genericName}`.toLowerCase(),
    })),
    ...SUPPLIES.map(([sku, name, category, unit, purchasePrice, sellingPrice, reorderLevel, s]) => ({
      hospitalId: hid, sku, name, category, unit, purchasePrice, sellingPrice, reorderLevel, defaultSupplierId: suppliers[s]._id, searchName: name.toLowerCase(),
    })),
  ]);

  // Stock: deterministic but varied. Items 5 (cetirizine) and 16 (insulin) are deliberately low;
  // amoxicillin has an older batch expiring in ~25 days (FEFO picks it first) and an expired one.
  const batches: Array<Record<string, unknown>> = [];
  const txs: Array<Record<string, unknown>> = [];
  const totals = new Map<string, { total: number; store: number; pharmacy: number }>();
  const addBatch = (itemIdx: number, batchNo: string, location: 'Main Store' | 'Pharmacy', expiry: Date, quantity: number) => {
    const item = items[itemIdx];
    const _id = new (item._id.constructor as typeof Types.ObjectId)();
    batches.push({ _id, hospitalId: hid, itemId: item._id, batchNo, location, expiryDate: expiry, mfgDate: new Date(expiry.getTime() - 730 * DAY), quantity, unitCost: item.purchasePrice, supplierId: item.defaultSupplierId, receivedAt: addDays(-40) });
    const t = totals.get(item._id.toString()) ?? { total: 0, store: 0, pharmacy: 0 };
    t.total += quantity;
    if (location === 'Main Store') t.store += quantity;
    else t.pharmacy += quantity;
    totals.set(item._id.toString(), t);
    txs.push({ hospitalId: hid, itemId: item._id, batchId: _id, batchNo, location, type: 'Purchase', quantity, balanceAfter: t.total, unitCost: item.purchasePrice, refType: 'Opening', reason: 'Opening stock', byName: actor.name, at: addDays(-40) });
  };
  MEDICINES.forEach((m, i) => {
    const low = i === 5 || i === 16;
    const base = low ? Math.max(2, Math.floor(m[8] / 4)) : m[8] * 2 + i * 10;
    addBatch(i, `${m[0].slice(4, 8)}${2400 + i}A`, 'Pharmacy', monthsOut(8 + (i % 10)), Math.ceil(base / 2));
    if (!low) addBatch(i, `${m[0].slice(4, 8)}${2500 + i}B`, 'Main Store', monthsOut(14 + (i % 8)), base);
  });
  addBatch(1, 'AMX2399N', 'Pharmacy', addDays(25), 40); // near expiry → FEFO first
  addBatch(1, 'AMX2301X', 'Pharmacy', addDays(-10), 30); // expired, must be written off
  addBatch(2, 'OMP2398N', 'Main Store', addDays(55), 60); // expiring within 90 days
  SUPPLIES.forEach((s, j) => addBatch(MEDICINES.length + j, `${s[0].slice(4, 8)}${3100 + j}`, 'Main Store', monthsOut(30), s[6] * 3));
  await Batch.insertMany(batches);
  await InventoryTransaction.insertMany(txs);
  for (const [id, t] of totals) {
    await Item.updateOne({ _id: id }, { $set: { currentStock: t.total, 'stockByLocation.Main Store': t.store, 'stockByLocation.Pharmacy': t.pharmacy } });
  }

  // Link Phase 1 prescriptions to the formulary so pharmacy can dispense them.
  const rxs = await Prescription.find({ hospitalId: hid });
  for (const rx of rxs) {
    for (const it of rx.items) {
      const match = items.find((i) => i.category === 'Medicine' && i.name.toLowerCase() === it.medicineName.toLowerCase().replace(' syrup', ' syrup 120ml'));
      if (match) it.medicineId = match._id;
    }
    await rx.save();
  }

  // Lab tests
  const tests = await LabTest.insertMany(LAB_TESTS.map(([code, name, category, sampleType, price, turnaroundHours, parameters]) => ({ hospitalId: hid, code, name, category, sampleType, price, turnaroundHours, parameters: parameters.map((p) => ({ type: 'numeric', ...p })) })));

  // Lab orders on recent closed visits: a mix of states for the worklist and dashboards.
  // The portal demo patient's latest visit comes first so their account has a verified report.
  const recent = await Visit.find({ hospitalId: hid, status: 'Closed' }).sort({ startedAt: -1 }).lean();
  const portalVisit = portalPatientId ? recent.find((v) => v.patientId.equals(portalPatientId)) : undefined;
  const visits = [...(portalVisit ? [portalVisit] : []), ...recent.filter((v) => v !== portalVisit)].slice(0, 8);
  const states = ['Verified', 'Verified', 'Verified', 'Completed', 'InProgress', 'SampleCollected', 'SamplePending', 'Ordered'] as const;
  for (const [n, v] of visits.entries()) {
    const status = states[n];
    const picked = [tests[n % tests.length], tests[(n + 3) % tests.length]];
    const patient = await Patient.findById(v.patientId).select('mrn firstName lastName').lean();
    const doctor = v.doctorId ? await Doctor.findById(v.doctorId).select('name').lean() : null;
    const orderNo = await num('labOrder', 'LAB-{yyyy}-{n:6}');
    const created = new Date(v.startedAt.getTime() + 20 * 60_000);
    const done = ['Completed', 'Verified'].includes(status);
    let abnormal = false;
    const orderItems = picked.map((t, k) => ({
      testId: t._id, testCode: t.code, testName: t.name, sampleType: t.sampleType, price: t.price,
      results: done
        ? t.parameters.map((p, q) => {
            const value = p.type === 'text' ? p.refText ?? 'Normal' : String(Math.round(((p.refLow ?? 0) + (p.refHigh ?? (p.refLow ?? 0) * 2 + 10)) / 2 * (n % 3 === 0 && q === 0 && k === 0 ? 1.6 : 1) * 10) / 10);
            const flag = p.type === 'text' ? 'N' : labFlag(value, p);
            if (flag !== 'N') abnormal = true;
            return { parameter: p.name, value, unit: p.unit, refRange: formatRange(p), flag };
          })
        : [],
    }));
    const t = picked.reduce((s, x) => s + x.price, 0);
    const invoiceNo = await num('invoice', 'INV-{yyyy}-{n:6}');
    const inv = await Invoice.create({
      hospitalId: hid, invoiceNo, patientId: v.patientId, mrn: patient!.mrn, patientName: `${patient!.firstName} ${patient!.lastName}`, visitId: v._id, source: 'Laboratory', status: 'Issued',
      items: picked.map((x) => ({ description: `${x.name} (${orderNo})`, quantity: 1, unitPrice: x.price, total: lineTotals({ quantity: 1, unitPrice: x.price }).total, sourceRef: `lab:pending` })),
      subtotal: t, total: t, balance: t, issuedAt: created, createdAt: created,
    });
    const order = await LabOrder.create({
      hospitalId: hid, orderNo, patientId: v.patientId, visitId: v._id, doctorId: v.doctorId, doctorName: doctor?.name, priority: n === 6 ? 'Urgent' : 'Routine', status,
      items: orderItems, invoiceId: inv._id, hasAbnormal: abnormal,
      sample: ['Ordered', 'SamplePending'].includes(status) ? undefined : { type: picked[0].sampleType, barcode: orderNo, collectedAt: new Date(created.getTime() + 30 * 60_000), collectedByName: 'Lab Technician' },
      technicianName: ['Ordered'].includes(status) ? undefined : 'Lab Technician',
      resultsEnteredAt: done ? new Date(created.getTime() + 4 * 3_600_000) : undefined,
      verifiedAt: status === 'Verified' ? new Date(created.getTime() + 5 * 3_600_000 + n * 1_800_000) : undefined,
      verifiedByName: status === 'Verified' ? 'Lab Supervisor' : undefined,
      history: [{ status: 'Ordered', at: created }, ...(status !== 'Ordered' ? [{ status, at: new Date(created.getTime() + 3_600_000) }] : [])],
      createdAt: created,
    });
    await Invoice.updateOne({ _id: inv._id }, { $set: { 'items.$[].sourceRef': `lab:${order._id}` } });
  }

  // Purchase orders in each state (received ones already reflected in opening stock).
  const poStates = ['Draft', 'PendingApproval', 'Approved', 'Ordered', 'Received'] as const;
  for (const [n, st] of poStates.entries()) {
    const sup = suppliers[n % suppliers.length];
    const lines = items.filter((i) => String(i.defaultSupplierId) === String(sup._id)).slice(0, 3);
    const poItems = lines.map((i) => {
      const quantity = Math.max(50, i.reorderLevel * 2);
      const t = lineTotals({ quantity, unitPrice: i.purchasePrice });
      return { itemId: i._id, sku: i.sku, itemName: i.name, unit: i.unit, quantity, receivedQuantity: st === 'Received' ? quantity : 0, unitPrice: i.purchasePrice, discount: 0, taxRate: 0, tax: 0, total: t.total };
    });
    const total = poItems.reduce((s, l) => s + l.total, 0);
    const po = await PurchaseOrder.create({
      hospitalId: hid, poNo: await num('purchaseOrder', 'PO-{yyyy}-{n:5}'), supplierId: sup._id, supplierName: sup.name, status: st, items: poItems, subtotal: total, total,
      expectedDelivery: addDays(7 + n), requestedByName: 'Inventory Manager', createdBy: actor.id,
      approvedByName: ['Approved', 'Ordered', 'Received'].includes(st) ? 'Hospital Administrator' : undefined,
      approvedAt: ['Approved', 'Ordered', 'Received'].includes(st) ? addDays(-5) : undefined,
      orderedAt: ['Ordered', 'Received'].includes(st) ? addDays(-4) : undefined,
      history: [{ status: 'Draft', byName: 'Inventory Manager', at: addDays(-6) }, ...(st !== 'Draft' ? [{ status: st, byName: 'System seed', at: addDays(-3) }] : [])],
    });
    if (st === 'Received') {
      await GoodsReceipt.create({
        hospitalId: hid, grnNo: await num('goodsReceipt', 'GRN-{yyyy}-{n:5}'), poId: po._id, poNo: po.poNo, supplierId: sup._id, location: 'Main Store', receivedByName: 'Inventory Manager', receivedAt: addDays(-2),
        lines: po.items.map((l) => ({ poLineId: l._id, itemId: l.itemId, itemName: l.itemName, batchNo: `GRN${n}${String(l.sku).slice(-3)}`, expiryDate: monthsOut(24), quantity: l.quantity, unitCost: l.unitPrice })),
      });
    }
  }

  return { suppliers: suppliers.length, items: items.length, batches: batches.length, labTests: tests.length, labOrders: visits.length, purchaseOrders: poStates.length };
}
