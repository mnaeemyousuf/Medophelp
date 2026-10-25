import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  bedWorkflow,
  type AdmitInput,
  type BedStatus,
  type DischargeInput,
  type admissionListQuery,
  type bedSchema,
  type roomSchema,
  type wardSchema,
} from '@hms/shared';
import { can, requireCtx } from '../../core/context';
import { withTransaction } from '../../core/db';
import { BusinessRuleError, ConflictError, ForbiddenError } from '../../core/errors';
import { diff, recordAudit, snapshot } from '../../core/audit/audit';
import { dateOnly, oid, orNotFound, skipOf, todayString, sortBy } from '../../core/http';
import { nextNumber } from '../../core/numbering/numbering';
import { assertTransition } from '../../core/workflow';
import { notify } from '../../core/notifications/notify';
import { Hospital } from '../organization/organization.models';
import { Doctor, Nurse } from '../staff/staff.models';
import { Patient } from '../patients/patient.models';
import { Visit } from '../appointments/appointment.models';
import { assertClinicalAccess } from '../patients/access';
import { ClinicalNote, Prescription, VitalSign } from '../clinical/clinical.models';
import { LabOrder } from '../laboratory/lab.models';
import { addCharges } from '../billing/billing.service';
import { Admission, Bed, Room, Ward, type AdmissionDoc, type BedDoc } from './ipd.models';

const HOUR = 3_600_000;

// ── Configuration ───────────────────────────────────────────────────────────
export const listWards = () => Ward.find().sort({ name: 1 }).lean();

export async function saveWard(input: z.infer<typeof wardSchema>, id?: string) {
  const w = id ? orNotFound(await Ward.findById(id), 'Ward') : new Ward();
  const before = id ? (snapshot(w) as Record<string, unknown>) : undefined;
  w.set({ ...input, departmentId: input.departmentId ? oid(input.departmentId) : undefined });
  await w.save();
  await recordAudit({ action: id ? 'ward.updated' : 'ward.created', module: 'IPD', entity: 'Ward', entityId: w._id, ...(before ? diff(before, snapshot(w) as Record<string, unknown>) : { after: w }) });
  return w.toObject();
}

export async function saveRoom(input: z.infer<typeof roomSchema>) {
  orNotFound(await Ward.exists({ _id: oid(input.wardId) }), 'Ward');
  const r = await Room.create({ ...input, wardId: oid(input.wardId) });
  await recordAudit({ action: 'room.created', module: 'IPD', entity: 'Room', entityId: r._id, after: r });
  return r.toObject();
}

export async function saveBed(input: z.infer<typeof bedSchema>) {
  const room = orNotFound(await Room.findById(input.roomId).lean(), 'Room');
  const b = await Bed.create({ roomId: room._id, wardId: room.wardId, bedNo: input.bedNo, chargePerDay: input.chargePerDay });
  await recordAudit({ action: 'bed.created', module: 'IPD', entity: 'Bed', entityId: b._id, after: b });
  return b.toObject();
}

/** Wards → rooms → beds with the current occupant, for the bed board. */
export async function bedBoard() {
  const [wards, rooms, beds, admissions] = await Promise.all([
    Ward.find({ isActive: true }).sort({ name: 1 }).lean(),
    Room.find({ isActive: true }).sort({ roomNo: 1 }).lean(),
    Bed.find().sort({ bedNo: 1 }).lean(),
    Admission.find({ status: 'Admitted' }).select('admissionNo patientId bedId attendingDoctorName admittedAt expectedDischargeAt').populate('patientId', 'mrn firstName lastName gender dateOfBirth').lean(),
  ]);
  const byBed = new Map(admissions.filter((a) => a.bedId).map((a) => [a.bedId!.toString(), a]));
  const count = (s: BedStatus) => beds.filter((b) => b.status === s).length;
  return {
    totals: { beds: beds.length, available: count('Available'), occupied: count('Occupied'), reserved: count('Reserved'), cleaning: count('Cleaning'), maintenance: count('Maintenance') },
    wards: wards.map((w) => ({
      ...w,
      rooms: rooms
        .filter((r) => r.wardId.equals(w._id))
        .map((r) => ({
          ...r,
          beds: beds
            .filter((b) => b.roomId.equals(r._id))
            .map((b) => {
              const a = byBed.get(b._id.toString());
              const p = a?.patientId as unknown as { _id: Types.ObjectId; mrn: string; firstName: string; lastName: string; gender: string } | undefined;
              return {
                ...b,
                ratePerDay: b.chargePerDay ?? w.chargePerDay,
                occupant: a && p ? { admissionId: a._id, admissionNo: a.admissionNo, patientId: p._id, name: `${p.firstName} ${p.lastName}`.trim(), mrn: p.mrn, gender: p.gender, doctor: a.attendingDoctorName, admittedAt: a.admittedAt, expectedDischargeAt: a.expectedDischargeAt } : undefined,
              };
            }),
        })),
    })),
  };
}

