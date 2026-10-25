import { Types } from 'mongoose';
import { appointmentWorkflow, SLOT_HOLDING_STATUSES, type AppointmentStatus, type CreateAppointmentInput } from '@hms/shared';
import { requireCtx } from '../../core/context';
import { BusinessRuleError, ConflictError, ForbiddenError } from '../../core/errors';
import { recordAudit } from '../../core/audit/audit';
import { dateOnly, oid, orNotFound, skipOf, todayString, toDateString } from '../../core/http';
import { withTransaction } from '../../core/db';
import { nextNumber } from '../../core/numbering/numbering';
import { assertTransition, fromMinutes, toMinutes } from '../../core/workflow';
import { notify } from '../../core/notifications/notify';
import { requireAppointmentType } from '../organization/catalog';
import { Hospital } from '../organization/organization.models';
import { Doctor } from '../staff/staff.models';
import { Patient } from '../patients/patient.models';
import { Appointment, SlotLock, Visit, type AppointmentDoc } from './appointment.models';

const isoWeekday = (date: string) => {
  const d = dateOnly(date).getUTCDay();
  return d === 0 ? 7 : d;
};
const slotKey = (doctorId: Types.ObjectId, date: Date, start: string) => `${doctorId}|${toDateString(date)}|${start}`;

async function loadDoctor(id: string | Types.ObjectId) {
  const doctor = await Doctor.findById(id).lean();
  if (!doctor) throw new BusinessRuleError('Doctor not found');
  return doctor;
}

/** Validates the requested slot against the doctor's schedule and returns its end time. */
function assertSlotOnSchedule(doctor: Awaited<ReturnType<typeof loadDoctor>>, date: string, start: string) {
  if (!doctor.isAvailable) throw new BusinessRuleError(`${doctor.name} is not taking appointments`);
  if (!doctor.workingDays.includes(isoWeekday(date))) throw new BusinessRuleError(`${doctor.name} does not work on this day`);
  const s = toMinutes(start);
  const dutyStart = toMinutes(doctor.dutyStart);
  const dutyEnd = toMinutes(doctor.dutyEnd);
  const len = doctor.slotMinutes;
  if (s < dutyStart || s + len > dutyEnd) throw new BusinessRuleError(`Outside duty hours (${doctor.dutyStart}–${doctor.dutyEnd})`);
  if ((s - dutyStart) % len !== 0) throw new BusinessRuleError(`Start time must align to ${len}-minute slots from ${doctor.dutyStart}`);
  const now = new Date();
  const slotStart = new Date(`${date}T${start}:00`);
  if (slotStart.getTime() < now.getTime() - 5 * 60_000) throw new BusinessRuleError('Cannot book an appointment in the past');
  return fromMinutes(s + len);
}

/** Free / booked slots for a doctor on a date. */
export async function availability(doctorId: string, date: string) {
  const doctor = await loadDoctor(doctorId);
  if (!doctor.workingDays.includes(isoWeekday(date))) return { doctor: doctor.name, slotMinutes: doctor.slotMinutes, slots: [] };
  const booked = await Appointment.find({ doctorId: doctor._id, date: dateOnly(date), status: { $in: SLOT_HOLDING_STATUSES } })
    .select('startTime')
    .lean();
  const taken = new Set(booked.map((b) => b.startTime));
  const slots = [];
  const now = new Date();
  for (let m = toMinutes(doctor.dutyStart); m + doctor.slotMinutes <= toMinutes(doctor.dutyEnd); m += doctor.slotMinutes) {
    const t = fromMinutes(m);
    const past = new Date(`${date}T${t}:00`) < now;
    slots.push({ time: t, available: !taken.has(t) && !past });
  }
  return { doctor: doctor.name, slotMinutes: doctor.slotMinutes, slots };
}

