import { Types } from 'mongoose';
import { z } from 'zod';
import {
  calculateBmi,
  prescriptionWorkflow,
  vitalFlags,
  type consultationNoteSchema,
  type CreatePrescriptionInput,
  type diagnosisSchema,
  type NursingAssessmentInput,
  type PrescriptionStatus,
  type treatmentPlanSchema,
  type VitalsInputSchema,
} from '@hms/shared';
import { requireCtx } from '../../core/context';
import { BusinessRuleError, ForbiddenError } from '../../core/errors';
import { diff, recordAudit, snapshot } from '../../core/audit/audit';
import { dateOnly, oid, orNotFound, todayString } from '../../core/http';
import { withTransaction } from '../../core/db';
import { nextNumber } from '../../core/numbering/numbering';
import { assertTransition } from '../../core/workflow';
import { notify } from '../../core/notifications/notify';
import { Hospital } from '../organization/organization.models';
import { Doctor } from '../staff/staff.models';
import { Patient } from '../patients/patient.models';
import { Appointment, Visit, type AppointmentDoc } from '../appointments/appointment.models';
import { toAppointmentDto, transition } from '../appointments/appointment.service';
import { assertClinicalAccess } from '../patients/access';
import { addCharges } from '../billing/billing.service';
import { ClinicalNote, Diagnosis, NursingAssessment, Prescription, TreatmentPlan, VitalSign } from './clinical.models';
import { LabOrder } from '../laboratory/lab.models';
import { getCatalog } from '../organization/catalog';
import { createSchedulesForDispense, stopSchedulesForPrescription } from '../medication/medication.service';

const todayFilter = () => ({ date: dateOnly(todayString()) });
const queuePopulate = (q: any) =>
  q.populate('patientId', 'mrn firstName lastName gender dateOfBirth phone allergies bloodGroup').populate('doctorId', 'name specialization').populate('departmentId', 'name');

// ── Vitals ───────────────────────────────────────────────────────────────────
export async function saveVitals(patientId: Types.ObjectId, visitId: Types.ObjectId | undefined, v: VitalsInputSchema) {
  const c = requireCtx();
  const bmi = calculateBmi(v.weightKg, v.heightCm);
  const [doc] = await VitalSign.create([
    {
      ...v,
      patientId,
      visitId,
      bmi,
      flags: vitalFlags({ ...v, bmi }),
      recordedBy: c.userId,
      recordedByName: c.userName,
    },
  ]);
  await recordAudit({ action: 'vitals.recorded', module: 'Nursing', entity: 'VitalSign', entityId: doc._id, after: doc });
  return doc;
}

export async function vitalsHistory(patientId: string, limit = 20) {
  await assertClinicalAccess(patientId);
  return VitalSign.find({ patientId: oid(patientId) }).sort({ recordedAt: -1 }).limit(limit).lean();
}

export async function recordStandaloneVitals(patientId: string, v: VitalsInputSchema, visitId?: string) {
  await assertClinicalAccess(patientId);
  return (await saveVitals(oid(patientId), visitId ? oid(visitId) : undefined, v)).toObject();
}

// ── Nursing queue & assessment ──────────────────────────────────────────────
export async function nursingQueue() {
  const items = await queuePopulate(Appointment.find({ ...todayFilter(), status: { $in: ['CheckedIn', 'NurseAssessment'] } }).sort({ checkedInAt: 1 })).lean();
  return items.map(toAppointmentDto);
}

export async function startAssessment(appointmentId: string) {
  await withTransaction(async () => {
    const a = orNotFound((await Appointment.findById(appointmentId)) as AppointmentDoc | null, 'Appointment');
    await transition(a, 'NurseAssessment');
  });
  return assessmentContext(appointmentId);
}

/** Everything the nurse needs on one screen: patient banner, last vitals for comparison. */
export async function assessmentContext(appointmentId: string) {
  const a = orNotFound(await queuePopulate(Appointment.findById(appointmentId)).lean(), 'Appointment');
  const patientId = (a.patientId as any)._id as Types.ObjectId;
  await assertClinicalAccess(patientId);
  const [previous, existing] = await Promise.all([
    VitalSign.find({ patientId }).sort({ recordedAt: -1 }).limit(5).lean(),
    NursingAssessment.findOne({ appointmentId: a._id }).populate('vitalSignId').lean(),
  ]);
  return { appointment: toAppointmentDto(a), allergies: ((a.patientId as any).allergies ?? []).filter((x: any) => !x.removedAt), previousVitals: previous, assessment: existing };
}