/** Housekeeping moves only. Occupancy is changed by admit/transfer/discharge, never by hand. */
export async function setBedStatus(bedId: string, status: BedStatus, note?: string, reservedForPatientId?: string) {
  const bed = orNotFound((await Bed.findById(bedId)) as BedDoc | null, 'Bed');
  if (status === 'Occupied' || bed.status === 'Occupied') throw new BusinessRuleError('Occupancy changes only through admission, transfer or discharge');
  assertTransition(bedWorkflow, bed.status as BedStatus, status);
  const from = bed.status;
  bed.status = status;
  bed.statusNote = note;
  bed.statusChangedAt = new Date();
  bed.reservedForPatientId = status === 'Reserved' && reservedForPatientId ? oid(reservedForPatientId) : undefined;
  await bed.save();
  await recordAudit({ action: 'bed.status_changed', module: 'IPD', entity: 'Bed', entityId: bed._id, before: { status: from }, after: { status, note } });
  return bed.toObject();
}

// ── Admissions ──────────────────────────────────────────────────────────────

/** Atomically claims a bed; fails if someone else took it a moment ago. */
async function occupyBed(bedId: Types.ObjectId, admissionId: Types.ObjectId, patientId: Types.ObjectId) {
  const bed = (await Bed.findOneAndUpdate(
    {
      _id: bedId,
      $or: [{ status: 'Available' }, { status: 'Reserved', $or: [{ reservedForPatientId: null }, { reservedForPatientId: patientId }] }],
    },
    { $set: { status: 'Occupied', currentAdmissionId: admissionId, statusChangedAt: new Date() }, $unset: { reservedForPatientId: 1, statusNote: 1 } },
    { new: true },
  )) as BedDoc | null;
  if (!bed) throw new ConflictError('That bed is no longer available. Choose another bed.', 'bed_unavailable');
  const ward = orNotFound(await Ward.findById(bed.wardId).lean(), 'Ward');
  const room = await Room.findById(bed.roomId).lean();
  return { bed, ward, room, rate: bed.chargePerDay ?? ward.chargePerDay };
}

async function releaseBed(bedId: Types.ObjectId | null | undefined) {
  if (!bedId) return;
  await Bed.updateOne({ _id: bedId, status: 'Occupied' }, { $set: { status: 'Cleaning', statusChangedAt: new Date() }, $unset: { currentAdmissionId: 1 } });
}

/**
 * Admission core, without its own transaction so callers (e.g. the emergency disposition) can
 * compose it into theirs. Use `admit()` from routes.
 */