export async function createAppointment(input: CreateAppointmentInput) {
  const c = requireCtx();
  // Portal patients may only book for themselves.
  if (c.patientId && !c.patientId.equals(input.patientId)) throw new ForbiddenError('You can only book appointments for yourself');
  await requireAppointmentType(input.type);

  const [doctor, patient, hospital] = await Promise.all([
    loadDoctor(input.doctorId),
    Patient.findById(input.patientId).select('firstName lastName').lean(),
    Hospital.findById(c.hospitalId).lean(),
  ]);
  if (!patient) throw new BusinessRuleError('Patient not found');
  const endTime = assertSlotOnSchedule(doctor, input.date, input.startTime);
  const date = dateOnly(input.date);

  const appt = await withTransaction(async () => {
    const patientClash = await Appointment.exists({
      patientId: patient._id,
      date,
      status: { $in: SLOT_HOLDING_STATUSES.filter((s) => s !== 'Completed') },
      startTime: { $lt: endTime },
      endTime: { $gt: input.startTime },
    });
    if (patientClash) throw new ConflictError('The patient already has an appointment at this time', 'patient_double_booked');

    const appointmentNo = await nextNumber('appointment', hospital!.numbering!.appointment!, hospital!.code);
    const [a] = await Appointment.create([
      {
        appointmentNo,
        patientId: patient._id,
        doctorId: doctor._id,
        departmentId: doctor.departmentId,
        date,
        startTime: input.startTime,
        endTime,
        type: input.type,
        reason: input.reason,
        history: [{ status: 'Scheduled', by: c.userId }],
      },
    ]);
    try {
      await SlotLock.create([{ hospitalId: c.hospitalId, key: slotKey(doctor._id, date, input.startTime), appointmentId: a._id }]);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictError('This slot has just been booked. Pick another time.', 'slot_taken');
      throw err;
    }
    await recordAudit({ action: 'appointment.created', module: 'Appointments', entity: 'Appointment', entityId: a._id, after: a });
    return a;
  });

  await notify({
    type: 'AppointmentConfirmation',
    title: 'Appointment booked',
    message: `Appointment ${appt.appointmentNo} with ${doctor.name} on ${input.date} at ${input.startTime}.`,
    patientId: patient._id,
    external: ['Sms', 'Email'],
  });
  return getAppointment(appt._id.toString());
}

export async function listAppointments(q: {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
  doctorId?: string;
  departmentId?: string;
  patientId?: string;
  status?: AppointmentStatus;
  search?: string;
}) {
  const c = requireCtx();
  const filter: Record<string, unknown> = {};
  if (c.patientId) filter.patientId = c.patientId; // portal: own appointments only
  else if (q.patientId) filter.patientId = oid(q.patientId);
  if (q.doctorId) filter.doctorId = oid(q.doctorId);
  if (q.departmentId) filter.departmentId = oid(q.departmentId);
  if (q.status) filter.status = q.status;
  if (q.from || q.to) filter.date = { ...(q.from ? { $gte: dateOnly(q.from) } : {}), ...(q.to ? { $lte: dateOnly(q.to) } : {}) };
  if (q.search) filter.appointmentNo = q.search.toUpperCase();

  const [items, total] = await Promise.all([
    Appointment.find(filter)
      .populate('patientId', 'mrn firstName lastName gender dateOfBirth phone')
      .populate('doctorId', 'name specialization')
      .populate('departmentId', 'name')
      .sort({ date: 1, startTime: 1 })
      .skip(skipOf(q))
      .limit(q.pageSize)
      .lean(),
    Appointment.countDocuments(filter),
  ]);
  return { items: items.map(toAppointmentDto), page: q.page, pageSize: q.pageSize, total };
}

export function toAppointmentDto(a: any) {
  const p = a.patientId && typeof a.patientId === 'object' && 'mrn' in a.patientId ? a.patientId : undefined;
  const d = a.doctorId && typeof a.doctorId === 'object' && 'name' in a.doctorId ? a.doctorId : undefined;
  const dept = a.departmentId && typeof a.departmentId === 'object' && 'name' in a.departmentId ? a.departmentId : undefined;
  return {
    id: a._id.toString(),
    appointmentNo: a.appointmentNo,
    date: toDateString(a.date),
    startTime: a.startTime,
    endTime: a.endTime,
    type: a.type,
    status: a.status as AppointmentStatus,
    reason: a.reason,
    cancellationReason: a.cancellationReason,
    tokenNumber: a.tokenNumber,
    checkedInAt: a.checkedInAt,
    visitId: a.visitId?.toString(),
    patient: p ? { id: p._id.toString(), mrn: p.mrn, name: `${p.firstName} ${p.lastName}`, gender: p.gender, dateOfBirth: p.dateOfBirth ? toDateString(p.dateOfBirth) : undefined, phone: p.phone } : { id: a.patientId?.toString() },
    doctor: d ? { id: d._id.toString(), name: d.name, specialization: d.specialization } : { id: a.doctorId?.toString() },
    department: dept ? { id: dept._id.toString(), name: dept.name } : { id: a.departmentId?.toString() },
    history: a.history,
  };
}

export async function getAppointment(id: string) {
  const c = requireCtx();
  const a = orNotFound(
    await Appointment.findById(id).populate('patientId', 'mrn firstName lastName gender dateOfBirth phone').populate('doctorId', 'name specialization').populate('departmentId', 'name').lean(),
    'Appointment',
  );
  if (c.patientId && !c.patientId.equals((a.patientId as any)._id)) throw new ForbiddenError();
  return toAppointmentDto(a);
}