export async function submitAssessment(appointmentId: string, input: NursingAssessmentInput) {
  const c = requireCtx();
  const result = await withTransaction(async () => {
    const a = orNotFound((await Appointment.findById(appointmentId)) as AppointmentDoc | null, 'Appointment');
    await assertClinicalAccess(a.patientId);
    if (a.status === 'CheckedIn') await transition(a, 'NurseAssessment');
    if (a.status !== 'NurseAssessment') throw new BusinessRuleError(`Assessment cannot be submitted while the appointment is ${a.status}`);
    if (!a.visitId) throw new BusinessRuleError('Patient has not been checked in');
    const vitals = await saveVitals(a.patientId, a.visitId, input.vitals);
    const [assessment] = await NursingAssessment.create([
      {
        patientId: a.patientId,
        visitId: a.visitId,
        appointmentId: a._id,
        vitalSignId: vitals._id,
        symptoms: input.symptoms,
        notes: input.notes,
        nurseUserId: c.userId,
        nurseName: c.userName,
      },
    ]);
    await recordAudit({ action: 'nursing.assessment_submitted', module: 'Nursing', entity: 'NursingAssessment', entityId: assessment._id, after: assessment });
    await transition(a, 'WaitingForDoctor', 'Ready for doctor');
    return { a, vitals };
  });

  // Let the assigned doctor know the patient is ready (critical if vitals are abnormal).
  const doctor = await Doctor.findById(result.a.doctorId).select('userId').lean();
  const patient = await Patient.findById(result.a.patientId).select('firstName lastName mrn').lean();
  if (doctor?.userId) {
    await notify({
      type: 'PatientReady',
      title: 'Patient ready for consultation',
      message: `${patient?.firstName} ${patient?.lastName} (${patient?.mrn}) — token ${result.a.tokenNumber}${result.vitals.flags.length ? `. Abnormal: ${result.vitals.flags.join(', ')}` : ''}`,
      userIds: [doctor.userId],
      link: `/doctor/consult/${result.a._id}`,
      priority: result.vitals.flags.length ? 'High' : 'Normal',
    });
  }
  return assessmentContext(appointmentId);
}

// ── Doctor queue & consultation ─────────────────────────────────────────────
function requireDoctor() {
  const c = requireCtx();
  if (!c.doctorId) throw new ForbiddenError('Only doctors can perform this action');
  return c.doctorId;
}

async function ownAppointment(appointmentId: string) {
  const doctorId = requireDoctor();
  const a = orNotFound((await Appointment.findById(appointmentId)) as AppointmentDoc | null, 'Appointment');
  if (!a.doctorId.equals(doctorId)) throw new ForbiddenError('This patient is assigned to another doctor');
  return a;
}

export async function ownOpenVisit(visitId: string) {
  const doctorId = requireDoctor();
  const v = orNotFound(await Visit.findById(visitId), 'Visit');
  if (v.doctorId && !v.doctorId.equals(doctorId)) throw new ForbiddenError('This visit belongs to another doctor');
  if (v.status !== 'Open') throw new BusinessRuleError('This visit is closed; clinical records can no longer be changed');
  return v;
}

export async function doctorQueue() {
  const doctorId = requireDoctor();
  const items = await queuePopulate(Appointment.find({ ...todayFilter(), doctorId })).sort({ startTime: 1 }).lean();
  const dto = items.map(toAppointmentDto);
  return {
    waiting: dto.filter((a: { status: string }) => a.status === 'WaitingForDoctor'),
    inConsultation: dto.filter((a: { status: string }) => a.status === 'InConsultation'),
    upcoming: dto.filter((a: { status: string }) => ['Scheduled', 'Confirmed', 'CheckedIn', 'NurseAssessment'].includes(a.status)),
    completed: dto.filter((a: { status: string }) => a.status === 'Completed'),
  };
}

export async function startConsultation(appointmentId: string) {
  await withTransaction(async () => {
    const a = await ownAppointment(appointmentId);
    a.consultationStartedAt = new Date();
    await transition(a, 'InConsultation');
  });
  return consultationContext(appointmentId);
}

/** The consultation workspace: everything recorded so far on this visit. */
export async function consultationContext(appointmentId: string) {
  const a = await ownAppointment(appointmentId);
  if (!a.visitId) throw new BusinessRuleError('Patient has not been checked in');
  const populated = await queuePopulate(Appointment.findById(a._id)).lean();
  const [assessment, notes, diagnoses, plan, prescriptions, labOrders] = await Promise.all([
    NursingAssessment.findOne({ appointmentId: a._id }).populate('vitalSignId').lean(),
    ClinicalNote.find({ visitId: a.visitId }).sort({ createdAt: 1 }).lean(),
    Diagnosis.find({ visitId: a.visitId }).sort({ createdAt: 1 }).lean(),
    TreatmentPlan.findOne({ visitId: a.visitId }).lean(),
    Prescription.find({ visitId: a.visitId }).sort({ createdAt: 1 }).lean(),
    LabOrder.find({ visitId: a.visitId }).select('-history').sort({ createdAt: 1 }).lean(),
  ]);
  return { appointment: toAppointmentDto(populated), visitId: a.visitId.toString(), assessment, notes, diagnoses, treatmentPlan: plan, prescriptions, labOrders };
}