export async function admitCore(input: AdmitInput, extra: { emergencyCaseId?: Types.ObjectId } = {}) {
  const c = requireCtx();
  const patient = orNotFound(await Patient.findById(input.patientId).select('mrn firstName lastName').lean(), 'Patient');
  if (await Admission.exists({ patientId: patient._id, status: 'Admitted' })) throw new ConflictError('This patient is already admitted', 'already_admitted');
  const doctor = orNotFound(await Doctor.findById(input.attendingDoctorId).lean(), 'Doctor');
  const nurse = input.assignedNurseId ? await Nurse.findById(input.assignedNurseId).lean() : null;
  const h = orNotFound(await Hospital.findById(c.hospitalId).lean(), 'Hospital');

  const admissionId = new Types.ObjectId();
  const { bed, ward, room, rate } = await occupyBed(oid(input.bedId), admissionId, patient._id);
  const [visitNo, admissionNo] = [await nextNumber('visit', h.numbering!.visit!, h.code), await nextNumber('admission', h.numbering?.admission ?? 'ADM-{yyyy}-{n:6}', h.code)];
  const [visit] = await Visit.create([{ visitNo, patientId: patient._id, doctorId: doctor._id, departmentId: ward.departmentId ?? doctor.departmentId, type: 'IPD', chiefComplaint: input.reason }]);
  const now = new Date();
  const [adm] = (await Admission.create([
    {
      _id: admissionId,
      admissionNo,
      patientId: patient._id,
      visitId: visit._id,
      source: input.source,
      emergencyCaseId: extra.emergencyCaseId,
      attendingDoctorId: doctor._id,
      attendingDoctorName: doctor.name,
      departmentId: ward.departmentId ?? doctor.departmentId,
      assignedNurseId: nurse?._id,
      assignedNurseName: nurse?.name,
      bedId: bed._id,
      wardId: ward._id,
      stays: [{ bedId: bed._id, wardId: ward._id, wardName: ward.name, roomNo: room?.roomNo, bedNo: bed.bedNo, ratePerDay: rate, from: now, reason: 'Admission' }],
      reason: input.reason,
      provisionalDiagnosis: input.provisionalDiagnosis,
      admittedAt: now,
      expectedDischargeAt: input.expectedDischarge ? dateOnly(input.expectedDischarge) : undefined,
      notes: [{ kind: 'Event', text: `Admitted to ${ward.name}, room ${room?.roomNo ?? '—'}, bed ${bed.bedNo}`, authorUserId: c.userId, authorName: c.userName }],
    },
  ])) as AdmissionDoc[];
  await recordAudit({ action: 'patient.admitted', module: 'IPD', entity: 'Admission', entityId: adm._id, after: adm });
  const recipients = [doctor.userId, nurse?.userId].filter(Boolean) as Types.ObjectId[];
  if (recipients.length) {
    await notify({ type: 'General', title: 'New admission', message: `${patient.firstName} ${patient.lastName} (${patient.mrn}) admitted to ${ward.name} bed ${bed.bedNo}.`, userIds: recipients, link: `/ipd/admissions/${adm._id}` });
  }
  return adm;
}

export async function admit(input: AdmitInput) {
  return withTransaction(async () => (await admitCore(input)).toObject());
}

async function loadActive(id: string) {
  const a = orNotFound((await Admission.findById(id)) as AdmissionDoc | null, 'Admission');
  if (a.status !== 'Admitted') throw new BusinessRuleError(`This admission is ${a.status}`);
  return a;
}

export async function transfer(id: string, input: { bedId: string; reason: string }) {
  const c = requireCtx();
  return withTransaction(async () => {
    const a = await loadActive(id);
    if (a.bedId?.equals(input.bedId)) throw new BusinessRuleError('The patient is already in this bed');
    const { bed, ward, room, rate } = await occupyBed(oid(input.bedId), a._id, a.patientId);
    const now = new Date();
    const open = a.stays.at(-1);
    if (open && !open.to) open.to = now;
    await releaseBed(a.bedId);
    a.stays.push({ bedId: bed._id, wardId: ward._id, wardName: ward.name, roomNo: room?.roomNo, bedNo: bed.bedNo, ratePerDay: rate, from: now, reason: input.reason });
    a.bedId = bed._id;
    a.wardId = ward._id;
    a.notes.push({ kind: 'Event', text: `Transferred to ${ward.name}, room ${room?.roomNo ?? '—'}, bed ${bed.bedNo}: ${input.reason}`, authorUserId: c.userId, authorName: c.userName, at: now });
    await a.save();
    await recordAudit({ action: 'patient.transferred', module: 'IPD', entity: 'Admission', entityId: a._id, before: { bedNo: open?.bedNo, ward: open?.wardName }, after: { bedNo: bed.bedNo, ward: ward.name, reason: input.reason } });
    return a.toObject();
  });
}

/** Doctors write progress notes, nurses nursing notes; neither can edit the other's. Append-only. */
export async function addNote(id: string, text: string) {
  const c = requireCtx();
  const a = await loadActive(id);
  await assertClinicalAccess(a.patientId);
  const kind = c.doctorId ? 'Progress' : c.nurseId ? 'Nursing' : null;
  if (!kind) throw new ForbiddenError('Only doctors and nurses can write ward notes');
  a.notes.push({ kind, text, authorUserId: c.userId, authorName: c.userName, authorRole: kind === 'Progress' ? 'Doctor' : 'Nurse', at: new Date() });
  await a.save();
  // Mirror into clinical notes so the EMR timeline shows ward rounds.
  await ClinicalNote.create({ patientId: a.patientId, visitId: a.visitId, type: kind, content: text, authorUserId: c.userId, authorName: c.userName, authorRole: kind === 'Progress' ? 'Doctor' : 'Nurse' });
  await recordAudit({ action: `ipd.${kind.toLowerCase()}_note_added`, module: 'IPD', entity: 'Admission', entityId: a._id });
  return a.toObject();
}

