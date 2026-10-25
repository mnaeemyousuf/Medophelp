import { Types } from 'mongoose';
import { adherencePercent, defaultDoseTimes, isChronicCourse, planDoses } from '@hms/shared';
import { can, requireCtx } from '../../core/context';
import { withTransaction } from '../../core/db';
import { BusinessRuleError, ForbiddenError } from '../../core/errors';
import { recordAudit } from '../../core/audit/audit';
import { oid, orNotFound } from '../../core/http';
import { notify } from '../../core/notifications/notify';
import { assertClinicalAccess } from '../patients/access';
import { MedicationDose, MedicationSchedule, type MedicationScheduleDoc } from './medication.models';

const HOUR = 3_600_000;
/** A dose can be marked taken from 2 h before it is due until 24 h after. */
const EARLY_WINDOW = 2 * HOUR;
const LATE_WINDOW = 24 * HOUR;

interface RxLike {
  _id: Types.ObjectId;
  prescriptionNo: string;
  patientId: Types.ObjectId;
  doctorId?: Types.ObjectId | null;
  doctorName?: string | null;
  items: Array<{ _id: Types.ObjectId; medicineName: string; dosage: string; route?: string | null; instructions?: string | null; timesPerDay: number; durationDays: number }>;
}

/**
 * Creates reminder schedules (and their doses) for prescription lines — at prescribing or at first
 * dispensing, per the hospital's `medicationScheduleFrom` setting. PRN lines (0 times a day) and
 * lines that already have a schedule are skipped. Runs inside the caller's transaction.
 */
export async function createSchedulesForDispense(rx: RxLike, itemIds: Types.ObjectId[], start = new Date()) {
  const c = requireCtx();
  const created: string[] = [];
  for (const id of itemIds) {
    const item = rx.items.find((i) => i._id.equals(id));
    if (!item || item.timesPerDay <= 0) continue;
    if (await MedicationSchedule.exists({ prescriptionItemId: item._id })) continue;
    const times = defaultDoseTimes(item.timesPerDay);
    const totalDoses = item.timesPerDay * item.durationDays;
    const doses = planDoses(start, times, totalDoses);
    const [schedule] = await MedicationSchedule.create([
      {
        hospitalId: c.hospitalId,
        patientId: rx.patientId,
        prescriptionId: rx._id,
        prescriptionNo: rx.prescriptionNo,
        prescriptionItemId: item._id,
        doctorId: rx.doctorId ?? undefined,
        doctorName: rx.doctorName ?? undefined,
        medicineName: item.medicineName,
        dosage: item.dosage,
        route: item.route ?? undefined,
        instructions: item.instructions ?? undefined,
        timesPerDay: item.timesPerDay,
        durationDays: item.durationDays,
        times,
        startDate: doses[0],
        endDate: doses[doses.length - 1],
        totalDoses,
        chronic: isChronicCourse(item.durationDays),
      },
    ]);
    await MedicationDose.insertMany(
      doses.map((at) => ({ hospitalId: c.hospitalId, scheduleId: schedule._id, patientId: rx.patientId, medicineName: item.medicineName, dosage: item.dosage, scheduledAt: at })),
    );
    created.push(item.medicineName);
  }
  if (created.length) await recordAudit({ action: 'medication.schedule_created', module: 'Medication', entity: 'Prescription', entityId: rx._id, after: { medicines: created } });
  return created.length;
}

/** Called when a prescription is cancelled: active schedules stop and pending doses are cancelled. */
export async function stopSchedulesForPrescription(prescriptionId: Types.ObjectId, reason: string) {
  const c = requireCtx();
  const active = await MedicationSchedule.find({ prescriptionId, status: 'Active' }).select('_id patientId').lean();
  if (!active.length) return 0;
  await MedicationSchedule.updateMany({ _id: { $in: active.map((s) => s._id) } }, { status: 'Stopped', stoppedReason: reason, stoppedByName: c.userName });
  await MedicationDose.updateMany({ scheduleId: { $in: active.map((s) => s._id) }, status: 'Pending' }, { status: 'Cancelled' });
  await recordAudit({ action: 'medication.schedule_stopped', module: 'Medication', entity: 'Prescription', entityId: prescriptionId, after: { schedules: active.length, reason } });
  return active.length;
}

