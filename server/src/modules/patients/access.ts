import { Types } from 'mongoose';
import { requireCtx } from '../../core/context';
import { ForbiddenError } from '../../core/errors';
import { todayString, dateOnly } from '../../core/http';
import { recordAudit } from '../../core/audit/audit';
import { Appointment, Visit } from '../appointments/appointment.models';

/**
 * Data-level rule for clinical records (EMR, vitals, notes, prescriptions, results):
 *  - patients (portal.self) see only their own record
 *  - emr.view_all sees everyone in the hospital
 *  - doctors with emr.view see patients they have an appointment or visit with
 *  - nurses with emr.view see patients with an open visit or an appointment today
 * Everyone else is refused, regardless of what the UI shows.
 */
export async function assertClinicalAccess(patientId: Types.ObjectId | string, opts: { audit?: boolean } = {}) {
  const c = requireCtx();
  const pid = typeof patientId === 'string' ? new Types.ObjectId(patientId) : patientId;

  if (c.patientId) {
    if (!c.patientId.equals(pid)) throw new ForbiddenError('You can only view your own records');
    return;
  }
  let allowed = c.permissions.has('emr.view_all');

  if (!allowed && c.permissions.has('emr.view')) {
    if (c.doctorId) {
      allowed = !!(await Appointment.exists({ patientId: pid, doctorId: c.doctorId })) || !!(await Visit.exists({ patientId: pid, doctorId: c.doctorId }));
    }
    if (!allowed && c.nurseId) {
      allowed =
        !!(await Visit.exists({ patientId: pid, status: 'Open' })) ||
        !!(await Appointment.exists({ patientId: pid, date: dateOnly(todayString()) }));
    }
  }
  if (!allowed) throw new ForbiddenError('You are not assigned to this patient');

  if (opts.audit) {
    await recordAudit({ action: 'emr.viewed', module: 'Clinical', entity: 'Patient', entityId: pid });
  }
}
