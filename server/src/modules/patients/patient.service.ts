import { Types } from 'mongoose';
import type { z } from 'zod';
import { ageFromDob, type CreatePatientInput, type UpdatePatientInput } from '@hms/shared';
import type { allergySchema, insuranceSchema, medicalHistorySchema } from '@hms/shared';
import { requireCtx } from '../../core/context';
import { BusinessRuleError, ConflictError, ForbiddenError } from '../../core/errors';
import { diff, recordAudit, snapshot } from '../../core/audit/audit';
import { dateOnly, escapeRegex, oid, orNotFound, skipOf, sortBy } from '../../core/http';
import { withTransaction } from '../../core/db';
import { nextNumber } from '../../core/numbering/numbering';
import { storage, validateUpload } from '../../core/storage/storage';
import { Hospital } from '../organization/organization.models';
import { Patient, PatientDocument, type PatientDoc } from './patient.models';

export function toPatientDto(p: any) {
  return {
    id: p._id.toString(),
    mrn: p.mrn,
    firstName: p.firstName,
    lastName: p.lastName,
    fullName: `${p.firstName} ${p.lastName}`,
    guardianName: p.guardianName,
    cnic: p.cnic,
    dateOfBirth: p.dateOfBirth?.toISOString().slice(0, 10),
    age: p.dateOfBirth ? ageFromDob(p.dateOfBirth) : undefined,
    gender: p.gender,
    bloodGroup: p.bloodGroup,
    phone: p.phone,
    email: p.email,
    address: p.address,
    city: p.city,
    emergencyContactName: p.emergencyContactName,
    emergencyContactRelation: p.emergencyContactRelation,
    emergencyContactPhone: p.emergencyContactPhone,
    isProvisional: p.isProvisional,
    allergies: (p.allergies ?? []).filter((a: any) => !a.removedAt),
    medicalHistory: (p.medicalHistory ?? []).filter((h: any) => !h.removedAt),
    insurances: (p.insurances ?? []).filter((i: any) => !i.removedAt),
    createdAt: p.createdAt,
  };
}