/** Patients see their own schedules; staff need medication.manage and either dispense rights or care-team access. */
async function assertMedicationAccess(patientId: Types.ObjectId) {
  const c = requireCtx();
  if (c.patientId) {
    if (!c.patientId.equals(patientId)) throw new ForbiddenError('You can only manage your own medicines');
    return;
  }
  if (!can('medication.manage')) throw new ForbiddenError();
  if (can('pharmacy.dispense') || can('emr.view_all')) return;
  await assertClinicalAccess(patientId);
}

async function summarize(schedules: Array<{ _id: Types.ObjectId }>) {
  const ids = schedules.map((s) => s._id);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * HOUR);
  const [counts, today, next] = await Promise.all([
    MedicationDose.aggregate([{ $match: { scheduleId: { $in: ids } } }, { $group: { _id: { s: '$scheduleId', st: '$status' }, n: { $sum: 1 } } }]),
    MedicationDose.find({ scheduleId: { $in: ids }, scheduledAt: { $gte: dayStart, $lt: dayEnd }, status: { $ne: 'Cancelled' } }).sort({ scheduledAt: 1 }).lean(),
    MedicationDose.aggregate([{ $match: { scheduleId: { $in: ids }, status: 'Pending', scheduledAt: { $gte: now } } }, { $sort: { scheduledAt: 1 } }, { $group: { _id: '$scheduleId', at: { $first: '$scheduledAt' } } }]),
  ]);
  return (s: Types.ObjectId) => {
    const get = (st: string) => counts.find((x) => x._id.s.equals(s) && x._id.st === st)?.n ?? 0;
    const c = { taken: get('Taken'), missed: get('Missed'), skipped: get('Skipped'), pending: get('Pending') };
    return { ...c, adherence: adherencePercent(c), today: today.filter((d) => d.scheduleId.equals(s)), nextDoseAt: next.find((x) => x._id.equals(s))?.at ?? null };
  };
}

async function schedulesFor(patientId: Types.ObjectId, includeEnded: boolean) {
  const filter: Record<string, unknown> = { patientId };
  if (!includeEnded) filter.$or = [{ status: 'Active' }, { endDate: { $gte: new Date(Date.now() - 30 * 24 * HOUR) } }];
  const schedules = await MedicationSchedule.find(filter).sort({ status: 1, startDate: -1 }).lean();
  const stats = await summarize(schedules);
  return schedules.map((s) => ({ ...s, ...stats(s._id) }));
}

export async function mySchedules() {
  const c = requireCtx();
  if (!c.patientId) throw new ForbiddenError('Only patients have a medication list');
  const schedules = await schedulesFor(c.patientId, false);
  const totals = schedules.reduce((m, s) => ({ taken: m.taken + s.taken, missed: m.missed + s.missed, skipped: m.skipped + s.skipped }), { taken: 0, missed: 0, skipped: 0 });
  return { schedules, adherence: adherencePercent(totals), totals };
}

export async function patientSchedules(patientId: string) {
  const pid = oid(patientId);
  await assertMedicationAccess(pid);
  return schedulesFor(pid, true);
}

export async function scheduleDoses(scheduleId: string) {
  const s = orNotFound(await MedicationSchedule.findById(scheduleId).lean(), 'Schedule');
  await assertMedicationAccess(s.patientId);
  const doses = await MedicationDose.find({ scheduleId: s._id }).sort({ scheduledAt: 1 }).lean();
  return { schedule: s, doses };
}

export async function recordDose(doseId: string, status: 'Taken' | 'Skipped', note?: string) {
  const c = requireCtx();
  const dose = orNotFound(await MedicationDose.findById(doseId), 'Dose');
  await assertMedicationAccess(dose.patientId);
  if (!['Pending', 'Missed'].includes(dose.status)) throw new BusinessRuleError(`This dose is already ${dose.status.toLowerCase()}`);
  const t = dose.scheduledAt.getTime();
  if (Date.now() < t - EARLY_WINDOW) throw new BusinessRuleError('This dose is not due yet');
  if (Date.now() > t + LATE_WINDOW) throw new BusinessRuleError('This dose is more than 24 hours old and can no longer be updated');
  const before = dose.status;
  dose.set({ status, recordedAt: new Date(), recordedByName: c.userName, recordedBy: c.patientId ? 'Patient' : 'Staff', note });
  await dose.save();
  await recordAudit({ action: status === 'Taken' ? 'medication.dose_taken' : 'medication.dose_skipped', module: 'Medication', entity: 'MedicationDose', entityId: dose._id, before: { status: before }, after: { status, note } });
  return dose.toObject();
}

