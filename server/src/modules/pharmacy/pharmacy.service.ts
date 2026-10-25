import { Types } from 'mongoose';
import { allocateFefo, prescriptionWorkflow, round2, type DispenseInput, type PrescriptionStatus } from '@hms/shared';
import { can, requireCtx } from '../../core/context';
import { withTransaction } from '../../core/db';
import { BusinessRuleError, ForbiddenError } from '../../core/errors';
import { recordAudit } from '../../core/audit/audit';
import { escapeRegex, oid, orNotFound, skipOf, sortBy } from '../../core/http';
import { nextNumber } from '../../core/numbering/numbering';
import { assertTransition } from '../../core/workflow';
import { notify } from '../../core/notifications/notify';
import { Hospital } from '../organization/organization.models';
import { Patient } from '../patients/patient.models';
import { Prescription } from '../clinical/clinical.models';
import { addCharges } from '../billing/billing.service';
import { Batch, Item } from '../inventory/inventory.models';
import { issueFefo } from '../inventory/stock.service';
import { ControlledDrugLog, Dispense } from './pharmacy.models';
import { createSchedulesForDispense } from '../medication/medication.service';

const PHARMACY = 'Pharmacy' as const;

/** Medicines a doctor can prescribe, with what the pharmacy can actually supply right now. */
export async function formulary(search?: string) {
  const filter: Record<string, unknown> = { category: 'Medicine', isActive: true };
  if (search) filter.searchName = new RegExp(escapeRegex(search.toLowerCase()));
  const items = await Item.find(filter).sort({ name: 1 }).limit(25).lean();
  const stock = await usableByItem(items.map((i) => i._id));
  return items.map((i) => ({ _id: i._id, name: i.name, genericName: i.genericName, strength: i.strength, form: i.form, unit: i.unit, sellingPrice: i.sellingPrice, isControlled: i.isControlled, available: stock.get(i._id.toString()) ?? 0 }));
}

async function usableByItem(ids: Types.ObjectId[]) {
  const rows = await Batch.aggregate([
    { $match: { itemId: { $in: ids }, location: PHARMACY, quantity: { $gt: 0 }, expiryDate: { $gt: new Date() } } },
    { $group: { _id: '$itemId', qty: { $sum: '$quantity' } } },
  ]);
  return new Map<string, number>(rows.map((r) => [r._id.toString(), r.qty]));
}