/** Applies a status change with the workflow guard, history entry and audit. Must run in a transaction. */
export async function transition(a: AppointmentDoc, to: AppointmentStatus, note?: string) {
  const c = requireCtx();
  assertTransition(appointmentWorkflow, a.status as AppointmentStatus, to);
  const from = a.status;
  a.status = to;
  a.history.push({ status: to, by: c.userId, at: new Date(), note });
  await a.save();
  await recordAudit({ action: 'appointment.status_changed', module: 'Appointments', entity: 'Appointment', entityId: a._id, before: { status: from }, after: { status: to }, meta: note ? { note } : undefined });
}

async function releaseSlot(a: AppointmentDoc) {
  await SlotLock.deleteOne({ hospitalId: requireCtx().hospitalId, appointmentId: a._id });
}

export async function confirm(id: string) {
  await withTransaction(async () => {
    const a = orNotFound((await Appointment.findById(id)) as AppointmentDoc | null, 'Appointment');
    await transition(a, 'Confirmed');
  });
  return getAppointment(id);
}

export async function cancel(id: string, reason: string) {
  const c = requireCtx();
  await withTransaction(async () => {
    const a = orNotFound((await Appointment.findById(id)) as AppointmentDoc | null, 'Appointment');
    if (c.patientId && !c.patientId.equals(a.patientId)) throw new ForbiddenError();
    a.cancellationReason = reason;
    await transition(a, 'Cancelled', reason);
    await releaseSlot(a);
  });
  return getAppointment(id);
}

export async function markNoShow(id: string) {
  await withTransaction(async () => {
    const a = orNotFound((await Appointment.findById(id)) as AppointmentDoc | null, 'Appointment');
    if (toDateString(a.date) > todayString()) throw new BusinessRuleError('Cannot mark a future appointment as no-show');
    await transition(a, 'NoShow');
    await releaseSlot(a);
  });
  return getAppointment(id);
}

export async function reschedule(id: string, input: { date: string; startTime: string; doctorId?: string }) {
  const c = requireCtx();
  await withTransaction(async () => {
    const a = orNotFound((await Appointment.findById(id)) as AppointmentDoc | null, 'Appointment');
    if (!['Scheduled', 'Confirmed'].includes(a.status)) throw new ConflictError(`A ${a.status} appointment cannot be rescheduled`, 'invalid_transition');
    const doctor = await loadDoctor(input.doctorId ?? a.doctorId);
    const endTime = assertSlotOnSchedule(doctor, input.date, input.startTime);
    const before = { date: toDateString(a.date), startTime: a.startTime, doctorId: a.doctorId.toString() };
    await releaseSlot(a);
    a.doctorId = doctor._id;
    a.departmentId = doctor.departmentId;
    a.date = dateOnly(input.date);
    a.startTime = input.startTime;
    a.endTime = endTime;
    a.rescheduleCount += 1;
    a.reminderSentAt = undefined; // remind again for the new time
    a.status = 'Scheduled';
    a.history.push({ status: 'Scheduled', by: c.userId, at: new Date(), note: `Rescheduled from ${before.date} ${before.startTime}` });
    await a.save();
    try {
      await SlotLock.create([{ hospitalId: c.hospitalId, key: slotKey(doctor._id, a.date, input.startTime), appointmentId: a._id }]);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictError('That slot is already booked. Pick another time.', 'slot_taken');
      throw err;
    }
    await recordAudit({ action: 'appointment.rescheduled', module: 'Appointments', entity: 'Appointment', entityId: a._id, before, after: { date: input.date, startTime: input.startTime, doctorId: doctor._id.toString() } });
  });
  return getAppointment(id);
}

/** Check-in opens the clinical visit and puts the patient in the nursing queue with a token number. */
export async function checkIn(id: string) {
  const c = requireCtx();
  await withTransaction(async () => {
    const a = orNotFound((await Appointment.findById(id)) as AppointmentDoc | null, 'Appointment');
    if (toDateString(a.date) !== todayString()) throw new BusinessRuleError('Only today\'s appointments can be checked in');
    const hospital = await Hospital.findById(c.hospitalId).lean();
    const visitNo = await nextNumber('visit', hospital!.numbering!.visit!, hospital!.code);
    const [visit] = await Visit.create([
      { visitNo, patientId: a.patientId, doctorId: a.doctorId, departmentId: a.departmentId, appointmentId: a._id, type: 'OPD' },
    ]);
    const already = await Appointment.countDocuments({ doctorId: a.doctorId, date: a.date, tokenNumber: { $exists: true } });
    a.tokenNumber = already + 1;
    a.checkedInAt = new Date();
    a.visitId = visit._id;
    await transition(a, 'CheckedIn');
    await recordAudit({ action: 'visit.opened', module: 'Appointments', entity: 'Visit', entityId: visit._id, after: visit });
  });
  return getAppointment(id);
}
