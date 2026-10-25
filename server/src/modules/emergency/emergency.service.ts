import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  TRIAGE_RANK,
  TRIAGE_TARGET_MIN,
  emergencyWorkflow,
  type DispositionInput,
  type ErStatus,
  type QuickRegisterInput,
  type TriageInput,
  type TriageLevel,
  type erListQuery,
} from '@hms/shared';
import { can, requireCtx } from '../../core/context';
import { withTransaction } from '../../core/db';
import { BusinessRuleError, ForbiddenError } from '../../core/errors';
import { recordAudit } from '../../core/audit/audit';
import { dateOnly, orNotFound, skipOf, todayString, sortBy } from '../../core/http';
import { nextNumber } from '../../core/numbering/numbering';
import { assertTransition } from '../../core/workflow';
import { notify } from '../../core/notifications/notify';
import { Department, Hospital, Service } from '../organization/organization.models';
import { Doctor } from '../staff/staff.models';
import { Patient } from '../patients/patient.models';
import { Visit } from '../appointments/appointment.models';
import { ClinicalNote, Prescription, VitalSign } from '../clinical/clinical.models';
import { saveVitals } from '../clinical/clinical.service';
import { LabOrder } from '../laboratory/lab.models';
import { addCharges } from '../billing/billing.service';
import { usersWithPermission } from '../identity/recipients';
import { admitCore } from '../ipd/ipd.service';
import { ACTIVE_ER_STATUSES, EmergencyCase, type EmergencyCaseDoc } from './emergency.models';

const MIN = 60_000;

function event(c: EmergencyCaseDoc, kind: string, text: string) {
  c.events.push({ kind, text, byName: requireCtx().userName, at: new Date() });
}

function move(c: EmergencyCaseDoc, to: ErStatus) {
  assertTransition(emergencyWorkflow, c.status as ErStatus, to);
  c.status = to;
}

async function alertDoctors(caseDoc: { _id: Types.ObjectId; caseNo: string; presentingComplaint: string }, level: TriageLevel, patientName: string) {
  if (level !== 'Critical' && level !== 'Urgent') return;
  const userIds = await usersWithPermission('emergency.treat');
  if (!userIds.length) return;
  await notify({
    type: 'EmergencyAlert',
    title: `${level === 'Critical' ? 'CRITICAL' : 'Urgent'} emergency patient`,
    message: `${caseDoc.caseNo}: ${patientName} — ${caseDoc.presentingComplaint}`,
    userIds,
    link: `/emergency/${caseDoc._id}`,
    priority: level === 'Critical' ? 'Critical' : 'High',
    external: level === 'Critical' ? ['Push'] : undefined,
  });
}

/**
 * Seconds-fast registration at the emergency desk. Unknown patients get a provisional record with a
 * real MRN, so every order, result and charge is attached to one patient from the first minute.
 */