/** Changes daily reminder times; future pending doses are re-planned with the remaining count. */
export async function updateTimes(scheduleId: string, times: string[]) {
  return withTransaction(async () => {
    const s = orNotFound((await MedicationSchedule.findById(scheduleId)) as MedicationScheduleDoc | null, 'Schedule');
    await assertMedicationAccess(s.patientId);
    if (s.status !== 'Active') throw new BusinessRuleError(`Schedule is ${s.status.toLowerCase()}`);
    if (times.length !== s.timesPerDay) throw new BusinessRuleError(`This medicine is taken ${s.timesPerDay} time(s) a day; give ${s.timesPerDay} time(s)`);
    const now = new Date();
    const future = await MedicationDose.find({ scheduleId: s._id, status: 'Pending', scheduledAt: { $gt: now } }).select('_id').lean();
    await MedicationDose.deleteMany({ _id: { $in: future.map((d) => d._id) } });
    const plan = planDoses(now, times, future.length);
    if (plan.length) await MedicationDose.insertMany(plan.map((at) => ({ hospitalId: s.hospitalId, scheduleId: s._id, patientId: s.patientId, medicineName: s.medicineName, dosage: s.dosage, scheduledAt: at })));
    const before = [...s.times];
    s.times = [...times].sort();
    if (plan.length) s.endDate = plan[plan.length - 1];
    await s.save();
    await recordAudit({ action: 'medication.times_changed', module: 'Medication', entity: 'MedicationSchedule', entityId: s._id, before: { times: before }, after: { times: s.times } });
    return s.toObject();
  });
}

export async function stopSchedule(scheduleId: string, reason: string) {
  const c = requireCtx();
  if (c.patientId || !can('medication.manage')) throw new ForbiddenError('Only clinical staff can stop a medicine');
  const s = await withTransaction(async () => {
    const s = orNotFound((await MedicationSchedule.findById(scheduleId)) as MedicationScheduleDoc | null, 'Schedule');
    await assertMedicationAccess(s.patientId);
    if (s.status !== 'Active') throw new BusinessRuleError(`Schedule is already ${s.status.toLowerCase()}`);
    s.set({ status: 'Stopped', stoppedReason: reason, stoppedByName: c.userName });
    await s.save();
    await MedicationDose.updateMany({ scheduleId: s._id, status: 'Pending' }, { status: 'Cancelled' });
    await recordAudit({ action: 'medication.schedule_stopped', module: 'Medication', entity: 'MedicationSchedule', entityId: s._id, after: { reason } });
    return s;
  });
  await notify({ type: 'MedicationReminder', title: 'Medicine stopped', message: `${s.medicineName} has been stopped by ${c.userName}: ${reason}`, patientId: s.patientId, link: '/portal/medications' });
  return s.toObject();
}

/** Adherence per active schedule for staff (report + ward view). */
export async function adherenceReport(opts: { from: Date; to: Date; doctorId?: string; departmentDoctorIds?: Types.ObjectId[] }) {
  const match: Record<string, unknown> = { scheduledAt: { $gte: opts.from, $lte: opts.to }, status: { $in: ['Taken', 'Missed', 'Skipped'] } };
  const rows = await MedicationDose.aggregate([
    { $match: match },
    { $group: { _id: '$scheduleId', taken: { $sum: { $cond: [{ $eq: ['$status', 'Taken'] }, 1, 0] } }, missed: { $sum: { $cond: [{ $eq: ['$status', 'Missed'] }, 1, 0] } }, skipped: { $sum: { $cond: [{ $eq: ['$status', 'Skipped'] }, 1, 0] } } } },
    { $lookup: { from: 'medicationschedules', localField: '_id', foreignField: '_id', as: 's' } },
    { $set: { s: { $first: '$s' } } },
    ...(opts.doctorId ? [{ $match: { 's.doctorId': oid(opts.doctorId) } }] : []),
    ...(opts.departmentDoctorIds ? [{ $match: { 's.doctorId': { $in: opts.departmentDoctorIds } } }] : []),
    { $lookup: { from: 'patients', localField: 's.patientId', foreignField: '_id', as: 'p' } },
    { $set: { p: { $first: '$p' } } },
    { $project: { _id: 0, mrn: '$p.mrn', patient: { $concat: ['$p.firstName', ' ', '$p.lastName'] }, medicine: '$s.medicineName', prescriptionNo: '$s.prescriptionNo', doctor: '$s.doctorName', taken: 1, missed: 1, skipped: 1 } },
    { $sort: { missed: -1, patient: 1 } },
  ]);
  return rows.map((r) => ({ ...r, adherence: adherencePercent(r) }));
}
