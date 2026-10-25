import type { z } from 'zod';
import {
  formatRange,
  labFlag,
  labOrderWorkflow,
  type CreateLabOrderInput,
  type EnterResultsInput,
  type LabOrderStatus,
  type LabTestInput,
  type labOrderListQuery,
} from '@hms/shared';
import { can, requireCtx } from '../../core/context';
import { withTransaction } from '../../core/db';
import { BusinessRuleError, ForbiddenError } from '../../core/errors';
import { diff, recordAudit, snapshot } from '../../core/audit/audit';
import { dateOnly, oid, orNotFound, skipOf } from '../../core/http';
import { nextNumber } from '../../core/numbering/numbering';
import { assertTransition } from '../../core/workflow';
import { notify } from '../../core/notifications/notify';
import { Hospital } from '../organization/organization.models';
import { Doctor } from '../staff/staff.models';
import { Patient } from '../patients/patient.models';
import { assertClinicalAccess } from '../patients/access';
import { ownOpenVisit } from '../clinical/clinical.service';
import { addCharges, cancelInvoice } from '../billing/billing.service';
import { Invoice } from '../billing/billing.models';
import { usersWithPermission } from '../identity/recipients';
import { Role, User } from '../identity/identity.models';
import { storage, validateUpload } from '../../core/storage/storage';
import { LabOrder, LabTest, type LabOrderDoc } from './lab.models';

// ── Test master ─────────────────────────────────────────────────────────────
export const listTests = (includeInactive = false) => LabTest.find(includeInactive ? {} : { isActive: true }).sort({ category: 1, name: 1 }).lean();

export async function createTest(input: LabTestInput) {
  const t = await LabTest.create(input);
  await recordAudit({ action: 'lab_test.created', module: 'Laboratory', entity: 'LabTest', entityId: t._id, after: t });
  return t.toObject();
}

export async function updateTest(id: string, input: LabTestInput) {
  const t = orNotFound(await LabTest.findById(id), 'Lab test');
  const before = snapshot(t) as Record<string, unknown>;
  t.set(input);
  await t.save();
  await recordAudit({ action: 'lab_test.updated', module: 'Laboratory', entity: 'LabTest', entityId: t._id, ...diff(before, snapshot(t) as Record<string, unknown>) });
  return t.toObject();
}

// ── Orders ──────────────────────────────────────────────────────────────────
async function move(order: LabOrderDoc, to: LabOrderStatus, note?: string) {
  const c = requireCtx();
  assertTransition(labOrderWorkflow, order.status as LabOrderStatus, to);
  const from = order.status;
  order.status = to;
  order.history.push({ status: to, at: new Date(), by: c.userId, byName: c.userName, note });
  await order.save();
  await recordAudit({ action: 'lab_order.status_changed', module: 'Laboratory', entity: 'LabOrder', entityId: order._id, before: { status: from }, after: { status: to }, meta: note ? { note } : undefined });
}