/** Prescriptions awaiting dispensing, oldest first, with a stock-readiness hint. */
export async function queue(q: { page: number; pageSize: number; search?: string }) {
  const filter: Record<string, unknown> = { status: { $in: ['Active', 'PartiallyDispensed'] } };
  if (q.search) filter.prescriptionNo = new RegExp(`^${escapeRegex(q.search.toUpperCase())}`);
  const [rows, total] = await Promise.all([
    Prescription.find(filter).populate('patientId', 'mrn firstName lastName').sort({ prescribedAt: 1 }).skip(skipOf(q)).limit(q.pageSize).lean(),
    Prescription.countDocuments(filter),
  ]);
  const linked = rows.flatMap((r) => r.items.map((i) => i.medicineId).filter(Boolean)) as Types.ObjectId[];
  const stock = await usableByItem(linked);
  return {
    items: rows.map((r) => {
      const p = r.patientId as unknown as { _id: Types.ObjectId; mrn: string; firstName: string; lastName: string };
      const lines = r.items.map((i) => {
        const remaining = i.quantity - i.dispensedQuantity;
        const available = i.medicineId ? stock.get(i.medicineId.toString()) ?? 0 : null;
        return { medicineName: i.medicineName, remaining, available, linked: !!i.medicineId };
      });
      const ready = lines.every((l) => l.remaining <= 0 || (l.available !== null && l.available >= l.remaining));
      return { _id: r._id, prescriptionNo: r.prescriptionNo, status: r.status, prescribedAt: r.prescribedAt, doctorName: r.doctorName, patient: { id: p._id, mrn: p.mrn, name: `${p.firstName} ${p.lastName}` }, lines, stockReady: ready };
    }),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

/**
 * Dispensing workspace: for each prescribed line, the matched stock item (linked by the doctor or
 * matched by name), remaining quantity, and the FEFO batches that would be used.
 */
export async function dispenseContext(prescriptionId: string) {
  const rx = orNotFound(await Prescription.findById(prescriptionId).lean(), 'Prescription');
  const patient = orNotFound(await Patient.findById(rx.patientId).select('mrn firstName lastName dateOfBirth gender allergies').lean(), 'Patient');
  const lines = [];
  for (const i of rx.items) {
    let item = i.medicineId ? await Item.findById(i.medicineId).lean() : null;
    if (!item) {
      const firstWord = i.medicineName.split(/\s+/)[0];
      item = await Item.findOne({ category: 'Medicine', isActive: true, searchName: new RegExp(`^${escapeRegex(firstWord.toLowerCase())}`) }).lean();
    }
    const batches = item ? await Batch.find({ itemId: item._id, location: PHARMACY, quantity: { $gt: 0 } }).sort({ expiryDate: 1 }).lean() : [];
    const remaining = i.quantity - i.dispensedQuantity;
    const plan = allocateFefo(batches.map((b) => ({ id: b._id.toString(), batchNo: b.batchNo, expiryDate: b.expiryDate, quantity: b.quantity })), Math.max(remaining, 0));
    lines.push({
      prescriptionItemId: i._id,
      medicineName: i.medicineName,
      dosage: i.dosage,
      frequency: i.frequency,
      durationDays: i.durationDays,
      instructions: i.instructions,
      prescribed: i.quantity,
      dispensed: i.dispensedQuantity,
      remaining,
      item: item && { _id: item._id, name: item.name, sku: item.sku, unit: item.unit, sellingPrice: item.sellingPrice, isControlled: item.isControlled, linkedByDoctor: !!i.medicineId },
      batches: batches.map((b) => ({ _id: b._id, batchNo: b.batchNo, expiryDate: b.expiryDate, quantity: b.quantity, isExpired: b.expiryDate.getTime() <= Date.now() })),
      fefo: plan,
    });
  }
  const history = await Dispense.find({ prescriptionId: rx._id }).sort({ dispensedAt: 1 }).lean();
  return {
    prescription: { _id: rx._id, prescriptionNo: rx.prescriptionNo, status: rx.status, prescribedAt: rx.prescribedAt, doctorName: rx.doctorName, notes: rx.notes },
    patient: { id: patient._id, mrn: patient.mrn, name: `${patient.firstName} ${patient.lastName}`, gender: patient.gender, dateOfBirth: patient.dateOfBirth, allergies: patient.allergies.filter((a) => !a.removedAt) },
    lines,
    history,
  };
}

export async function dispense(prescriptionId: string, input: DispenseInput) {
  const c = requireCtx();
  const h = orNotFound(await Hospital.findById(c.hospitalId).lean(), 'Hospital');
  const result = await withTransaction(async () => {
    const rx = orNotFound(await Prescription.findById(prescriptionId), 'Prescription');
    if (!['Active', 'PartiallyDispensed'].includes(rx.status)) throw new BusinessRuleError(`Prescription is ${rx.status}`);
    const patient = orNotFound(await Patient.findById(rx.patientId).select('mrn firstName lastName').lean(), 'Patient');
    const dispenseNo = await nextNumber('dispense', h.numbering?.dispense ?? 'DSP-{yyyy}-{n:6}', h.code);
    const dispenseId = new Types.ObjectId();
    const lines = [];
    const controlled = [];

    for (const l of input.lines) {
      const rxItem = rx.items.id(l.prescriptionItemId);
      if (!rxItem) throw new BusinessRuleError('Line does not belong to this prescription');
      const remaining = rxItem.quantity - rxItem.dispensedQuantity;
      if (l.quantity > remaining) throw new BusinessRuleError(`${rxItem.medicineName}: only ${remaining} remaining on the prescription`);
      const item = await Item.findOne({ _id: oid(l.itemId), category: 'Medicine', isActive: true }).lean();
      if (!item) throw new BusinessRuleError(`Stock item for ${rxItem.medicineName} not found`);
      if (item.isControlled) {
        if (!can('pharmacy.controlled')) throw new ForbiddenError(`${item.name} is a controlled medicine; you are not authorised to dispense it`);
        if (!input.witnessName) throw new BusinessRuleError(`A witness is required to dispense controlled medicine ${item.name}`);
      }
      const allocations = await issueFefo(item._id, PHARMACY, l.quantity, 'Dispensing', { refType: 'Dispense', refId: dispenseId, refNo: dispenseNo });
      rxItem.dispensedQuantity += l.quantity;
      if (!rxItem.medicineId) rxItem.medicineId = item._id;
      const total = round2(l.quantity * item.sellingPrice);
      lines.push({ prescriptionItemId: rxItem._id, itemId: item._id, itemName: item.name, quantity: l.quantity, unitPrice: item.sellingPrice, total, isControlled: item.isControlled, allocations: allocations.map((a) => ({ ...a, batchId: oid(a.batchId) })) });
      if (item.isControlled) {
        const after = await Item.findById(item._id).select('currentStock').lean();
        for (const a of allocations) controlled.push({ itemId: item._id, itemName: item.name, batchNo: a.batchNo, quantity: a.quantity, balanceAfter: after?.currentStock, patientId: patient._id, patientName: `${patient.firstName} ${patient.lastName}`, mrn: patient.mrn, prescriptionNo: rx.prescriptionNo, prescriberName: rx.doctorName, dispenseId, dispensedByName: c.userName, witnessName: input.witnessName });
      }
    }

    const fully = rx.items.every((i) => i.dispensedQuantity >= i.quantity);
    const next: PrescriptionStatus = fully ? 'Dispensed' : 'PartiallyDispensed';
    if (rx.status !== next) {
      assertTransition(prescriptionWorkflow, rx.status as PrescriptionStatus, next);
      rx.status = next;
    }
    await rx.save();
    // Reminder schedules start from the first dispense of each line.
    await createSchedulesForDispense(rx, lines.map((l) => l.prescriptionItemId));

    const invoice = await addCharges({
      patientId: rx.patientId,
      visitId: rx.visitId,
      source: 'Pharmacy',
      sourceRef: `dispense:${dispenseId}`,
      items: lines.map((l) => ({ description: `${l.itemName} × ${l.quantity}`, quantity: l.quantity, unitPrice: l.unitPrice, discount: 0, taxRate: 0 })),
    });
    const [record] = await Dispense.create([
      { _id: dispenseId, dispenseNo, prescriptionId: rx._id, prescriptionNo: rx.prescriptionNo, patientId: rx.patientId, patientName: `${patient.firstName} ${patient.lastName}`, mrn: patient.mrn, lines, total: round2(lines.reduce((s, l) => s + l.total, 0)), invoiceId: invoice._id, witnessName: input.witnessName, notes: input.notes, dispensedByName: c.userName },
    ]);
    if (controlled.length) await ControlledDrugLog.insertMany(controlled.map((x) => ({ ...x, hospitalId: c.hospitalId })));
    await recordAudit({ action: 'medicine.dispensed', module: 'Pharmacy', entity: 'Prescription', entityId: rx._id, after: { dispenseNo, status: rx.status, lines: lines.map((l) => ({ item: l.itemName, quantity: l.quantity, batches: l.allocations.map((a) => `${a.batchNo}×${a.quantity}`) })) } });
    return { dispense: record.toObject(), prescriptionStatus: rx.status, invoiceId: invoice._id, patientId: rx.patientId };
  });
  await notify({ type: 'PrescriptionAvailable', title: 'Medicines dispensed', message: `Your medicines (${result.dispense.dispenseNo}) have been dispensed.`, patientId: result.patientId });
  return result;
}

export async function history(q: { page: number; pageSize: number; search?: string; sort?: string }) {
  const filter: Record<string, unknown> = {};
  if (q.search) filter.$or = [{ dispenseNo: new RegExp(`^${escapeRegex(q.search.toUpperCase())}`) }, { mrn: q.search.toUpperCase() }, { prescriptionNo: q.search.toUpperCase() }];
  const [items, total] = await Promise.all([
    Dispense.find(filter).sort(sortBy(q.sort, { dispensed: 'dispensedAt', dispenseNo: 'dispenseNo', total: 'total' }, { dispensedAt: -1 })).skip(skipOf(q)).limit(q.pageSize).lean(),
    Dispense.countDocuments(filter),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

export async function controlledRegister(q: { page: number; pageSize: number }) {
  const [items, total] = await Promise.all([ControlledDrugLog.find().sort({ at: -1 }).skip(skipOf(q)).limit(q.pageSize).lean(), ControlledDrugLog.countDocuments()]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}