/** Bed-days per stay, rounded to the nearest day, with at least one day for the whole admission. */
export function bedCharges(stays: Array<{ wardName?: string | null; roomNo?: string | null; bedNo?: string | null; ratePerDay: number; from: Date; to?: Date | null }>, until: Date) {
  const lines = stays.map((s) => {
    const hours = ((s.to ?? until).getTime() - s.from.getTime()) / HOUR;
    return { description: `Bed charges — ${s.wardName ?? 'Ward'} ${s.roomNo ? `room ${s.roomNo} ` : ''}bed ${s.bedNo ?? ''}`.trim(), days: Math.round(hours / 24), rate: s.ratePerDay };
  });
  if (lines.reduce((t, l) => t + l.days, 0) === 0 && lines.length) lines[lines.length - 1].days = 1;
  return lines.filter((l) => l.days > 0);
}

export async function discharge(id: string, input: DischargeInput) {
  const c = requireCtx();
  const result = await withTransaction(async () => {
    const a = await loadActive(id);
    if (!(c.doctorId?.equals(a.attendingDoctorId) || can('emr.view_all'))) throw new ForbiddenError('Only the attending doctor can discharge this patient');
    const now = new Date();
    const open = a.stays.at(-1);
    if (open && !open.to) open.to = now;
    await releaseBed(a.bedId);
    a.status = 'Discharged';
    a.discharge = { ...input, followUpDate: input.followUpDate ? dateOnly(input.followUpDate) : undefined, at: now, byName: c.userName } as never;
    a.notes.push({ kind: 'Event', text: `Discharged (${input.type}) — ${input.conditionAtDischarge}`, authorUserId: c.userId, authorName: c.userName, at: now });
    await Visit.updateOne({ _id: a.visitId }, { status: 'Closed', endedAt: now, followUpDate: input.followUpDate ? dateOnly(input.followUpDate) : undefined });
    const lines = bedCharges(a.stays, now);
    if (lines.length) {
      const inv = await addCharges({
        patientId: a.patientId,
        visitId: a.visitId,
        departmentId: a.departmentId ?? undefined,
        source: 'IPD',
        sourceRef: `ipd:${a._id}`,
        items: lines.map((l) => ({ description: l.description, quantity: l.days, unitPrice: l.rate, discount: 0, taxRate: 0 })),
      });
      a.invoiceId = inv._id;
    }
    await a.save();
    await recordAudit({ action: 'patient.discharged', module: 'IPD', entity: 'Admission', entityId: a._id, after: { discharge: a.discharge, bedCharges: lines } });
    return a;
  });
  await notify({ type: 'General', title: 'Discharged', message: `You have been discharged (${result.admissionNo}). Your discharge summary and bill are available.`, patientId: result.patientId, external: ['Sms'] });
  return result.toObject();
}

/** Admitted in error: frees the bed, closes the visit, no charges. Only within 24 hours. */
export async function cancelAdmission(id: string, reason: string) {
  const c = requireCtx();
  return withTransaction(async () => {
    const a = await loadActive(id);
    if (Date.now() - a.admittedAt.getTime() > 24 * HOUR) throw new BusinessRuleError('Admissions older than 24 hours must be discharged, not cancelled');
    if (await Prescription.exists({ visitId: a.visitId })) throw new BusinessRuleError('Treatment has been recorded on this admission; discharge it instead');
    await Bed.updateOne({ _id: a.bedId, currentAdmissionId: a._id }, { $set: { status: 'Available', statusChangedAt: new Date() }, $unset: { currentAdmissionId: 1 } });
    const open = a.stays.at(-1);
    if (open && !open.to) open.to = new Date();
    a.status = 'Cancelled';
    a.notes.push({ kind: 'Event', text: `Admission cancelled: ${reason}`, authorUserId: c.userId, authorName: c.userName, at: new Date() });
    await a.save();
    await Visit.updateOne({ _id: a.visitId }, { status: 'Closed', endedAt: new Date() });
    await recordAudit({ action: 'admission.cancelled', module: 'IPD', entity: 'Admission', entityId: a._id, after: { reason } });
    return a.toObject();
  });
}