/** Doctor orders tests during an open consultation. The lab charges are billed immediately. */
export async function createOrder(visitId: string, input: CreateLabOrderInput) {
  const c = requireCtx();
  const visit = await ownOpenVisit(visitId);
  const tests = await LabTest.find({ _id: { $in: input.testIds.map(oid) }, isActive: true }).lean();
  if (tests.length !== new Set(input.testIds).size) throw new BusinessRuleError('One or more tests are unavailable');
  const [h, doctor] = await Promise.all([Hospital.findById(c.hospitalId).lean(), Doctor.findById(c.doctorId).select('name').lean()]);

  const order = await withTransaction(async () => {
    const orderNo = await nextNumber('labOrder', h!.numbering!.labOrder!, h!.code);
    const [o] = (await LabOrder.create([
      {
        orderNo,
        patientId: visit.patientId,
        visitId: visit._id,
        doctorId: c.doctorId,
        doctorName: doctor?.name,
        priority: input.priority,
        clinicalNotes: input.clinicalNotes,
        items: tests.map((t) => ({ testId: t._id, testCode: t.code, testName: t.name, sampleType: t.sampleType, price: t.price })),
        history: [{ status: 'Ordered', by: c.userId, byName: c.userName }],
      },
    ])) as LabOrderDoc[];
    const invoice = await addCharges({
      patientId: visit.patientId,
      visitId: visit._id,
      source: 'Laboratory',
      sourceRef: `lab:${o._id}`,
      items: tests.map((t) => ({ description: `${t.name} (${o.orderNo})`, quantity: 1, unitPrice: t.price, discount: 0, taxRate: 0 })),
    });
    o.invoiceId = invoice._id;
    await o.save();
    await recordAudit({ action: 'lab_order.created', module: 'Laboratory', entity: 'LabOrder', entityId: o._id, after: o });
    return o;
  });
  if (order.priority !== 'Routine') {
    await notifyLabStaff(`${order.priority} lab request`, `${order.orderNo}: ${order.items.map((i) => i.testName).join(', ')}`, `/laboratory/orders/${order._id}`);
  }
  return order.toObject();
}

async function notifyLabStaff(title: string, message: string, link: string) {
  const userIds = await usersWithPermission('lab.process');
  if (userIds.length) await notify({ type: 'General', title, message, userIds, link, priority: 'High' });
}

async function loadOrder(id: string) {
  return orNotFound((await LabOrder.findById(id)) as LabOrderDoc | null, 'Lab order');
}

/** Lab receives the request and the current technician takes ownership. */
export async function receive(id: string) {
  const c = requireCtx();
  return withTransaction(async () => {
    const o = await loadOrder(id);
    o.technicianId = c.userId;
    o.technicianName = c.userName;
    await move(o, 'SamplePending', 'Received by laboratory');
    return o.toObject();
  });
}

export async function collectSample(id: string, input: { sampleType?: string; notes?: string }) {
  const c = requireCtx();
  return withTransaction(async () => {
    const o = await loadOrder(id);
    if (o.status === 'Ordered') await move(o, 'SamplePending', 'Received by laboratory');
    o.sample = {
      type: input.sampleType ?? o.items[0].sampleType ?? 'Blood',
      barcode: o.orderNo,
      collectedAt: new Date(),
      collectedBy: c.userId,
      collectedByName: c.userName,
      notes: input.notes,
    } as never;
    if (!o.technicianId) {
      o.technicianId = c.userId;
      o.technicianName = c.userName;
    }
    await move(o, 'SampleCollected');
    return o.toObject();
  });
}

/** Lab supervisor assigns (or reassigns) the order to a technician; the technician is notified. */
export async function assignTechnician(id: string, userId: string) {
  const c = requireCtx();
  const technicians = (await listTechnicians()).map((u) => u._id.toString());
  if (!technicians.includes(userId)) throw new BusinessRuleError('The selected user is not a laboratory technician');
  const tech = orNotFound(await User.findById(userId).select('fullName').lean(), 'User');
  const o = await withTransaction(async () => {
    const o = await loadOrder(id);
    if (['Verified', 'Cancelled'].includes(o.status)) throw new BusinessRuleError(`Order is ${o.status.toLowerCase()}`);
    const before = o.technicianName;
    o.technicianId = tech._id;
    o.technicianName = tech.fullName;
    o.assignedByName = c.userName;
    o.assignedAt = new Date();
    o.history.push({ status: o.status, at: new Date(), by: c.userId, byName: c.userName, note: `Assigned to ${tech.fullName}` });
    await o.save();
    await recordAudit({ action: 'lab_order.assigned', module: 'Laboratory', entity: 'LabOrder', entityId: o._id, before: { technician: before }, after: { technician: tech.fullName } });
    return o;
  });
  if (!tech._id.equals(c.userId!)) await notify({ type: 'General', title: 'Lab order assigned to you', message: `${o.orderNo}: ${o.items.map((i) => i.testName).join(', ')} (${o.priority})`, userIds: [tech._id], link: `/laboratory/orders/${o._id}`, priority: o.priority === 'Routine' ? 'Normal' : 'High' });
  return o.toObject();
}

