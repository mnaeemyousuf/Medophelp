import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { CalendarPlus, ClipboardList, Download, FileText, HeartPulse, Pencil, Plus, Printer, ShieldAlert, Stethoscope, Trash2, Upload } from 'lucide-react';
import type { z } from 'zod';
import { ALLERGY_SEVERITIES, BLOOD_GROUPS, GENDERS, allergySchema, updatePatientSchema } from '@hms/shared';
import { api, ApiError, openPdf } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { appointmentTypeLabel, useCatalog } from '@/lib/catalog';
import { cn, formatDate, formatDateTime, humanize, money } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, Input, PageLoader, Select } from '@/components/ui/primitives';
import { DataTable, KeyValue, Tabs } from '@/components/ui/data';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog, Dialog, Drawer, useDisclosure } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';
import { PatientBanner, VitalsComparison, VitalsHistoryTable } from '@/components/clinical';
import { NotFoundPage } from '@/pages/errors';
import type { AdmissionRow, ClinicalNote, Diagnosis, Invoice, LabOrder, Patient, Prescription, Vitals } from '@/types';
import { LabOrdersList } from '@/pages/laboratory/LabPages';
import { PatientMedicationsPanel } from '@/pages/medication/MedicationPages';
import { ConsentCard, PortalAccessCard } from './ConsentCard';

interface Emr {
  patient: Patient;
  sections: { notes: boolean; prescriptions: boolean; billing: boolean; labs: boolean };
  labOrders?: LabOrder[];
  visits: Array<{ _id: string; visitNo: string; type: string; status: string; startedAt: string; endedAt?: string; chiefComplaint?: string; doctorName?: string; departmentName?: string; followUpDate?: string }>;
  vitals: Vitals[];
  assessments: Array<{ _id: string; symptoms?: string; notes?: string; nurseName?: string; submittedAt: string; visitId: string }>;
  notes: ClinicalNote[];
  diagnoses: Diagnosis[];
  treatmentPlans: Array<{ _id: string; plan: string; followUpDate?: string; createdAt: string }>;
  prescriptions: Prescription[];
  appointments: Array<{ id: string; appointmentNo: string; date: string; startTime: string; status: string; type: string; doctorName?: string; departmentName?: string }>;
  invoices: Invoice[];
  timeline: Array<{ at: string; kind: string; title: string; detail?: string; by?: string; department?: string; refId: string }>;
}

type TabKey = 'overview' | 'timeline' | 'visits' | 'vitals' | 'notes' | 'diagnoses' | 'prescriptions' | 'medications' | 'lab' | 'documents' | 'billing' | 'appointments' | 'admissions';