export async function saveConsultationNote(visitId: string, input: z.infer<typeof consultationNoteSchema>) {
  const c = requireCtx();
  const v = await ownOpenVisit(visitId);
  return withTransaction(async () => {
    v.chiefComplaint = input.chiefComplaint;
    await v.save();
    const existing = await ClinicalNote.findOne({ visitId: v._id, type: 'Consultation', authorUserId: c.userId });
    if (existing) {
      if (existing.content === input.clinicalNotes && existing.chiefComplaint === input.chiefComplaint) return existing.toObject();
      const before = snapshot(existing) as Record<string, unknown>;
      const savedAt = (existing as unknown as { updatedAt?: Date }).updatedAt ?? new Date();
      existing.versions.push({ chiefComplaint: existing.chiefComplaint, content: existing.content, savedAt, byName: existing.authorName, reason: existing.amendmentReason });
      existing.chiefComplaint = input.chiefComplaint;
      existing.content = input.clinicalNotes;
      existing.amendedAt = new Date();
      existing.amendmentReason = input.amendmentReason;
      await existing.save();
      await recordAudit({ action: 'clinical_note.amended', module: 'Clinical', entity: 'ClinicalNote', entityId: existing._id, ...diff(before, snapshot(existing) as Record<string, unknown>) });
      return existing.toObject();
    }
    const [note] = await ClinicalNote.create([
      { patientId: v.patientId, visitId: v._id, type: 'Consultation', chiefComplaint: input.chiefComplaint, content: input.clinicalNotes, authorUserId: c.userId, authorName: c.userName, authorRole: 'Doctor' },
    ]);
    await recordAudit({ action: 'clinical_note.created', module: 'Clinical', entity: 'ClinicalNote', entityId: note._id, after: note });
    return note.toObject();
  });
}

export async function addDiagnosis(visitId: string, input: z.infer<typeof diagnosisSchema>) {
  const c = requireCtx();
  const v = await ownOpenVisit(visitId);
  const doctor = await Doctor.findById(c.doctorId).select('name').lean();
  const d = await Diagnosis.create({ ...input, patientId: v.patientId, visitId: v._id, doctorId: c.doctorId, doctorName: doctor?.name });
  await recordAudit({ action: 'diagnosis.created', module: 'Clinical', entity: 'Diagnosis', entityId: d._id, after: d });
  return d.toObject();
}

export async function removeDiagnosis(visitId: string, diagnosisId: string) {
  const c = requireCtx();
  await ownOpenVisit(visitId);
  const d = orNotFound(await Diagnosis.findOne({ _id: oid(diagnosisId), visitId: oid(visitId) }), 'Diagnosis');
  d.isDeleted = true;
  d.deletedAt = new Date();
  d.deletedBy = c.userId;
  await d.save();
  await recordAudit({ action: 'diagnosis.retracted', module: 'Clinical', entity: 'Diagnosis', entityId: d._id, before: d });
}

export async function saveTreatmentPlan(visitId: string, input: z.infer<typeof treatmentPlanSchema>) {
  const c = requireCtx();
  const v = await ownOpenVisit(visitId);
  const existing = await TreatmentPlan.findOne({ visitId: v._id });
  const before = existing ? snapshot(existing) : undefined;
  const plan = existing ?? new TreatmentPlan({ patientId: v.patientId, visitId: v._id, doctorId: c.doctorId });
  plan.plan = input.plan;
  plan.followUpDate = input.followUpDate ? dateOnly(input.followUpDate) : undefined;
  await plan.save();
  await recordAudit({ action: existing ? 'treatment_plan.amended' : 'treatment_plan.created', module: 'Clinical', entity: 'TreatmentPlan', entityId: plan._id, before, after: plan });
  return plan.toObject();
}