/**
 * Lab staff who can be assigned work: active users whose role grants `lab.process`. Administrator
 * roles (which hold every permission) are excluded so the list shows the laboratory team only.
 */
export async function listTechnicians() {
  const roles = await Role.find({ permissions: 'lab.process', $nor: [{ permissions: 'system.config' }] }).select('_id').lean();
  return User.find({ roleIds: { $in: roles.map((r) => r._id) }, isActive: true }).select('fullName email').sort({ fullName: 1 }).lean();
}

/** Attaches an externally produced report (PDF/image) to the order. */
export async function addAttachment(id: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }, description?: string) {
  const c = requireCtx();
  const o = await loadOrder(id);
  if (o.status === 'Cancelled') throw new BusinessRuleError('Order is cancelled');
  const { key, safeName, contentType } = validateUpload(file, `laboratory/${o._id}`);
  await storage.put(key, file.buffer, contentType);
  o.attachments.push({ fileName: safeName, contentType, sizeBytes: file.size, storageKey: key, description, uploadedBy: c.userId, uploadedByName: c.userName, at: new Date() });
  await o.save();
  await recordAudit({ action: 'lab_report.uploaded', module: 'Laboratory', entity: 'LabOrder', entityId: o._id, after: { fileName: safeName, description } });
  return o.toObject();
}

export async function getAttachment(id: string, attachmentId: string) {
  const o = orNotFound(await LabOrder.findById(id).lean(), 'Lab order');
  await assertOrderAccess(o);
  const a = orNotFound(o.attachments.find((x) => x._id.equals(attachmentId)), 'Attachment');
  await recordAudit({ action: 'lab_report.downloaded', module: 'Laboratory', entity: 'LabOrder', entityId: o._id, meta: { fileName: a.fileName } });
  return { attachment: a, data: await storage.get(a.storageKey) };
}

export async function startProcessing(id: string) {
  const c = requireCtx();
  return withTransaction(async () => {
    const o = await loadOrder(id);
    if (o.assignedAt && o.technicianId && !o.technicianId.equals(c.userId!) && !can('lab.verify') && !can('lab.manage')) {
      throw new ForbiddenError(`This order is assigned to ${o.technicianName}`);
    }
    o.startedAt = new Date();
    o.technicianId = c.userId;
    o.technicianName = c.userName;
    await move(o, 'InProgress');
    return o.toObject();
  });
}

/**
 * Stores results with server-computed flags against each test's reference and critical ranges.
 * Saving as draft keeps the order In progress; final saving requires every parameter and marks it
 * Completed (awaiting verification).
 */
export async function enterResults(id: string, input: EnterResultsInput) {
  const c = requireCtx();
  return withTransaction(async () => {
    const o = await loadOrder(id);
    if (o.status !== 'InProgress') throw new BusinessRuleError(`Results can only be entered while In progress (currently ${o.status})`);
    const tests = await LabTest.find({ _id: { $in: o.items.map((i) => i.testId) } }).lean();
    const before = o.items.map((i) => ({ test: i.testName, results: i.results.map((r) => ({ ...r })) }));
    let abnormal = false;
    let critical = false;
    for (const item of o.items) {
      const test = tests.find((t) => t._id.equals(item.testId))!;
      const entered = input.results.filter((r) => r.itemId === item._id.toString());
      const results = [];
      for (const p of test.parameters) {
        const r = entered.find((e) => e.parameter === p.name);
        if (!r) {
          if (!input.draft) throw new BusinessRuleError(`Missing result: ${item.testName} — ${p.name}`);
          continue;
        }
        if (p.type === 'numeric' && Number.isNaN(Number(r.value))) throw new BusinessRuleError(`${p.name} must be a number`);
        const flag = p.type === 'numeric' ? labFlag(r.value, p) : 'N';
        if (flag !== 'N') abnormal = true;
        if (flag === 'LL' || flag === 'HH') critical = true;
        results.push({ parameter: p.name, value: r.value, unit: p.unit, refRange: formatRange(p), flag });
      }
      item.results = results as never;
    }
    o.comments = input.comments;
    o.hasAbnormal = abnormal;
    o.hasCritical = critical;
    o.resultsEnteredAt = new Date();
    o.technicianId = c.userId;
    o.technicianName = c.userName;
    await o.save();
    const audited = before.some((b) => b.results.length) ? 'lab_result.modified' : 'lab_result.entered';
    await recordAudit({ action: audited, module: 'Laboratory', entity: 'LabOrder', entityId: o._id, before, after: o.items.map((i) => ({ test: i.testName, results: i.results })) });
    if (!input.draft) await move(o, 'Completed', 'Results entered');
    return o.toObject();
  });
}