export function PatientProfilePage({ portal }: { portal?: boolean }) {
  const { id: routeId } = useParams();
  const { user, can } = useAuth();
  const id = portal ? user!.patientId! : routeId!;
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabKey) ?? (portal ? 'timeline' : 'overview');
  const setTab = (t: TabKey) => setParams({ tab: t }, { replace: true });
  const clinical = can('emr.view', 'emr.view_all', 'portal.self');

  const patientQ = useQuery({ queryKey: ['patient', id], queryFn: () => api.get<Patient>(`/patients/${id}`), retry: false });
  const emrQ = useQuery({
    queryKey: ['emr', id],
    queryFn: () => api.get<Emr>(`/clinical/emr/${id}`),
    enabled: clinical,
    retry: false,
  });
  const emrDenied = emrQ.error instanceof ApiError && emrQ.error.status === 403;

  if (patientQ.isLoading) return <PageLoader />;
  if (patientQ.error instanceof ApiError && patientQ.error.status === 404) return <NotFoundPage />;
  const p = emrQ.data?.patient ?? patientQ.data;
  if (!p) return <PageLoader />;
  const emr = emrQ.data;

  const tabs: Array<{ key: TabKey; label: string; count?: number; show: boolean }> = [
    { key: 'overview', label: 'Overview', show: !portal },
    { key: 'timeline', label: 'Timeline', show: !!emr },
    { key: 'visits', label: 'Visits', count: emr?.visits.length, show: !!emr },
    { key: 'vitals', label: 'Vitals', count: emr?.vitals.length, show: !!emr },
    { key: 'notes', label: 'Clinical notes', count: emr?.notes.length, show: !!emr?.sections.notes },
    { key: 'diagnoses', label: 'Diagnoses', count: emr?.diagnoses.length, show: !!emr },
    { key: 'prescriptions', label: 'Prescriptions', count: emr?.prescriptions.length, show: !!emr?.sections.prescriptions },
    { key: 'medications', label: 'Medications', show: !portal && can('medication.manage') && !emrDenied },
    { key: 'lab', label: 'Lab results', count: emr?.labOrders?.length, show: !!emr?.sections.labs },
    { key: 'documents', label: 'Documents', show: can('patients.documents', 'portal.self') },
    { key: 'billing', label: 'Billing', count: emr?.invoices.length, show: !!emr?.sections.billing || can('billing.view') },
    { key: 'appointments', label: 'Appointments', count: emr?.appointments.length, show: true },
    { key: 'admissions', label: 'Admissions', show: true },
  ];
  const visibleTabs = tabs.filter((t) => t.show);
  const active = visibleTabs.some((t) => t.key === tab) ? tab : visibleTabs[0].key;

  return (
    <div className="space-y-4">
      <PatientBanner
        name={p.fullName}
        mrn={p.mrn}
        age={p.age}
        gender={p.gender}
        bloodGroup={p.bloodGroup}
        phone={p.phone}
        allergies={p.allergies}
        right={
          !portal && (
            <>
              {can('appointments.manage') && (
                <Link to={`/appointments?book=1&patientId=${p.id}`}>
                  <Button variant="outline" size="sm" icon={<CalendarPlus className="h-4 w-4" />}>Book</Button>
                </Link>
              )}
              <Button variant="outline" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => openPdf(`/patients/${p.id}/registration-summary.pdf`).catch((e) => toast.error(e.message))}>
                Summary
              </Button>
            </>
          )
        }
      />
      {p.isProvisional && <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">Provisional emergency registration — complete the demographics.</div>}
      {emrDenied && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-subtle px-3 py-2 text-sm text-muted">
          <ShieldAlert className="mt-0.5 h-4 w-4" /> Clinical records are visible only to the care team assigned to this patient. Demographics, appointments and billing remain available.
        </div>
      )}

      <Tabs tabs={visibleTabs} value={active} onChange={setTab} />

      {active === 'overview' && <OverviewTab patient={p} emr={emr} />}
      {active === 'timeline' && emr && <TimelineTab events={emr.timeline} />}
      {active === 'visits' && emr && <VisitsTab emr={emr} />}
      {active === 'vitals' && emr && <VitalsTab vitals={emr.vitals} />}
      {active === 'notes' && emr && <NotesTab notes={emr.notes} plans={emr.treatmentPlans} />}
      {active === 'diagnoses' && emr && (
        <Card>
          <DataTable
            rows={emr.diagnoses}
            rowKey={(d) => d._id}
            empty={{ title: 'No diagnoses recorded' }}
            columns={[
              { key: 'date', header: 'Date', cell: (d) => formatDate(d.createdAt) },
              { key: 'code', header: 'ICD-10', cell: (d) => <span className="font-mono text-xs">{d.icdCode ?? '—'}</span> },
              { key: 'desc', header: 'Diagnosis', cell: (d) => <span className="font-medium">{d.description}</span> },
              { key: 'type', header: 'Type', cell: (d) => <Badge tone={d.type === 'Final' ? 'ok' : 'warn'}>{d.type}</Badge> },
              { key: 'by', header: 'Doctor', cell: (d) => d.doctorName, hideOnMobile: true },
            ]}
          />
        </Card>
      )}
      {active === 'prescriptions' && emr && <PrescriptionsTab rows={emr.prescriptions} />}
      {active === 'medications' && <PatientMedicationsPanel patientId={p.id} />}
      {active === 'lab' && emr && (
        <Card>
          <LabOrdersList orders={emr.labOrders ?? []} />
        </Card>
      )}
      {active === 'documents' && <DocumentsTab patientId={p.id} readOnly={portal || !can('patients.documents')} />}
      {active === 'billing' && <BillingTab patientId={p.id} rows={emr?.invoices} portal={portal} />}
      {active === 'appointments' && <AppointmentsTab patientId={p.id} rows={emr?.appointments} />}
      {active === 'admissions' && <AdmissionsTab patientId={p.id} />}
    </div>
  );
}