export async function createPrescription(visitId: string, input: CreatePrescriptionInput) {
  const c = requireCtx();
  const v = await ownOpenVisit(visitId);
  const [hospital, doctor, patient] = await Promise.all([
    Hospital.findById(c.hospitalId).lean(),
    Doctor.findById(c.doctorId).select('name').lean(),
    Patient.findById(v.patientId).select('allergies').lean(),
  ]);
  // Allergy safety check: block medicines whose name contains a recorded allergen.
  const allergens = (patient?.allergies ?? []).filter((a) => !a.removedAt).map((a) => a.allergen.toLowerCase());
  const conflict = input.items.find((i) => allergens.some((al) => i.medicineName.toLowerCase().includes(al)));
  if (conflict) throw new BusinessRuleError(`${conflict.medicineName} conflicts with a recorded allergy`, 'allergy_conflict');

  const rx = await withTransaction(async () => {
    const prescriptionNo = await nextNumber('prescription', hospital!.numbering!.prescription!, hospital!.code);
    const [doc] = await Prescription.create([
      {
        prescriptionNo,
        patientId: v.patientId,
        visitId: v._id,
        doctorId: c.doctorId,
        doctorName: doctor?.name,
        notes: input.notes,
        items: input.items.map((i) => ({ ...i, medicineId: i.medicineId ? oid(i.medicineId) : undefined })),
      },
    ]);
    await recordAudit({ action: 'prescription.created', module: 'Clinical', entity: 'Prescription', entityId: doc._id, after: doc });
    // Medication reminders start when the doctor prescribes (default) or when pharmacy dispenses.
    if ((await getCatalog()).medicationScheduleFrom === 'Prescribed') await createSchedulesForDispense(doc, doc.items.map((i) => i._id));
    return doc;
  });
  await notify({
    type: 'PrescriptionAvailable',
    title: 'New prescription',
    message: `Prescription ${rx.prescriptionNo} has been sent to the pharmacy.`,
    patientId: v.patientId,
    external: ['Sms'],
  });
  return rx.toObject();
}

export async function cancelPrescription(id: string, reason: string) {
  const c = requireCtx();
  const rx = orNotFound(await Prescription.findById(id), 'Prescription');
  if (!rx.doctorId.equals(c.doctorId!)) throw new ForbiddenError('Only the prescribing doctor can cancel this prescription');
  assertTransition(prescriptionWorkflow, rx.status as PrescriptionStatus, 'Cancelled');
  rx.status = 'Cancelled';
  rx.cancelReason = reason;
  await rx.save();
  await stopSchedulesForPrescription(rx._id, `Prescription cancelled: ${reason}`);
  await recordAudit({ action: 'prescription.cancelled', module: 'Clinical', entity: 'Prescription', entityId: rx._id, before: { status: 'Active' }, after: { status: 'Cancelled', reason } });
  return rx.toObject();
}

/**
 * Ends the consultation: requires at least one diagnosis, closes the visit and posts the
 * consultation fee to billing in the same transaction.
 */
export async function completeConsultation(appointmentId: string, input: { followUpDate?: string }) {
  await withTransaction(async () => {
    const a = await ownAppointment(appointmentId);
    if (!a.visitId) throw new BusinessRuleError('Patient has not been checked in');
    const [dxCount, noteCount] = await Promise.all([Diagnosis.countDocuments({ visitId: a.visitId }), ClinicalNote.countDocuments({ visitId: a.visitId })]);
    if (!noteCount) throw new BusinessRuleError('Record the consultation note before completing');
    if (!dxCount) throw new BusinessRuleError('Add at least one diagnosis before completing');

    const visit = orNotFound(await Visit.findById(a.visitId), 'Visit');
    visit.status = 'Closed';
    visit.endedAt = new Date();
    if (input.followUpDate) visit.followUpDate = dateOnly(input.followUpDate);
    await visit.save();
    a.completedAt = new Date();
    await transition(a, 'Completed');

    const doctor = await Doctor.findById(a.doctorId).lean();
    const catalog = await getCatalog();
    const apptType = catalog.appointmentTypes.find((t) => t.code === a.type);
    const followUp = (apptType?.feeBasis ?? (a.type === 'FollowUp' ? 'FollowUp' : 'Consultation')) === 'FollowUp';
    const fee = followUp ? doctor!.followUpFee : doctor!.consultationFee;
    if (fee > 0) {
      await addCharges({
        patientId: a.patientId,
        visitId: visit._id,
        departmentId: a.departmentId,
        source: 'OPD',
        sourceRef: `consultation:${a._id}`,
        items: [{ description: `${apptType?.label ?? (followUp ? 'Follow-up' : 'Consultation')} — ${doctor!.name}`, quantity: 1, unitPrice: fee, discount: 0, taxRate: 0 }],
      });
    }
  });
  return consultationContext(appointmentId);
}

// ── Prescriptions (read) ─────────────────────────────────────────────────────
export async function listPatientPrescriptions(patientId: string) {
  await assertClinicalAccess(patientId);
  return Prescription.find({ patientId: oid(patientId) }).sort({ prescribedAt: -1 }).lean();
}

export async function getPrescription(id: string) {
  const c = requireCtx();
  const rx = orNotFound(await Prescription.findById(id).lean(), 'Prescription');
  if (!(c.permissions.has('pharmacy.dispense') && !c.patientId)) await assertClinicalAccess(rx.patientId);
  return rx;
}
