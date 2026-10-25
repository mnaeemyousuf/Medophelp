import { runWithContext } from '../../core/context';
import { logger } from '../../core/logger';
import { notify } from '../../core/notifications/notify';
import { Hospital } from '../organization/organization.models';
import { Doctor } from '../staff/staff.models';
import { Appointment } from './appointment.models';

const HOUR = 3_600_000;

/** Local start time of an appointment (date is stored as a calendar day, time as HH:MM). */
const startOf = (a: { date: Date; startTime: string }) => new Date(`${a.date.toISOString().slice(0, 10)}T${a.startTime}:00`);

/**
 * Sends each patient one reminder in the 24 hours before a booked (Scheduled/Confirmed) appointment:
 * in-app plus SMS and email where the hospital has those channels enabled.
 */
export async function runAppointmentReminders(now = new Date()) {
  const dayStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const candidates = await Appointment.find({
    status: { $in: ['Scheduled', 'Confirmed'] },
    reminderSentAt: null,
    date: { $gte: dayStart, $lte: new Date(dayStart.getTime() + 2 * 24 * HOUR) },
  }).lean();
  let sent = 0;
  for (const a of candidates) {
    const start = startOf(a);
    if (start.getTime() <= now.getTime() || start.getTime() - now.getTime() > 24 * HOUR) continue;
    const doctor = await Doctor.findById(a.doctorId).select('name').lean();
    const when = `${start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} at ${a.startTime}`;
    await notify({
      type: 'AppointmentReminder',
      title: 'Appointment reminder',
      message: `Reminder: ${a.appointmentNo} with ${doctor?.name ?? 'your doctor'} on ${when}. Please arrive 15 minutes early.`,
      patientId: a.patientId,
      link: '/portal/appointments',
      external: ['Sms', 'Email'],
    });
    await Appointment.updateOne({ _id: a._id }, { reminderSentAt: now });
    sent++;
  }
  return { sent };
}

export async function runAppointmentJobs() {
  const hospitals = await runWithContext({ roles: [], permissions: new Set(), system: true }, () => Hospital.find({ isActive: true }).select('_id').lean());
  for (const h of hospitals) {
    await runWithContext({ roles: [], permissions: new Set(), hospitalId: h._id, userName: 'System' }, () => runAppointmentReminders()).catch((err) =>
      logger.error({ err, hospitalId: h._id.toString() }, 'Appointment reminder job failed'),
    );
  }
}

export function scheduleAppointmentJobs(everyMs = 15 * 60_000) {
  const tick = () => void runAppointmentJobs().catch((err) => logger.error({ err }, 'Appointment reminder job failed'));
  setTimeout(tick, 25_000);
  return setInterval(tick, everyMs);
}