export async function quickRegister(input: QuickRegisterInput) {
  const c = requireCtx();
  const h = orNotFound(await Hospital.findById(c.hospitalId).lean(), 'Hospital');
  const erDept = (await Department.findOne({ code: 'ER' }).lean()) ?? (await Department.findOne({ isClinical: true }).lean());
  if (!erDept) throw new BusinessRuleError('Configure an emergency department first');

  const created = await withTransaction(async () => {
    let patient = input.patientId ? await Patient.findById(input.patientId) : input.cnic ? await Patient.findOne({ cnic: input.cnic }) : null;
    if (input.patientId && !patient) throw new BusinessRuleError('Patient not found');
    if (!patient) {
      const [first, ...rest] = (input.name ?? 'Unknown').trim().split(/\s+/);
      const dob = new Date(dateOnly(todayString()));
      dob.setUTCFullYear(dob.getUTCFullYear() - (input.age ?? 30));
      dob.setUTCMonth(0, 1); // age-derived: 1 January of the estimated birth year
      const mrn = await nextNumber('mrn', h.numbering!.mrn!, h.code);
      [patient] = await Patient.create([
        {
          mrn,
          firstName: first,
          lastName: rest.join(' '),
          cnic: input.cnic,
          dateOfBirth: dob,
          gender: input.gender ?? 'Other',
          phone: input.emergencyContactPhone,
          emergencyContactName: input.emergencyContactName,
          emergencyContactPhone: input.emergencyContactPhone,
          isProvisional: true,
        },
      ]);
      await recordAudit({ action: 'patient.quick_registered', module: 'Emergency', entity: 'Patient', entityId: patient._id, after: patient });
    }
    if (await EmergencyCase.exists({ patientId: patient._id, status: { $in: ACTIVE_ER_STATUSES } })) {
      throw new BusinessRuleError(`${patient.firstName} ${patient.lastName} already has an open emergency case`, 'duplicate_er_case');
    }
    const visitNo = await nextNumber('visit', h.numbering!.visit!, h.code);
    const [visit] = await Visit.create([{ visitNo, patientId: patient._id, departmentId: erDept._id, type: 'Emergency', chiefComplaint: input.presentingComplaint }]);
    const caseNo = await nextNumber('emergency', h.numbering!.emergency!, h.code);
    const [er] = (await EmergencyCase.create([
      {
        caseNo,
        patientId: patient._id,
        visitId: visit._id,
        arrivalMode: input.arrivalMode,
        presentingComplaint: input.presentingComplaint,
        events: [{ kind: 'registered', text: `Arrived (${input.arrivalMode}): ${input.presentingComplaint}`, byName: c.userName }],
      },
    ])) as EmergencyCaseDoc[];
    if (input.triageLevel) {
      er.triage.push({ level: input.triageLevel, rank: TRIAGE_RANK[input.triageLevel], byName: c.userName, at: new Date(), notes: 'Desk triage' });
      er.triageLevel = input.triageLevel;
      er.triageRank = TRIAGE_RANK[input.triageLevel];
      move(er, 'Triaged');
      event(er, 'triage', `Triaged ${input.triageLevel} at the desk`);
      await er.save();
    }
    await recordAudit({ action: 'emergency.registered', module: 'Emergency', entity: 'EmergencyCase', entityId: er._id, after: er });
    return { er, patientName: `${patient.firstName} ${patient.lastName}`.trim(), mrn: patient.mrn };
  });
  if (created.er.triageLevel) await alertDoctors(created.er, created.er.triageLevel as TriageLevel, created.patientName);
  return { ...created.er.toObject(), patient: { id: created.er.patientId, name: created.patientName, mrn: created.mrn } };
}

async function loadCase(id: string) {
  return orNotFound((await EmergencyCase.findById(id)) as EmergencyCaseDoc | null, 'Emergency case');
}