export async function listAdmissions(q: z.infer<typeof admissionListQuery>) {
  const c = requireCtx();
  const filter: Record<string, unknown> = {};
  if (c.patientId) filter.patientId = c.patientId;
  else if (q.patientId) filter.patientId = oid(q.patientId);
  if (q.status) filter.status = q.status;
  if (q.wardId) filter.wardId = oid(q.wardId);
  if (q.mine && c.doctorId) filter.attendingDoctorId = c.doctorId;
  const [items, total] = await Promise.all([
    Admission.find(filter).select('-notes').populate('patientId', 'mrn firstName lastName gender dateOfBirth').populate('wardId', 'name').sort(sortBy(q.sort, { admitted: 'admittedAt', admissionNo: 'admissionNo', status: 'status' }, { admittedAt: -1 })).skip(skipOf(q)).limit(q.pageSize).lean(),
    Admission.countDocuments(filter),
  ]);
  return {
    items: items.map((a) => {
      const p = a.patientId as unknown as { _id: Types.ObjectId; mrn: string; firstName: string; lastName: string; gender: string };
      const s = a.stays.at(-1);
      return { ...a, patientId: p?._id, patient: p && { id: p._id, mrn: p.mrn, name: `${p.firstName} ${p.lastName}`.trim(), gender: p.gender }, wardName: (a.wardId as unknown as { name?: string })?.name, bedLabel: s ? `${s.wardName} · ${s.roomNo ?? ''}/${s.bedNo}` : '—' };
    }),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function getAdmission(id: string) {
  const c = requireCtx();
  const a = orNotFound(await Admission.findById(id).lean(), 'Admission');
  if (c.patientId) {
    if (!c.patientId.equals(a.patientId)) throw new ForbiddenError();
  } else if (!can('ipd.manage') && !can('ipd.view')) throw new ForbiddenError();
  // Clinical sections only for staff who pass the care-team check; others get the admin record.
  let clinical = false;
  if (!c.patientId && (can('emr.view') || can('emr.view_all'))) {
    clinical = await assertClinicalAccess(a.patientId).then(
      () => true,
      () => false,
    );
  }
  const patient = orNotFound(await Patient.findById(a.patientId).select('mrn firstName lastName gender dateOfBirth bloodGroup phone allergies').lean(), 'Patient');
  const [vitals, prescriptions, labOrders] = clinical
    ? await Promise.all([
        VitalSign.find({ visitId: a.visitId }).sort({ recordedAt: -1 }).limit(50).lean(),
        Prescription.find({ visitId: a.visitId }).sort({ prescribedAt: -1 }).lean(),
        LabOrder.find({ visitId: a.visitId }).select('-history').sort({ createdAt: -1 }).lean(),
      ])
    : [[], [], []];
  return {
    ...a,
    // Ward notes are clinical; billing-only roles see the admission record without them.
    notes: clinical || c.patientId ? a.notes : a.notes.filter((n) => n.kind === 'Event'),
    patient: { id: patient._id, mrn: patient.mrn, name: `${patient.firstName} ${patient.lastName}`.trim(), gender: patient.gender, dateOfBirth: patient.dateOfBirth, bloodGroup: patient.bloodGroup, phone: patient.phone, allergies: patient.allergies.filter((x) => !x.removedAt) },
    vitals,
    prescriptions,
    labOrders,
    lengthOfStayDays: Math.max(1, Math.round(((a.discharge?.at ?? new Date()).getTime() - a.admittedAt.getTime()) / (24 * HOUR))),
    estimatedCharges: a.status === 'Admitted' ? bedCharges(a.stays, new Date()).reduce((s, l) => s + l.days * l.rate, 0) : undefined,
  };
}

/** Today's admissions/discharges and occupancy for dashboards. */
export async function ipdStats() {
  const today = dateOnly(todayString());
  const [admittedToday, dischargedToday, inpatients, beds] = await Promise.all([
    Admission.countDocuments({ admittedAt: { $gte: today }, status: { $ne: 'Cancelled' } }),
    Admission.countDocuments({ 'discharge.at': { $gte: today } }),
    Admission.countDocuments({ status: 'Admitted' }),
    Bed.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const total = beds.reduce((s, b) => s + b.n, 0);
  const occupied = beds.find((b) => b._id === 'Occupied')?.n ?? 0;
  return { admittedToday, dischargedToday, inpatients, totalBeds: total, occupiedBeds: occupied, occupancyPct: total ? Math.round((occupied / total) * 100) : 0, bedsByStatus: Object.fromEntries(beds.map((b) => [b._id, b.n])) };
}