/** A second person verifies. Verified results are released to the doctor and the patient. */
export async function verify(id: string) {
  const c = requireCtx();
  const order = await withTransaction(async () => {
    const o = await loadOrder(id);
    if (o.technicianId && c.userId && o.technicianId.equals(c.userId)) throw new ForbiddenError('Results must be verified by someone other than the technician who entered them');
    o.verifiedAt = new Date();
    o.verifiedBy = c.userId;
    o.verifiedByName = c.userName;
    await move(o, 'Verified');
    return o;
  });
  const doctor = order.doctorId ? await Doctor.findById(order.doctorId).select('userId').lean() : null;
  if (doctor?.userId) {
    await notify({
      type: 'LabResultAvailable',
      title: order.hasCritical ? 'CRITICAL lab result' : 'Lab results ready',
      message: `${order.orderNo}: ${order.items.map((i) => i.testName).join(', ')}${order.hasAbnormal ? ' — abnormal values' : ''}`,
      userIds: [doctor.userId],
      link: `/laboratory/orders/${order._id}`,
      priority: order.hasCritical ? 'Critical' : order.hasAbnormal ? 'High' : 'Normal',
    });
  }
  await notify({ type: 'LabResultAvailable', title: 'Lab report available', message: `Your report ${order.orderNo} is ready to view.`, patientId: order.patientId, external: ['Sms', 'Email'] });
  return order.toObject();
}

export async function rejectResults(id: string, reason: string) {
  return withTransaction(async () => {
    const o = await loadOrder(id);
    await move(o, 'InProgress', `Returned for correction: ${reason}`);
    return o.toObject();
  });
}

export async function cancelOrder(id: string, reason: string) {
  const c = requireCtx();
  return withTransaction(async () => {
    const o = await loadOrder(id);
    if (!c.permissions.has('lab.process') && !(c.doctorId && o.doctorId?.equals(c.doctorId))) throw new ForbiddenError();
    o.cancelReason = reason;
    await move(o, 'Cancelled', reason);
    // Unpaid lab charges are voided with the order; paid ones need a refund from accounts.
    if (o.invoiceId) {
      const inv = await Invoice.findById(o.invoiceId).lean();
      if (inv && inv.paid === 0 && ['Issued', 'Draft'].includes(inv.status)) await cancelInvoice(o.invoiceId.toString(), `Lab order ${o.orderNo} cancelled`);
    }
    return o.toObject();
  });
}

/** Ordering doctor acknowledges the verified report. */
export async function review(id: string) {
  const c = requireCtx();
  const o = await loadOrder(id);
  if (o.status !== 'Verified') throw new BusinessRuleError('Only verified results can be reviewed');
  if (!c.doctorId) throw new ForbiddenError('Only doctors can review results');
  await assertClinicalAccess(o.patientId);
  o.reviewedAt = new Date();
  o.reviewedByName = c.userName;
  await o.save();
  await recordAudit({ action: 'lab_result.reviewed', module: 'Laboratory', entity: 'LabOrder', entityId: o._id });
  return o.toObject();
}