export async function triage(id: string, input: TriageInput) {
  const c = requireCtx();
  const result = await withTransaction(async () => {
    const er = await loadCase(id);
    if (!ACTIVE_ER_STATUSES.includes(er.status as never)) throw new BusinessRuleError(`Case is ${er.status}`);
    const vitals = input.vitals ? await saveVitals(er.patientId, er.visitId, input.vitals) : undefined;
    const previous = er.triageLevel;
    er.triage.push({ level: input.level, rank: TRIAGE_RANK[input.level], notes: input.notes, vitalSignId: vitals?._id, byName: c.userName, at: new Date() });
    er.triageLevel = input.level;
    er.triageRank = TRIAGE_RANK[input.level];
    if (er.status === 'Registered') move(er, 'Triaged');
    event(er, 'triage', previous ? `Re-triaged ${previous} → ${input.level}` : `Triaged ${input.level}${vitals?.flags.length ? ` (abnormal: ${vitals.flags.join(', ')})` : ''}`);
    await er.save();
    await recordAudit({ action: 'emergency.triaged', module: 'Emergency', entity: 'EmergencyCase', entityId: er._id, before: { level: previous }, after: { level: input.level, notes: input.notes } });
    return er;
  });
  const p = await Patient.findById(result.patientId).select('firstName lastName').lean();
  await alertDoctors(result, input.level, `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim());
  return result.toObject();
}

/** A doctor takes the case: becomes the treating doctor and the clock to first contact stops. */
export async function takeCase(id: string) {
  const c = requireCtx();
  if (!c.doctorId) throw new ForbiddenError('Only doctors can take emergency cases');
  return withTransaction(async () => {
    const er = await loadCase(id);
    const doctor = orNotFound(await Doctor.findById(c.doctorId).select('name').lean(), 'Doctor');
    if (er.status === 'InTreatment') {
      if (er.assignedDoctorId?.equals(doctor._id)) return er.toObject();
      event(er, 'assigned', `Handed over from ${er.assignedDoctorName} to ${doctor.name}`);
    } else {
      move(er, 'InTreatment');
      er.treatmentStartedAt = new Date();
      event(er, 'assigned', `Seen by ${doctor.name} after ${Math.round((er.treatmentStartedAt.getTime() - er.arrivalAt.getTime()) / MIN)} min`);
    }
    er.assignedDoctorId = doctor._id;
    er.assignedDoctorName = doctor.name;
    await er.save();
    await Visit.updateOne({ _id: er.visitId }, { doctorId: doctor._id });
    await recordAudit({ action: 'emergency.taken', module: 'Emergency', entity: 'EmergencyCase', entityId: er._id, after: { doctor: doctor.name } });
    return er.toObject();
  });
}

/** Treatment notes: doctors' notes become progress notes in the EMR, nurses' become nursing notes. */
export async function addNote(id: string, note: string) {
  const c = requireCtx();
  const er = await loadCase(id);
  if (!ACTIVE_ER_STATUSES.includes(er.status as never)) throw new BusinessRuleError(`Case is ${er.status}`);
  const kind = c.doctorId ? 'Progress' : 'Nursing';
  await ClinicalNote.create({ patientId: er.patientId, visitId: er.visitId, type: kind, content: note, authorUserId: c.userId, authorName: c.userName, authorRole: c.doctorId ? 'Doctor' : 'Nurse' });
  event(er, 'note', note.length > 160 ? `${note.slice(0, 157)}…` : note);
  await er.save();
  await recordAudit({ action: 'emergency.note_added', module: 'Emergency', entity: 'EmergencyCase', entityId: er._id });
  return er.toObject();
}

/**
 * Ends the emergency episode in one transaction: closes the ER visit, admits to a bed if needed,
 * and bills the emergency consultation (only if a doctor saw the patient).
 */
export async function disposition(id: string, input: DispositionInput) {
  const c = requireCtx();
  const result = await withTransaction(async () => {
    const er = await loadCase(id);
    if (input.type !== 'LeftWithoutBeingSeen' && !(c.doctorId && can('emergency.treat'))) throw new ForbiddenError('A treating doctor must record this disposition');
    move(er, input.type);
    const now = new Date();
    let admissionId: Types.ObjectId | undefined;
    if (input.type === 'Admitted') {
      const adm = await admitCore(
        { patientId: er.patientId.toString(), bedId: input.admission!.bedId, attendingDoctorId: input.admission!.attendingDoctorId ?? c.doctorId!.toString(), source: 'Emergency', reason: input.admission!.reason, expectedDischarge: input.admission!.expectedDischarge },
        { emergencyCaseId: er._id },
      );
      admissionId = adm._id;
    }
    er.disposition = { type: input.type, at: now, notes: input.notes, referredTo: input.referredTo, admissionId, byName: c.userName } as never;
    event(er, 'disposition', `${input.type}${input.referredTo ? ` to ${input.referredTo}` : ''}: ${input.notes}`);
    await Visit.updateOne({ _id: er.visitId }, { status: 'Closed', endedAt: now });
    if (er.treatmentStartedAt) {
      const svc = await Service.findOne({ code: 'ER-CONS', isActive: true }).lean();
      if (svc && svc.price > 0) {
        const inv = await addCharges({
          patientId: er.patientId,
          visitId: er.visitId,
          departmentId: svc.departmentId ?? undefined,
          source: 'Emergency',
          sourceRef: `er:${er._id}`,
          items: [{ serviceId: svc._id.toString(), description: `${svc.name} — ${er.caseNo}`, quantity: 1, unitPrice: svc.price, discount: 0, taxRate: 0 }],
        });
        er.invoiceId = inv._id;
      }
    }
    await er.save();
    await recordAudit({ action: 'emergency.disposition', module: 'Emergency', entity: 'EmergencyCase', entityId: er._id, after: er.disposition });
    return er;
  });
  return result.toObject();
}

function waitMinutes(er: { arrivalAt: Date; treatmentStartedAt?: Date | null }) {
  return Math.round(((er.treatmentStartedAt ?? new Date()).getTime() - er.arrivalAt.getTime()) / MIN);
}

/** Live ER board: active cases by triage priority, then arrival; with target breaches flagged. */
export async function board() {
  const today = dateOnly(todayString());
  const [active, todayCases] = await Promise.all([
    EmergencyCase.find({ status: { $in: ACTIVE_ER_STATUSES } })
      .select('-events')
      .populate('patientId', 'mrn firstName lastName gender dateOfBirth isProvisional allergies')
      .sort({ triageRank: 1, arrivalAt: 1 })
      .lean(),
    EmergencyCase.find({ arrivalAt: { $gte: today } }).select('status triageLevel arrivalAt treatmentStartedAt').lean(),
  ]);
  const seen = todayCases.filter((x) => x.treatmentStartedAt);
  return {
    cases: active.map((er) => {
      const p = er.patientId as unknown as { _id: Types.ObjectId; mrn: string; firstName: string; lastName: string; gender: string; dateOfBirth: Date; isProvisional: boolean; allergies: Array<{ allergen: string; removedAt?: Date }> };
      const wait = waitMinutes(er);
      const target = er.triageLevel ? TRIAGE_TARGET_MIN[er.triageLevel as TriageLevel] : 10;
      return {
        _id: er._id,
        caseNo: er.caseNo,
        status: er.status,
        triageLevel: er.triageLevel,
        arrivalAt: er.arrivalAt,
        arrivalMode: er.arrivalMode,
        presentingComplaint: er.presentingComplaint,
        assignedDoctorName: er.assignedDoctorName,
        waitingMinutes: wait,
        breach: !er.treatmentStartedAt && wait > target,
        patient: { id: p._id, mrn: p.mrn, name: `${p.firstName} ${p.lastName}`.trim(), gender: p.gender, dateOfBirth: p.dateOfBirth, isProvisional: p.isProvisional, allergies: p.allergies.filter((a) => !a.removedAt).map((a) => a.allergen) },
      };
    }),
    today: {
      arrivals: todayCases.length,
      waiting: active.filter((a) => a.status !== 'InTreatment').length,
      inTreatment: active.filter((a) => a.status === 'InTreatment').length,
      admitted: todayCases.filter((x) => x.status === 'Admitted').length,
      discharged: todayCases.filter((x) => x.status === 'Discharged').length,
      avgDoorToDoctorMin: seen.length ? Math.round(seen.reduce((s, x) => s + waitMinutes(x), 0) / seen.length) : null,
      byTriage: Object.fromEntries((['Critical', 'Urgent', 'SemiUrgent', 'NonUrgent'] as const).map((l) => [l, active.filter((a) => a.triageLevel === l).length])),
    },
  };
}

export async function getCase(id: string) {
  const er = orNotFound(await EmergencyCase.findById(id).lean(), 'Emergency case');
  const patient = orNotFound(await Patient.findById(er.patientId).select('mrn firstName lastName gender dateOfBirth bloodGroup phone cnic allergies medicalHistory isProvisional emergencyContactName emergencyContactPhone').lean(), 'Patient');
  const clinical = can('emergency.treat') || can('emergency.manage');
  const [vitals, notes, prescriptions, labOrders] = clinical
    ? await Promise.all([
        VitalSign.find({ visitId: er.visitId }).sort({ recordedAt: -1 }).lean(),
        ClinicalNote.find({ visitId: er.visitId }).sort({ createdAt: -1 }).lean(),
        Prescription.find({ visitId: er.visitId }).sort({ prescribedAt: -1 }).lean(),
        LabOrder.find({ visitId: er.visitId }).select('-history').sort({ createdAt: -1 }).lean(),
      ])
    : [[], [], [], []];
  return {
    ...er,
    waitingMinutes: waitMinutes(er),
    patient: {
      id: patient._id,
      mrn: patient.mrn,
      name: `${patient.firstName} ${patient.lastName}`.trim(),
      gender: patient.gender,
      dateOfBirth: patient.dateOfBirth,
      bloodGroup: patient.bloodGroup,
      phone: patient.phone,
      cnic: patient.cnic,
      isProvisional: patient.isProvisional,
      emergencyContactName: patient.emergencyContactName,
      emergencyContactPhone: patient.emergencyContactPhone,
      allergies: patient.allergies.filter((a) => !a.removedAt),
      medicalHistory: patient.medicalHistory.filter((m) => !m.removedAt),
    },
    vitals,
    notes,
    prescriptions,
    labOrders,
  };
}

export async function listCases(q: z.infer<typeof erListQuery>) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.active) filter.status = { $in: ACTIVE_ER_STATUSES };
  if (q.from || q.to) {
    const to = q.to ? new Date(dateOnly(q.to).getTime() + 86_400_000) : undefined;
    filter.arrivalAt = { ...(q.from ? { $gte: dateOnly(q.from) } : {}), ...(to ? { $lt: to } : {}) };
  }
  if (q.search) filter.caseNo = new RegExp(`^${q.search.toUpperCase().replace(/[^A-Z0-9-]/g, '')}`);
  const [items, total] = await Promise.all([
    EmergencyCase.find(filter).select('-events -triage').populate('patientId', 'mrn firstName lastName').sort(sortBy(q.sort, { arrival: 'arrivalAt', caseNo: 'caseNo', triage: 'triageRank', status: 'status' }, { arrivalAt: -1 })).skip(skipOf(q)).limit(q.pageSize).lean(),
    EmergencyCase.countDocuments(filter),
  ]);
  return {
    items: items.map((er) => {
      const p = er.patientId as unknown as { _id: Types.ObjectId; mrn: string; firstName: string; lastName: string };
      return { ...er, patientId: p?._id, patient: p && { id: p._id, mrn: p.mrn, name: `${p.firstName} ${p.lastName}`.trim() }, waitingMinutes: waitMinutes(er) };
    }),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** Emergency KPIs for a date range (executive dashboard). */
export async function emergencyStats(range: { from: Date; to: Date }) {
  const rows = await EmergencyCase.aggregate([
    { $match: { arrivalAt: { $gte: range.from, $lt: range.to } } },
    { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$arrivalAt' } }, level: { $ifNull: ['$triageLevel', 'Untriaged'] } }, n: { $sum: 1 } } },
  ]);
  const byDay = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const d = byDay.get(r._id.day) ?? {};
    d[r._id.level] = r.n;
    byDay.set(r._id.day, d);
  }
  const responses = await EmergencyCase.aggregate([
    { $match: { arrivalAt: { $gte: range.from, $lt: range.to }, treatmentStartedAt: { $ne: null } } },
    { $group: { _id: '$triageLevel', avgMin: { $avg: { $divide: [{ $subtract: ['$treatmentStartedAt', '$arrivalAt'] }, MIN] } }, n: { $sum: 1 } } },
  ]);
  return {
    total: rows.reduce((s, r) => s + r.n, 0),
    byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, levels]) => ({ date, ...levels })),
    responseTimes: responses.map((r) => ({ level: r._id ?? 'Untriaged', avgMinutes: Math.round(r.avgMin), cases: r.n })),
  };
}