/** Finds likely duplicates: same ID number, or same phone + same name/date of birth. */
export async function findPossibleDuplicates(input: { cnic?: string; phone?: string; firstName?: string; lastName?: string; dateOfBirth?: string }, excludeId?: Types.ObjectId) {
  const or: Record<string, unknown>[] = [];
  if (input.cnic) or.push({ cnic: input.cnic });
  if (input.phone && input.firstName) {
    or.push({ phone: input.phone, firstName: new RegExp(`^${escapeRegex(input.firstName)}$`, 'i') });
  }
  if (input.dateOfBirth && input.firstName && input.lastName) {
    or.push({
      dateOfBirth: dateOnly(input.dateOfBirth),
      firstName: new RegExp(`^${escapeRegex(input.firstName)}$`, 'i'),
      lastName: new RegExp(`^${escapeRegex(input.lastName)}$`, 'i'),
    });
  }
  if (!or.length) return [];
  const found = await Patient.find({ $or: or, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
    .limit(5)
    .select('mrn firstName lastName dateOfBirth phone cnic')
    .lean();
  return found.map((p) => ({ id: p._id.toString(), mrn: p.mrn, name: `${p.firstName} ${p.lastName}`, dateOfBirth: p.dateOfBirth.toISOString().slice(0, 10), phone: p.phone, sameCnic: !!input.cnic && p.cnic === input.cnic }));
}

export async function registerPatient(input: CreatePatientInput) {
  const c = requireCtx();
  const dupes = await findPossibleDuplicates(input);
  if (dupes.some((d) => d.sameCnic)) {
    throw new ConflictError('A patient with this CNIC/ID is already registered', 'duplicate_patient', { duplicates: dupes });
  }
  if (dupes.length && !input.confirmNotDuplicate) {
    throw new ConflictError('Possible duplicate patient found. Review the matches or confirm this is a new patient.', 'possible_duplicate', { duplicates: dupes });
  }

  const hospital = orNotFound(await Hospital.findById(c.hospitalId).lean(), 'Hospital');
  return withTransaction(async () => {
    const mrn = await nextNumber('mrn', hospital.numbering!.mrn!, hospital.code);
    const trail = { addedBy: c.userId, addedAt: new Date() };
    const [p] = await Patient.create([
      {
        mrn,
        firstName: input.firstName,
        lastName: input.lastName,
        guardianName: input.guardianName,
        cnic: input.cnic,
        dateOfBirth: dateOnly(input.dateOfBirth),
        gender: input.gender,
        bloodGroup: input.bloodGroup,
        phone: input.phone,
        email: input.email,
        address: input.address,
        city: input.city,
        emergencyContactName: input.emergencyContactName,
        emergencyContactRelation: input.emergencyContactRelation,
        emergencyContactPhone: input.emergencyContactPhone,
        allergies: input.allergies.map((a) => ({ ...a, ...trail })),
        medicalHistory: input.medicalHistory.map((h) => ({ ...h, diagnosedOn: h.diagnosedOn ? dateOnly(h.diagnosedOn) : undefined, ...trail })),
        insurances: input.insurance ? [{ ...input.insurance, expiresOn: input.insurance.expiresOn ? dateOnly(input.insurance.expiresOn) : undefined, ...trail }] : [],
      },
    ]);
    await recordAudit({ action: 'patient.registered', module: 'Patients', entity: 'Patient', entityId: p._id, after: p });
    return toPatientDto(p.toObject());
  });
}

export async function searchPatients(q: { page: number; pageSize: number; search?: string; gender?: string; sort?: string }) {
  const c = requireCtx();
  if (c.patientId) throw new ForbiddenError();
  const filter: Record<string, unknown> = {};
  if (q.gender) filter.gender = q.gender;
  const s = q.search?.trim();
  if (s) {
    const digits = s.replace(/\D/g, '');
    const or: Record<string, unknown>[] = [
      { mrn: s.toUpperCase() },
      { searchName: new RegExp(`(^|\\s)${escapeRegex(s.toLowerCase())}`) },
    ];
    if (digits.length >= 5) {
      or.push({ cnic: new RegExp(`^${escapeRegex(s)}`) });
      or.push({ phone: new RegExp(escapeRegex(digits.slice(-7))) });
    }
    if (/^[A-Z]{1,6}-\d{4}-\d*$/i.test(s)) or.push({ mrn: new RegExp(`^${escapeRegex(s.toUpperCase())}`) });
    filter.$or = or;
  }
  const [items, total] = await Promise.all([
    Patient.find(filter)
      .select('mrn firstName lastName dateOfBirth gender phone cnic bloodGroup city isProvisional createdAt')
      .sort(sortBy(q.sort, { name: 'searchName', mrn: 'mrn', registered: 'createdAt', dateOfBirth: 'dateOfBirth', city: 'city' }, s ? { searchName: 1 } : { createdAt: -1 }))
      .skip(skipOf(q))
      .limit(q.pageSize)
      .lean(),
    Patient.countDocuments(filter),
  ]);
  return { items: items.map(toPatientDto), page: q.page, pageSize: q.pageSize, total };
}

export async function getPatient(id: string) {
  const c = requireCtx();
  if (c.patientId && !c.patientId.equals(id)) throw new ForbiddenError('You can only view your own records');
  return toPatientDto(orNotFound(await Patient.findById(id).lean(), 'Patient'));
}

export async function updatePatient(id: string, input: UpdatePatientInput) {
  const p = orNotFound((await Patient.findById(id)) as PatientDoc | null, 'Patient');
  if (input.cnic && input.cnic !== p.cnic) {
    const dupes = await findPossibleDuplicates({ cnic: input.cnic }, p._id);
    if (dupes.length) throw new ConflictError('Another patient already has this CNIC/ID', 'duplicate_patient', { duplicates: dupes });
  }
  const before = snapshot(p) as Record<string, unknown>;
  const { dateOfBirth, completeRegistration, ...rest } = input;
  p.set(rest);
  if (dateOfBirth) p.dateOfBirth = dateOnly(dateOfBirth);
  // An emergency quick-registration is finalised explicitly, once real contact details exist.
  if (completeRegistration && p.isProvisional) {
    if (!p.phone) throw new BusinessRuleError('Add a phone number before completing the registration');
    if (/^unknown$/i.test(p.firstName)) throw new BusinessRuleError("Record the patient's real name before completing the registration");
    p.isProvisional = false;
  }
  await p.save();
  await recordAudit({ action: 'patient.updated', module: 'Patients', entity: 'Patient', entityId: p._id, ...diff(before, snapshot(p) as Record<string, unknown>) });
  return toPatientDto(p.toObject());
}

type ListKind = 'allergies' | 'medicalHistory' | 'insurances';

export async function addPatientEntry(id: string, kind: ListKind, entry: z.infer<typeof allergySchema> | z.infer<typeof medicalHistorySchema> | z.infer<typeof insuranceSchema>) {
  const c = requireCtx();
  const p = orNotFound((await Patient.findById(id)) as PatientDoc | null, 'Patient');
  const data: Record<string, unknown> = { ...entry, addedBy: c.userId, addedAt: new Date() };
  for (const k of ['diagnosedOn', 'expiresOn']) if (typeof data[k] === 'string') data[k] = dateOnly(data[k] as string);
  if (kind === 'allergies' && p.allergies.some((a) => !a.removedAt && a.allergen.toLowerCase() === (entry as { allergen: string }).allergen.toLowerCase())) {
    throw new BusinessRuleError('This allergy is already recorded');
  }
  if (kind === 'insurances') p.insurances.forEach((i) => (i.isPrimary = false));
  (p[kind] as unknown as { push(x: unknown): void }).push(data);
  await p.save();
  const added = (p[kind] as unknown as Array<{ _id: Types.ObjectId }>).at(-1);
  await recordAudit({ action: `patient.${kind}_added`, module: 'Patients', entity: 'Patient', entityId: p._id, after: added });
  return toPatientDto(p.toObject());
}

export async function removePatientEntry(id: string, kind: ListKind, entryId: string) {
  const c = requireCtx();
  const p = orNotFound((await Patient.findById(id)) as PatientDoc | null, 'Patient');
  const entry = (p[kind] as unknown as Types.DocumentArray<any>).id(entryId);
  if (!entry || entry.removedAt) throw new BusinessRuleError('Entry not found');
  entry.removedAt = new Date();
  entry.removedBy = c.userId;
  await p.save();
  await recordAudit({ action: `patient.${kind}_removed`, module: 'Patients', entity: 'Patient', entityId: p._id, before: entry });
  return toPatientDto(p.toObject());
}

// ── Documents ────────────────────────────────────────────────────────────────
export async function uploadDocument(patientId: string, file: Express.Multer.File, meta: { category: string; notes?: string }) {
  orNotFound(await Patient.exists({ _id: oid(patientId) }), 'Patient');
  const { key, safeName, contentType } = validateUpload(file, `patients/${patientId}`);
  await storage.put(key, file.buffer, contentType);
  const doc = await PatientDocument.create({
    patientId: oid(patientId),
    category: meta.category,
    notes: meta.notes,
    fileName: safeName,
    contentType,
    sizeBytes: file.size,
    storageKey: key,
  });
  await recordAudit({ action: 'patient.document_uploaded', module: 'Patients', entity: 'PatientDocument', entityId: doc._id, after: doc });
  return doc.toObject();
}

export const listDocuments = (patientId: string) => PatientDocument.find({ patientId: oid(patientId) }).sort({ createdAt: -1 }).lean();

export async function downloadDocument(patientId: string, docId: string) {
  const doc = orNotFound(await PatientDocument.findOne({ _id: oid(docId), patientId: oid(patientId) }).lean(), 'Document');
  const data = await storage.get(doc.storageKey);
  await recordAudit({ action: 'patient.document_downloaded', module: 'Patients', entity: 'PatientDocument', entityId: doc._id });
  return { doc, data };
}