/** Who may read an order: lab staff, the care team, or the patient once verified. */
async function assertOrderAccess(o: { patientId: import('mongoose').Types.ObjectId; status: string }) {
  const c = requireCtx();
  if (c.patientId) {
    if (!c.patientId.equals(o.patientId) || o.status !== 'Verified') throw new ForbiddenError();
    return;
  }
  if (can('lab.process') || can('lab.verify')) return;
  await assertClinicalAccess(o.patientId);
}

export async function getOrder(id: string) {
  const o = orNotFound(await LabOrder.findById(id).lean(), 'Lab order');
  await assertOrderAccess(o);
  const patient = await Patient.findById(o.patientId).select('mrn firstName lastName gender dateOfBirth phone allergies').lean();
  return { ...o, patient: patient && { id: patient._id, mrn: patient.mrn, name: `${patient.firstName} ${patient.lastName}`, gender: patient.gender, dateOfBirth: patient.dateOfBirth, phone: patient.phone } };
}

export async function listOrders(q: z.infer<typeof labOrderListQuery>) {
  const c = requireCtx();
  const filter: Record<string, unknown> = {};
  if (c.patientId) {
    filter.patientId = c.patientId;
    filter.status = 'Verified';
  } else {
    const lab = can('lab.process') || can('lab.verify');
    if (q.patientId) {
      if (!lab) await assertClinicalAccess(q.patientId);
      filter.patientId = oid(q.patientId);
    } else if (!lab || q.mine) {
      if (!c.doctorId) throw new ForbiddenError();
      filter.doctorId = c.doctorId;
    }
    if (q.assignedToMe) filter.technicianId = c.userId;
    if (q.status) filter.status = q.status;
    else if (q.statuses) filter.status = { $in: q.statuses.split(',').map((s) => s.trim()) };
    if (q.priority) filter.priority = q.priority;
  }
  if (q.from || q.to) {
    const to = q.to ? new Date(dateOnly(q.to).getTime() + 86_400_000) : undefined;
    filter.createdAt = { ...(q.from ? { $gte: dateOnly(q.from) } : {}), ...(to ? { $lt: to } : {}) };
  }
  const [items, total] = await Promise.all([
    LabOrder.find(filter)
      .select('-history')
      .populate('patientId', 'mrn firstName lastName gender dateOfBirth')
      .sort({ createdAt: 1 })
      .skip(skipOf(q))
      .limit(q.pageSize)
      .lean(),
    LabOrder.countDocuments(filter),
  ]);
  return {
    items: items.map((o) => {
      const p = o.patientId as unknown as { _id: string; mrn: string; firstName: string; lastName: string; gender: string };
      return { ...o, patientId: p?._id, patient: p && { id: p._id, mrn: p.mrn, name: `${p.firstName} ${p.lastName}`, gender: p.gender } };
    }),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

/** Worklist counters and turnaround for the lab dashboard. */
export async function labStats() {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [byStatus, tat] = await Promise.all([
    LabOrder.aggregate([{ $match: { status: { $nin: ['Verified', 'Cancelled'] } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    LabOrder.aggregate([
      { $match: { status: 'Verified', verifiedAt: { $gte: since } } },
      { $set: { hours: { $divide: [{ $subtract: ['$verifiedAt', '$createdAt'] }, 3_600_000] } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.testName', avgHours: { $avg: '$hours' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);
  const count = (s: string) => byStatus.find((b) => b._id === s)?.count ?? 0;
  return {
    pending: byStatus.reduce((s, b) => s + b.count, 0),
    toReceive: count('Ordered'),
    toCollect: count('SamplePending'),
    toProcess: count('SampleCollected'),
    inProgress: count('InProgress'),
    toVerify: count('Completed'),
    turnaround: tat.map((t) => ({ test: t._id, avgHours: Math.round(t.avgHours * 10) / 10, count: t.count })),
  };
}
