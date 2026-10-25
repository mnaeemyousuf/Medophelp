import { ageFromDob } from '@hms/shared';
import { can, requireCtx } from '../../core/context';
import { createdAtOf, oid, orNotFound, toDateString } from '../../core/http';
import { Patient } from '../patients/patient.models';
import { Appointment, Visit } from '../appointments/appointment.models';
import { Invoice } from '../billing/billing.models';
import { assertClinicalAccess } from '../patients/access';
import { toPatientDto } from '../patients/patient.service';
import { ClinicalNote, Diagnosis, NursingAssessment, Prescription, TreatmentPlan, VitalSign } from './clinical.models';
import { LabOrder } from '../laboratory/lab.models';

export interface TimelineEvent {
  at: Date;
  kind: 'visit' | 'vitals' | 'assessment' | 'note' | 'diagnosis' | 'prescription' | 'appointment' | 'invoice' | 'lab';
  title: string;
  detail?: string;
  by?: string;
  department?: string;
  refId: string;
}

/**
 * Full EMR for one patient. Sections are included only when the caller holds the permission for
 * them: e.g. nurses get vitals and assessments but not doctor notes; billing appears only for
 * billing staff and the patient themselves.
 */
export async function getEmr(patientId: string) {
  await assertClinicalAccess(patientId, { audit: true });
  const c = requireCtx();
  const pid = oid(patientId);
  const isSelf = !!c.patientId;
  const showNotes = isSelf || can('clinical.notes.view');
  const showRx = isSelf || can('prescriptions.view') || can('prescriptions.create');
  const showBilling = isSelf || can('billing.view');
  const showLabs = isSelf || can('lab.results.view') || can('lab.process');

  const patient = orNotFound(await Patient.findById(pid).lean(), 'Patient');
  const [visits, vitals, assessments, notes, diagnoses, plans, prescriptions, appointments, invoices, labOrders] = await Promise.all([
    Visit.find({ patientId: pid }).populate('doctorId', 'name').populate('departmentId', 'name').sort({ startedAt: -1 }).limit(100).lean(),
    VitalSign.find({ patientId: pid }).sort({ recordedAt: -1 }).limit(100).lean(),
    NursingAssessment.find({ patientId: pid }).sort({ submittedAt: -1 }).limit(100).lean(),
    showNotes ? ClinicalNote.find({ patientId: pid }).sort({ createdAt: -1 }).limit(100).lean() : Promise.resolve([]),
    Diagnosis.find({ patientId: pid }).sort({ createdAt: -1 }).limit(100).lean(),
    showNotes ? TreatmentPlan.find({ patientId: pid }).sort({ createdAt: -1 }).limit(50).lean() : Promise.resolve([]),
    showRx ? Prescription.find({ patientId: pid }).sort({ prescribedAt: -1 }).limit(100).lean() : Promise.resolve([]),
    Appointment.find({ patientId: pid }).populate('doctorId', 'name').populate('departmentId', 'name').sort({ date: -1, startTime: -1 }).limit(100).lean(),
    showBilling ? Invoice.find({ patientId: pid }).select('-items').sort({ createdAt: -1 }).limit(100).lean() : Promise.resolve([]),
    // Patients only ever see verified results.
    showLabs ? LabOrder.find({ patientId: pid, status: isSelf ? 'Verified' : { $ne: 'Cancelled' } }).select('-history').sort({ createdAt: -1 }).limit(100).lean() : Promise.resolve([]),
  ]);

  const deptOfVisit = new Map(visits.map((v) => [v._id.toString(), (v.departmentId as any)?.name as string | undefined]));
  const timeline: TimelineEvent[] = [
    ...visits.map((v) => ({
      at: v.startedAt,
      kind: 'visit' as const,
      title: `${v.type} visit ${v.visitNo}${v.status === 'Closed' ? '' : ' (open)'}`,
      detail: v.chiefComplaint ?? undefined,
      by: (v.doctorId as any)?.name,
      department: (v.departmentId as any)?.name,
      refId: v._id.toString(),
    })),
    ...vitals.map((v) => ({
      at: v.recordedAt,
      kind: 'vitals' as const,
      title: 'Vitals recorded',
      detail: `BP ${v.systolicBp}/${v.diastolicBp}, HR ${v.heartRate}, T ${v.temperatureC}°C, SpO2 ${v.spo2}%, BMI ${v.bmi ?? '—'}${v.flags?.length ? ` — abnormal: ${v.flags.join(', ')}` : ''}`,
      by: v.recordedByName ?? undefined,
      department: v.visitId ? deptOfVisit.get(v.visitId.toString()) : undefined,
      refId: v._id.toString(),
    })),
    ...assessments.map((a) => ({
      at: a.submittedAt,
      kind: 'assessment' as const,
      title: 'Nursing assessment',
      detail: a.symptoms ?? undefined,
      by: a.nurseName ?? undefined,
      department: deptOfVisit.get(a.visitId.toString()),
      refId: a._id.toString(),
    })),
    ...notes.map((n) => ({
      at: createdAtOf(n),
      kind: 'note' as const,
      title: `${n.type} note`,
      detail: n.chiefComplaint ? `CC: ${n.chiefComplaint}` : undefined,
      by: n.authorName ?? undefined,
      department: deptOfVisit.get(n.visitId.toString()),
      refId: n._id.toString(),
    })),
    ...diagnoses.map((d) => ({
      at: createdAtOf(d),
      kind: 'diagnosis' as const,
      title: `${d.type} diagnosis`,
      detail: `${d.icdCode ? `${d.icdCode} — ` : ''}${d.description}`,
      by: d.doctorName ?? undefined,
      department: deptOfVisit.get(d.visitId.toString()),
      refId: d._id.toString(),
    })),
    ...prescriptions.map((r) => ({
      at: r.prescribedAt,
      kind: 'prescription' as const,
      title: `Prescription ${r.prescriptionNo} (${r.status})`,
      detail: r.items.map((i) => `${i.medicineName} ${i.dosage} ${i.frequency} × ${i.durationDays}d`).join('; '),
      by: r.doctorName ?? undefined,
      department: deptOfVisit.get(r.visitId.toString()),
      refId: r._id.toString(),
    })),
    ...labOrders.map((o) => ({
      at: (o.verifiedAt ?? createdAtOf(o)) as Date,
      kind: 'lab' as const,
      title: `Lab ${o.orderNo} — ${o.status}`,
      detail: o.items.map((i) => i.testName).join(', ') + (o.status === 'Verified' && o.hasAbnormal ? ' — abnormal values' : ''),
      by: o.verifiedByName ?? o.doctorName ?? undefined,
      department: 'Laboratory',
      refId: o._id.toString(),
    })),
    ...invoices.map((i) => ({
      at: i.issuedAt ?? createdAtOf(i),
      kind: 'invoice' as const,
      title: `Invoice ${i.invoiceNo} — ${i.status}`,
      detail: `Total ${i.total.toFixed(2)}, balance ${i.balance.toFixed(2)}`,
      department: i.source,
      refId: i._id.toString(),
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const dto = toPatientDto(patient);
  return {
    patient: { ...dto, age: ageFromDob(patient.dateOfBirth) },
    sections: { notes: showNotes, prescriptions: showRx, billing: showBilling, labs: showLabs },
    visits: visits.map((v) => ({ ...v, doctorName: (v.doctorId as any)?.name, departmentName: (v.departmentId as any)?.name })),
    vitals,
    assessments,
    notes,
    diagnoses,
    treatmentPlans: plans,
    prescriptions,
    appointments: appointments.map((a) => ({
      id: a._id,
      appointmentNo: a.appointmentNo,
      date: toDateString(a.date),
      startTime: a.startTime,
      status: a.status,
      type: a.type,
      doctorName: (a.doctorId as any)?.name,
      departmentName: (a.departmentId as any)?.name,
    })),
    invoices,
    labOrders,
    timeline,
  };
}
