import type { Types } from 'mongoose';
import { runWithContext } from '../../core/context';
import { logger } from '../../core/logger';
import { notify } from '../../core/notifications/notify';
import { Hospital } from '../organization/organization.models';
import { Doctor } from '../staff/staff.models';
import { Appointment } from '../appointments/appointment.models';
import { MedicationDose, MedicationSchedule } from './medication.models';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** A pending dose becomes "missed" this long after it was due. */
export const MISSED_AFTER = 2 * HOUR;

/**
 * One pass of the medication engine for the hospital in context:
 *  1. dose reminders for doses now due (once per dose, in-app + SMS/push)
 *  2. pending doses older than 2 h → Missed; ≥2 missed in 24 h alerts the prescriber (once a day)
 *  3. refill reminders 3 days before a chronic course runs out
 *  4. finished schedules → Completed; chronic ones get a follow-up reminder if nothing is booked
 */
export async function runMedicationPass(now = new Date()) {
  const result = { reminders: 0, missed: 0, missedAlerts: 0, refills: 0, completed: 0, followUps: 0 };

  // 1. reminders: due within the last 30 minutes (or the next minute), not yet reminded
  const due = await MedicationDose.find({ status: 'Pending', remindedAt: null, scheduledAt: { $lte: new Date(now.getTime() + MIN), $gte: new Date(now.getTime() - 30 * MIN) } }).lean();
  const byPatient = new Map<string, typeof due>();
  for (const d of due) byPatient.set(d.patientId.toString(), [...(byPatient.get(d.patientId.toString()) ?? []), d]);
  for (const doses of byPatient.values()) {
    const list = doses.map((d) => `${d.medicineName}${d.dosage ? ` ${d.dosage}` : ''}`).join(', ');
    await notify({ type: 'MedicationReminder', title: 'Time for your medicine', message: `Please take: ${list}. Mark it as taken in the patient portal.`, patientId: doses[0].patientId, link: '/portal/medications', external: ['Sms', 'Push', 'Email'] });
    await MedicationDose.updateMany({ _id: { $in: doses.map((d) => d._id) } }, { remindedAt: now });
    result.reminders += doses.length;
  }

  // 2. missed doses
  const missed = await MedicationDose.updateMany({ status: 'Pending', scheduledAt: { $lt: new Date(now.getTime() - MISSED_AFTER) } }, { status: 'Missed', recordedBy: 'System', recordedAt: now });
  result.missed = missed.modifiedCount;
  if (missed.modifiedCount) {
    const recent = await MedicationDose.aggregate([{ $match: { status: 'Missed', scheduledAt: { $gte: new Date(now.getTime() - DAY) } } }, { $group: { _id: '$scheduleId', n: { $sum: 1 } } }, { $match: { n: { $gte: 2 } } }]);
    for (const r of recent) {
      const s = await MedicationSchedule.findOne({ _id: r._id, status: 'Active', $or: [{ lastMissedAlertAt: null }, { lastMissedAlertAt: { $lt: new Date(now.getTime() - DAY) } }] });
      if (!s) continue;
      const doctor = s.doctorId ? await Doctor.findById(s.doctorId).select('userId').lean() : null;
      if (doctor?.userId) {
        await notify({ type: 'MissedDose', title: 'Missed doses', message: `A patient on ${s.prescriptionNo} missed ${r.n} dose(s) of ${s.medicineName} in the last 24 hours.`, userIds: [doctor.userId as Types.ObjectId], link: `/patients/${s.patientId}?tab=medications`, priority: 'High' });
      }
      await notify({ type: 'MissedDose', title: 'You missed some doses', message: `You missed ${r.n} dose(s) of ${s.medicineName} in the last day. Take your next dose on time and contact the hospital if you have side effects.`, patientId: s.patientId, link: '/portal/medications' });
      s.lastMissedAlertAt = now;
      await s.save();
      result.missedAlerts++;
    }
  }

  // 3. refill reminders for chronic courses ending within 3 days
  const refill = await MedicationSchedule.find({ status: 'Active', chronic: true, refillReminderSentAt: null, endDate: { $lte: new Date(now.getTime() + 3 * DAY), $gt: now } });
  for (const s of refill) {
    await notify({ type: 'RefillReminder', title: 'Refill due soon', message: `Your ${s.medicineName} runs out on ${s.endDate.toLocaleDateString('en-GB')}. Book a follow-up or request a refill before then.`, patientId: s.patientId, link: '/portal/appointments?book=1', external: ['Sms', 'Push', 'Email'] });
    s.refillReminderSentAt = now;
    await s.save();
    result.refills++;
  }

  // 4. completion + chronic follow-up
  const finished = await MedicationSchedule.find({ status: 'Active', endDate: { $lt: new Date(now.getTime() - MISSED_AFTER) } });
  for (const s of finished) {
    if (await MedicationDose.exists({ scheduleId: s._id, status: 'Pending' })) continue;
    s.status = 'Completed';
    if (s.chronic && !s.followUpReminderSentAt) {
      const booked = await Appointment.exists({ patientId: s.patientId, date: { $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) }, status: { $in: ['Scheduled', 'Confirmed'] } });
      if (!booked) {
        await notify({ type: 'FollowUpReminder', title: 'Follow-up recommended', message: `Your ${s.medicineName} course has finished. Please book a follow-up with ${s.doctorName ?? 'your doctor'} to review your treatment.`, patientId: s.patientId, link: '/portal/appointments?book=1', external: ['Sms'] });
        result.followUps++;
      }
      s.followUpReminderSentAt = now;
    }
    await s.save();
    result.completed++;
  }
  return result;
}

export async function runMedicationJobs() {
  const hospitals = await runWithContext({ roles: [], permissions: new Set(), system: true }, () => Hospital.find({ isActive: true }).select('_id').lean());
  for (const h of hospitals) {
    await runWithContext({ roles: [], permissions: new Set(), hospitalId: h._id, userName: 'System' }, () => runMedicationPass()).catch((err) =>
      logger.error({ err, hospitalId: h._id.toString() }, 'Medication job failed'),
    );
  }
}

export function scheduleMedicationJobs(everyMs = 5 * MIN) {
  const tick = () => void runMedicationJobs().catch((err) => logger.error({ err }, 'Medication job failed'));
  setTimeout(tick, 20_000);
  return setInterval(tick, everyMs);
}