function OverviewTab({ patient: p, emr }: { patient: Patient; emr?: Emr }) {
  const { can } = useAuth();
  const edit = useDisclosure();
  const allergy = useDisclosure();
  const qc = useQueryClient();
  const [removing, setRemoving] = useState<{ kind: string; id: string; label: string } | null>(null);
  const remove = useMutation({
    mutationFn: () => api.del(`/patients/${p.id}/${removing!.kind}/${removing!.id}`),
    onSuccess: () => {
      toast.success('Entry removed (kept in history)');
      setRemoving(null);
      qc.invalidateQueries({ queryKey: ['patient', p.id] });
      qc.invalidateQueries({ queryKey: ['emr', p.id] });
    },
    onError: (e) => handleFormError(e),
  });
  const canEditClinical = can('patients.update', 'clinical.consult', 'vitals.record');
  const latest = emr?.vitals[0];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Demographics" actions={can('patients.update') && <Button size="sm" variant="outline" icon={<Pencil className="h-3.5 w-3.5" />} onClick={edit.onOpen}>Edit</Button>} />
        <div className="p-4">
          <KeyValue
            cols={3}
            items={[
              ['Father / husband', p.guardianName],
              ['CNIC / ID', p.cnic],
              ['Date of birth', `${formatDate(p.dateOfBirth)} (${p.age} y)`],
              ['Gender', p.gender],
              ['Blood group', p.bloodGroup],
              ['Phone', p.phone],
              ['Email', p.email],
              ['City', p.city],
              ['Address', p.address],
              ['Emergency contact', [p.emergencyContactName, p.emergencyContactRelation].filter(Boolean).join(' · ')],
              ['Emergency phone', p.emergencyContactPhone],
              ['Registered', formatDate(p.createdAt)],
            ]}
          />
        </div>
      </Card>
      <Card>
        <CardHeader title="Latest vitals" />
        <div className="p-4">{emr ? <VitalsComparison current={latest} previous={emr.vitals[1]} /> : <p className="text-sm text-muted">Not available for your role.</p>}</div>
      </Card>

      <Card>
        <CardHeader title="Allergies" actions={canEditClinical && <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={allergy.onOpen}>Add</Button>} />
        <ul className="divide-y divide-border">
          {p.allergies.length === 0 && <li className="px-4 py-3 text-sm text-muted">No known allergies</li>}
          {p.allergies.map((a) => (
            <li key={a._id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
              <span className="flex-1">
                <span className="font-medium text-danger">{a.allergen}</span>
                {a.reaction && <span className="text-muted"> — {a.reaction}</span>}
              </span>
              <Badge tone="danger">{a.severity}</Badge>
              {can('patients.update', 'clinical.consult') && (
                <button className="text-muted hover:text-danger" onClick={() => setRemoving({ kind: 'allergies', id: a._id, label: a.allergen })} aria-label="Remove allergy">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Medical history" />
        <ul className="divide-y divide-border">
          {p.medicalHistory.length === 0 && <li className="px-4 py-3 text-sm text-muted">None recorded</li>}
          {p.medicalHistory.map((h) => (
            <li key={h._id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
              <span className="flex-1 font-medium">{h.condition}</span>
              {h.isChronic && <Badge tone="warn">Chronic</Badge>}
              {h.diagnosedOn && <span className="text-xs text-muted">{formatDate(h.diagnosedOn)}</span>}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Insurance" />
        <ul className="divide-y divide-border">
          {p.insurances.length === 0 && <li className="px-4 py-3 text-sm text-muted">Self-pay</li>}
          {p.insurances.map((i) => (
            <li key={i._id} className="px-4 py-2.5 text-sm">
              <p className="font-medium">{i.provider}</p>
              <p className="text-xs text-muted">Policy {i.policyNumber} · {i.coveragePercent}% cover{i.coverageLimit ? ` up to ${money(i.coverageLimit)}` : ''}{i.expiresOn ? ` · expires ${formatDate(i.expiresOn)}` : ''}</p>
            </li>
          ))}
        </ul>
      </Card>
      <ConsentCard patientId={p.id} />
      {can('patients.update') && !p.isProvisional && <PortalAccessCard patientId={p.id} defaultEmail={p.email} />}

      <EditPatientDrawer patient={p} open={edit.open} onClose={edit.onClose} />
      <AddAllergyDialog patientId={p.id} open={allergy.open} onClose={allergy.onClose} />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        danger
        title="Remove allergy?"
        confirmLabel="Remove"
        message={<>Remove <b>{removing?.label}</b> from the active allergy list? The entry is kept in the patient's audit history.</>}
      />
    </div>
  );
}

function EditPatientDrawer({ patient: p, open, onClose }: { patient: Patient; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<z.input<typeof updatePatientSchema>, unknown, z.output<typeof updatePatientSchema>>({
    resolver: zodResolver(updatePatientSchema),
    values: {
      firstName: p.firstName,
      lastName: p.lastName,
      guardianName: p.guardianName ?? '',
      cnic: p.cnic ?? '',
      dateOfBirth: p.dateOfBirth,
      gender: p.gender as never,
      bloodGroup: p.bloodGroup as never,
      phone: p.phone,
      email: p.email ?? '',
      address: p.address ?? '',
      city: p.city ?? '',
      emergencyContactName: p.emergencyContactName ?? '',
      emergencyContactRelation: p.emergencyContactRelation ?? '',
      emergencyContactPhone: p.emergencyContactPhone ?? '',
    },
  });
  const { register, formState: { errors, isSubmitting } } = form;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.patch(`/patients/${p.id}`, v);
      toast.success('Patient updated');
      qc.invalidateQueries({ queryKey: ['patient', p.id] });
      qc.invalidateQueries({ queryKey: ['emr', p.id] });
      onClose();
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <Drawer open={open} onClose={onClose} title="Edit demographics" description={`${p.mrn} · changes are audited`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={isSubmitting}>Save changes</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <Field label="First name" required error={errors.firstName}><Input {...register('firstName')} /></Field>
        <Field label="Last name" required error={errors.lastName}><Input {...register('lastName')} /></Field>
        <Field label="Father / husband" error={errors.guardianName}><Input {...register('guardianName')} /></Field>
        <Field label="CNIC / ID" error={errors.cnic}><Input {...register('cnic')} /></Field>
        <Field label="Date of birth" error={errors.dateOfBirth}><Input type="date" {...register('dateOfBirth')} /></Field>
        <Field label="Gender" error={errors.gender}><Select {...register('gender')}>{GENDERS.map((g) => <option key={g}>{g}</option>)}</Select></Field>
        <Field label="Blood group" error={errors.bloodGroup}><Select {...register('bloodGroup')}>{BLOOD_GROUPS.map((g) => <option key={g}>{g}</option>)}</Select></Field>
        <Field label="Phone" required error={errors.phone}><Input {...register('phone')} /></Field>
        <Field label="Email" error={errors.email}><Input {...register('email')} /></Field>
        <Field label="City" error={errors.city}><Input {...register('city')} /></Field>
        <Field label="Address" error={errors.address} className="sm:col-span-2"><Input {...register('address')} /></Field>
        <Field label="Emergency contact" error={errors.emergencyContactName}><Input {...register('emergencyContactName')} /></Field>
        <Field label="Relation" error={errors.emergencyContactRelation}><Input {...register('emergencyContactRelation')} /></Field>
        <Field label="Emergency phone" error={errors.emergencyContactPhone}><Input {...register('emergencyContactPhone')} /></Field>
        {p.isProvisional && (
          <label className="col-span-full flex items-start gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
            <input type="checkbox" className="mt-0.5" {...register('completeRegistration')} />
            <span>Complete registration — the patient's identity and contact details have been verified (clears the provisional flag).</span>
          </label>
        )}
      </form>
    </Drawer>
  );
}

function AdmissionsTab({ patientId }: { patientId: string }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['admissions', 'patient', patientId], queryFn: () => api.get<{ items: AdmissionRow[] }>('/ipd/admissions', { patientId, pageSize: 50 }), enabled: can('ipd.view', 'portal.self') });
  if (!can('ipd.view', 'portal.self')) return <Card><EmptyState icon={<ClipboardList className="h-5 w-5" />} title="Admission history is not available for your role" /></Card>;
  return (
    <Card>
      <DataTable
        loading={isLoading}
        rows={data?.items}
        rowKey={(a) => a._id}
        onRowClick={can('ipd.view') ? (a) => navigate(`/ipd/admissions/${a._id}`) : undefined}
        empty={{ title: 'No admissions' }}
        columns={[
          { key: 'no', header: 'Admission', cell: (a) => <span className="font-mono text-xs">{a.admissionNo}</span> },
          { key: 'in', header: 'Admitted', cell: (a) => formatDateTime(a.admittedAt) },
          { key: 'out', header: 'Discharged', cell: (a) => formatDateTime(a.discharge?.at) },
          { key: 'bed', header: 'Ward / bed', cell: (a) => <span className="text-xs">{a.bedLabel}</span>, hideOnMobile: true },
          { key: 'doc', header: 'Consultant', cell: (a) => a.attendingDoctorName, hideOnMobile: true },
          { key: 'reason', header: 'Reason', cell: (a) => <span className="text-xs text-muted">{a.reason}</span>, hideOnMobile: true },
          { key: 'st', header: '', cell: (a) => <StatusBadge status={a.status} /> },
          {
            key: 'pdf',
            header: '',
            align: 'right',
            cell: (a) => a.status === 'Discharged' && <Button size="sm" variant="ghost" icon={<Printer className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); openPdf(`/ipd/admissions/${a._id}/discharge-summary.pdf`).catch((er) => toast.error(er.message)); }}>Summary</Button>,
          },
        ]}
      />
    </Card>
  );
}

function AddAllergyDialog({ patientId, open, onClose }: { patientId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<z.input<typeof allergySchema>, unknown, z.output<typeof allergySchema>>({ resolver: zodResolver(allergySchema), defaultValues: { severity: 'Moderate' } });
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post(`/patients/${patientId}/allergies`, v);
      toast.success('Allergy recorded');
      qc.invalidateQueries({ queryKey: ['patient', patientId] });
      qc.invalidateQueries({ queryKey: ['emr', patientId] });
      form.reset();
      onClose();
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <Dialog open={open} onClose={onClose} title="Record allergy" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save</Button></>}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label="Allergen" required error={form.formState.errors.allergen}><Input autoFocus {...form.register('allergen')} /></Field>
        <Field label="Reaction" error={form.formState.errors.reaction}><Input {...form.register('reaction')} /></Field>
        <Field label="Severity"><Select {...form.register('severity')}>{ALLERGY_SEVERITIES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
      </form>
    </Dialog>
  );
}

const KIND_STYLE: Record<string, { icon: typeof HeartPulse; tone: string }> = {
  visit: { icon: Stethoscope, tone: 'bg-brand/15 text-brand' },
  vitals: { icon: HeartPulse, tone: 'bg-warn/15 text-warn' },
  assessment: { icon: HeartPulse, tone: 'bg-warn/15 text-warn' },
  note: { icon: FileText, tone: 'bg-info/15 text-info' },
  diagnosis: { icon: ClipboardList, tone: 'bg-violet-500/15 text-violet-500' },
  prescription: { icon: FileText, tone: 'bg-ok/15 text-ok' },
  invoice: { icon: FileText, tone: 'bg-subtle text-muted' },
};

function TimelineTab({ events }: { events: Emr['timeline'] }) {
  if (!events.length) return <Card><EmptyState title="No clinical events yet" /></Card>;
  return (
    <Card className="p-4">
      <ol className="relative ml-3 border-l border-border">
        {events.map((e, i) => {
          const s = KIND_STYLE[e.kind] ?? KIND_STYLE.invoice;
          return (
            <li key={`${e.refId}-${i}`} className="mb-5 ml-6 last:mb-0">
              <span className={cn('absolute -left-3.5 flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-surface', s.tone)}>
                <s.icon className="h-3.5 w-3.5" />
              </span>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <p className="text-sm font-medium">{e.title}</p>
                <p className="text-xs text-muted">{formatDateTime(e.at)}</p>
              </div>
              {e.detail && <p className="mt-0.5 text-sm text-fg/80">{e.detail}</p>}
              <p className="mt-0.5 text-xs text-muted">{[e.by, e.department].filter(Boolean).join(' · ')}</p>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function VisitsTab({ emr }: { emr: Emr }) {
  return (
    <Card>
      <DataTable
        rows={emr.visits}
        rowKey={(v) => v._id}
        empty={{ title: 'No visits yet' }}
        columns={[
          { key: 'no', header: 'Visit', cell: (v) => <span className="font-mono text-xs">{v.visitNo}</span> },
          { key: 'date', header: 'Date', cell: (v) => formatDateTime(v.startedAt) },
          { key: 'type', header: 'Type', cell: (v) => <Badge tone="info">{v.type}</Badge> },
          { key: 'dept', header: 'Department', cell: (v) => v.departmentName, hideOnMobile: true },
          { key: 'doc', header: 'Doctor', cell: (v) => v.doctorName, hideOnMobile: true },
          { key: 'cc', header: 'Chief complaint', cell: (v) => <span className="text-muted">{v.chiefComplaint ?? '—'}</span>, hideOnMobile: true },
          { key: 'fu', header: 'Follow-up', cell: (v) => (v.followUpDate ? formatDate(v.followUpDate) : '—'), hideOnMobile: true },
          { key: 'st', header: 'Status', cell: (v) => <StatusBadge status={v.status} /> },
        ]}
      />
    </Card>
  );
}

function VitalsTab({ vitals }: { vitals: Vitals[] }) {
  const series = [...vitals].reverse().map((v) => ({ at: formatDate(v.recordedAt, { day: '2-digit', month: 'short' }), sys: v.systolicBp, dia: v.diastolicBp, hr: v.heartRate, spo2: v.spo2 }));
  if (!vitals.length) return <Card><EmptyState title="No vitals recorded" /></Card>;
  return (
    <div className="space-y-4">
      {vitals.length > 1 && (
        <Card>
          <CardHeader title="Trend" description="Blood pressure and heart rate across readings" />
          <div className="p-3">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={series} margin={{ left: -20, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
                <XAxis dataKey="at" tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                <YAxis tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                <Tooltip contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="sys" name="Systolic" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
                <Line dataKey="dia" name="Diastolic" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} />
                <Line dataKey="hr" name="Heart rate" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      <Card>
        <VitalsHistoryTable rows={vitals} />
      </Card>
    </div>
  );
}

function NotesTab({ notes, plans }: { notes: ClinicalNote[]; plans: Emr['treatmentPlans'] }) {
  if (!notes.length) return <Card><EmptyState title="No clinical notes" /></Card>;
  return (
    <div className="space-y-3">
      {notes.map((n) => {
        const plan = plans.find((p) => formatDate(p.createdAt) === formatDate(n.createdAt));
        return (
          <Card key={n._id} className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">{humanize(n.type)} note</p>
              <p className="text-xs text-muted">{formatDateTime(n.createdAt)} · {n.authorName}{n.amendedAt ? <> · <Badge tone="warn">Amended {formatDateTime(n.amendedAt)}</Badge></> : ''}</p>
            </div>
            {n.chiefComplaint && <p className="mt-2 text-sm"><span className="font-medium">Chief complaint:</span> {n.chiefComplaint}</p>}
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg/90">{n.content}</p>
            {n.amendmentReason && <p className="mt-1 text-xs text-muted">Reason for amendment: {n.amendmentReason}</p>}
            {!!n.versions?.length && (
              <details className="mt-3 rounded-md border border-border px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium">Earlier versions ({n.versions.length})</summary>
                <ol className="mt-2 space-y-2">
                  {[...n.versions].reverse().map((v, i) => (
                    <li key={i} className="border-l-2 border-border pl-2">
                      <p className="text-muted">Saved {formatDateTime(v.savedAt)} · {v.byName}</p>
                      {v.chiefComplaint && <p><span className="font-medium">Chief complaint:</span> {v.chiefComplaint}</p>}
                      <p className="whitespace-pre-wrap">{v.content}</p>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {plan && <p className="mt-3 rounded-md bg-subtle px-3 py-2 text-sm"><span className="font-medium">Plan:</span> {plan.plan}{plan.followUpDate ? ` · follow-up ${formatDate(plan.followUpDate)}` : ''}</p>}
          </Card>
        );
      })}
    </div>
  );
}

function PrescriptionsTab({ rows }: { rows: Prescription[] }) {
  if (!rows.length) return <Card><EmptyState title="No prescriptions" /></Card>;
  return (
    <div className="space-y-3">
      {rows.map((rx) => (
        <Card key={rx._id}>
          <CardHeader
            title={<span className="font-mono">{rx.prescriptionNo}</span>}
            description={`${formatDateTime(rx.prescribedAt)} · ${rx.doctorName ?? ''}`}
            actions={<><StatusBadge status={rx.status} /><Button size="sm" variant="outline" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => openPdf(`/clinical/prescriptions/${rx._id}/pdf`).catch((e) => toast.error(e.message))}>PDF</Button></>}
          />
          <ul className="divide-y divide-border">
            {rx.items.map((i, n) => (
              <li key={n} className="px-4 py-2.5 text-sm">
                <p className="font-medium">{i.medicineName}</p>
                <p className="text-xs text-muted">{i.dosage} · {i.frequency} · {i.route} · {i.durationDays} days · qty {i.quantity}{i.instructions ? ` · ${i.instructions}` : ''}</p>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

interface Doc {
  _id: string;
  category: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  notes?: string;
  createdAt: string;
}

function DocumentsTab({ patientId, readOnly }: { patientId: string; readOnly?: boolean }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState('Referral letter');
  const [uploading, setUploading] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['docs', patientId], queryFn: () => api.get<Doc[]>(`/patients/${patientId}/documents`) });

  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('category', category);
    setUploading(true);
    try {
      await api.post(`/patients/${patientId}/documents`, fd);
      toast.success('Document uploaded');
      qc.invalidateQueries({ queryKey: ['docs', patientId] });
    } catch (e) {
      handleFormError(e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const download = async (d: Doc) => {
    const res = await fetch(`/api/patients/${patientId}/documents/${d._id}`, { credentials: 'same-origin' });
    if (!res.ok) return toast.error('Download failed');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = d.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      {!readOnly && (
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="sm:w-56">
            {['Referral letter', 'External lab report', 'Imaging report', 'Discharge summary', 'ID document', 'Insurance card', 'Consent form', 'Other'].map((c) => <option key={c}>{c}</option>)}
          </Select>
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} loading={uploading} onClick={() => fileRef.current?.click()}>Upload PDF / image</Button>
          <span className="text-xs text-muted">PDF, PNG or JPEG · max 10 MB</span>
        </div>
      )}
      <DataTable
        loading={isLoading}
        rows={data}
        rowKey={(d) => d._id}
        empty={{ title: 'No documents' }}
        columns={[
          { key: 'name', header: 'File', cell: (d) => <span className="font-medium">{d.fileName}</span> },
          { key: 'cat', header: 'Category', cell: (d) => <Badge>{d.category}</Badge> },
          { key: 'size', header: 'Size', cell: (d) => `${Math.max(1, Math.round(d.sizeBytes / 1024))} KB`, hideOnMobile: true },
          { key: 'date', header: 'Uploaded', cell: (d) => formatDateTime(d.createdAt), hideOnMobile: true },
          { key: 'dl', header: '', align: 'right', cell: (d) => <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} onClick={() => download(d)}>Download</Button> },
        ]}
      />
    </Card>
  );
}

function BillingTab({ patientId, rows, portal }: { patientId: string; rows?: Invoice[]; portal?: boolean }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data } = useQuery({ queryKey: ['invoices', 'patient', patientId], queryFn: () => api.get<{ items: Invoice[] }>('/billing/invoices', { patientId, pageSize: 50 }), enabled: !rows });
  const list = rows ?? data?.items;
  const cur = user?.hospital.currency;
  return (
    <Card>
      <DataTable
        rows={list}
        rowKey={(i) => i._id}
        onRowClick={portal ? undefined : (i) => navigate(`/billing/invoices/${i._id}`)}
        empty={{ title: 'No invoices' }}
        columns={[
          { key: 'no', header: 'Invoice', cell: (i) => <span className="font-mono text-xs">{i.invoiceNo}</span> },
          { key: 'date', header: 'Date', cell: (i) => formatDate(i.issuedAt ?? i.createdAt) },
          { key: 'src', header: 'Department', cell: (i) => i.source, hideOnMobile: true },
          { key: 'total', header: 'Total', align: 'right', cell: (i) => money(i.total, cur) },
          { key: 'bal', header: 'Balance', align: 'right', cell: (i) => <span className={cn(i.balance > 0 && 'font-semibold text-warn')}>{money(i.balance, cur)}</span> },
          { key: 'st', header: 'Status', cell: (i) => <StatusBadge status={i.status} /> },
          { key: 'pdf', header: '', align: 'right', cell: (i) => <Button size="sm" variant="ghost" icon={<Printer className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); openPdf(`/billing/invoices/${i._id}/pdf`).catch((er) => toast.error(er.message)); }}>PDF</Button> },
        ]}
      />
    </Card>
  );
}

function AppointmentsTab({ patientId, rows }: { patientId: string; rows?: Emr['appointments'] }) {
  const { data } = useQuery({
    queryKey: ['appointments', 'patient', patientId],
    queryFn: () => api.get<{ items: Array<{ id: string; appointmentNo: string; date: string; startTime: string; status: string; type: string; doctor: { name?: string }; department: { name?: string } }> }>('/appointments', { patientId, pageSize: 50 }),
    enabled: !rows,
  });
  const catalog = useCatalog();
  const list = rows ?? data?.items.map((a) => ({ id: a.id, appointmentNo: a.appointmentNo, date: a.date, startTime: a.startTime, status: a.status, type: a.type, doctorName: a.doctor.name, departmentName: a.department.name }));
  return (
    <Card>
      <DataTable
        rows={list}
        rowKey={(a) => String(a.id)}
        empty={{ title: 'No appointments' }}
        columns={[
          { key: 'date', header: 'Date', cell: (a) => `${formatDate(a.date)} ${a.startTime}` },
          { key: 'doc', header: 'Doctor', cell: (a) => a.doctorName },
          { key: 'dept', header: 'Department', cell: (a) => a.departmentName, hideOnMobile: true },
          { key: 'type', header: 'Type', cell: (a) => appointmentTypeLabel(a.type, catalog), hideOnMobile: true },
          { key: 'st', header: 'Status', cell: (a) => <StatusBadge status={a.status} /> },
        ]}
      />
    </Card>
  );
}
