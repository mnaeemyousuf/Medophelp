import type { Types } from 'mongoose';
import { CONSENT_TYPES, SELF_SERVICE_CONSENTS, type ConsentType, type RecordConsentInput } from '@hms/shared';
import { can, requireCtx } from '../../core/context';
import { ForbiddenError } from '../../core/errors';
import { recordAudit } from '../../core/audit/audit';
import { oid, orNotFound } from '../../core/http';
import { Patient, PatientConsent } from './patient.models';

function assertCanSee(patientId: Types.ObjectId) {
  const c = requireCtx();
  if (c.patientId && !c.patientId.equals(patientId)) throw new ForbiddenError('You can only view your own consents');
  if (!c.patientId && !can('patients.view')) throw new ForbiddenError();
}

/** Current decision per consent type (null = never recorded) and the full history. */
export async function listConsents(patientId: string) {
  const pid = oid(patientId);
  assertCanSee(pid);
  orNotFound(await Patient.exists({ _id: pid }), 'Patient');
  const history = await PatientConsent.find({ patientId: pid }).sort({ at: -1 }).lean();
  const current = CONSENT_TYPES.map((type) => {
    const latest = history.find((h) => h.type === type);
    return { type, granted: latest ? latest.granted : null, at: latest?.at ?? null, method: latest?.method ?? null, recordedByName: latest?.recordedByName ?? null };
  });
  return { current, history };
}

/**
 * Records a consent decision. Staff with `patients.update` may record any type (with the method used);
 * patients may change their own communication preferences in the portal.
 */
export async function recordConsent(patientId: string, input: RecordConsentInput) {
  const c = requireCtx();
  const pid = oid(patientId);
  const self = !!c.patientId?.equals(pid);
  if (c.patientId && !self) throw new ForbiddenError();
  if (self && !(SELF_SERVICE_CONSENTS as readonly string[]).includes(input.type)) throw new ForbiddenError('Clinical consents are recorded by hospital staff');
  if (!self && !can('patients.update')) throw new ForbiddenError();
  orNotFound(await Patient.exists({ _id: pid }), 'Patient');
  const rec = await PatientConsent.create({ patientId: pid, type: input.type, granted: input.granted, method: self ? 'Portal' : input.method, note: input.note, recordedByName: c.userName, recordedByPatient: self });
  await recordAudit({ action: input.granted ? 'consent.granted' : 'consent.withdrawn', module: 'Patients', entity: 'Patient', entityId: pid, after: { type: input.type, method: rec.method, note: input.note } });
  return rec.toObject();
}

/** Which external channels a patient allows. No record = allowed (care-related service messages). */
export async function allowedChannels(patientId: Types.ObjectId): Promise<Record<'Sms' | 'Email' | 'Push', boolean>> {
  const rows = await PatientConsent.aggregate([
    { $match: { patientId, type: { $in: ['SmsMessages', 'EmailMessages', 'PushNotifications'] } } },
    { $sort: { at: -1 } },
    { $group: { _id: '$type', granted: { $first: '$granted' } } },
  ]);
  const get = (t: ConsentType) => rows.find((r) => r._id === t)?.granted ?? true;
  return { Sms: get('SmsMessages'), Email: get('EmailMessages'), Push: get('PushNotifications') };
}
