import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { CheckCircle2, ClipboardList, FlaskConical, History, Pill, Plus, Printer, Save, Stethoscope, Trash2, X } from 'lucide-react';
import type { z } from 'zod';
import { DIAGNOSIS_TYPES, MEDICINE_ROUTES, consultationNoteSchema, createPrescriptionSchema, diagnosisSchema } from '@hms/shared';
import { api, ApiError, openPdf } from '@/lib/api';
import { cn, formatDate, formatDateTime, minutesSince, money, todayIso } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, Input, PageHeader, PageLoader, Select, Textarea } from '@/components/ui/primitives';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Tabs } from '@/components/ui/data';
import { ConfirmDialog, Dialog } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';
import { PatientBanner, VitalsComparison } from '@/components/clinical';
import { useAuth } from '@/lib/auth';
import { appointmentTypeLabel, useCatalog } from '@/lib/catalog';
import { LabOrdersList } from '@/pages/laboratory/LabPages';
import type { Appointment, ClinicalNote, Diagnosis, FormularyItem, LabOrder, LabTest, Patient, Prescription, Vitals } from '@/types';

interface Queue {
  waiting: Appointment[];
  inConsultation: Appointment[];
  upcoming: Appointment[];
  completed: Appointment[];
}

export function DoctorQueuePage() {
  const navigate = useNavigate();
  const catalog = useCatalog();
  const [tab, setTab] = useState<'waiting' | 'inConsultation' | 'upcoming' | 'completed'>('waiting');
  const { data, isLoading } = useQuery({ queryKey: ['doctor-queue'], queryFn: () => api.get<Queue>('/clinical/doctor/queue'), refetchInterval: 15_000 });
  const rows = data?.[tab] ?? [];

  return (
    <>
      <PageHeader title="My consultations" description="Today's clinic. Patients move to “Ready” once nursing submits their assessment." />
      <Card>
        <Tabs
          className="px-2"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'waiting', label: 'Ready', count: data?.waiting.length },
            { key: 'inConsultation', label: 'In consultation', count: data?.inConsultation.length },
            { key: 'upcoming', label: 'Not yet ready', count: data?.upcoming.length },
            { key: 'completed', label: 'Completed', count: data?.completed.length },
          ]}
        />
        {isLoading ? (
          <PageLoader />
        ) : !rows.length ? (
          <EmptyState icon={<Stethoscope className="h-5 w-5" />} title="No patients here" />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <span className="num flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">{a.tokenNumber ?? '—'}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{a.patient.name} <span className="ml-1 font-mono text-xs text-muted">{a.patient.mrn}</span></p>
                  <p className="text-xs text-muted">{a.startTime} · {appointmentTypeLabel(a.type, catalog)} · {a.reason ?? '—'}</p>
                </div>
                {tab === 'waiting' && a.checkedInAt && <span className="text-xs text-muted">waiting {minutesSince(a.checkedInAt)} min</span>}
                <StatusBadge status={a.status} />
                {['WaitingForDoctor', 'InConsultation', 'Completed'].includes(a.status) && (
                  <Button size="sm" variant={a.status === 'Completed' ? 'outline' : 'primary'} onClick={() => navigate(`/doctor/consult/${a.id}`)}>
                    {a.status === 'WaitingForDoctor' ? 'See patient' : a.status === 'InConsultation' ? 'Resume' : 'View'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

interface ConsultContext {
  appointment: Appointment;
  visitId: string;
  assessment: { symptoms?: string; notes?: string; nurseName?: string; submittedAt: string; vitalSignId: Vitals } | null;
  notes: ClinicalNote[];
  diagnoses: Diagnosis[];
  treatmentPlan: { plan: string; followUpDate?: string } | null;
  prescriptions: Prescription[];
  labOrders: LabOrder[];
}

/** Order lab tests for this visit and follow their progress and results. */
export function LabCard({ visitId, orders, editable, onOrdered }: { visitId: string; orders: LabOrder[]; editable: boolean; onOrdered: () => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [priority, setPriority] = useState<'Routine' | 'Urgent' | 'STAT'>('Routine');
  const [notes, setNotes] = useState('');
  const [filter, setFilter] = useState('');
  const { data: tests } = useQuery({ queryKey: ['lab-tests'], queryFn: () => api.get<LabTest[]>('/laboratory/tests'), enabled: open });
  const order = useMutation({
    mutationFn: () => api.post<LabOrder>(`/laboratory/visits/${visitId}/orders`, { testIds: selected, priority, clinicalNotes: notes || undefined }),
    onSuccess: (o) => {
      toast.success(`Lab order ${o.orderNo} sent`, { description: 'Charges posted to billing.' });
      setOpen(false);
      setSelected([]);
      setNotes('');
      setPriority('Routine');
      onOrdered();
    },
    onError: (e) => handleFormError(e),
  });
  const shown = (tests ?? []).filter((t) => !filter || `${t.name} ${t.code} ${t.category}`.toLowerCase().includes(filter.toLowerCase()));
  const total = (tests ?? []).filter((t) => selected.includes(t._id)).reduce((s, t) => s + t.price, 0);
  return (
    <Card>
      <CardHeader title="Laboratory" description="Orders for this visit; results appear here once the lab completes them" actions={editable && <Button size="sm" icon={<FlaskConical className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>Order tests</Button>} />
      <LabOrdersList orders={orders} />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        width="max-w-2xl"
        title="Order lab tests"
        footer={<><span className="mr-auto self-center text-sm">{selected.length} test(s) · <b className="num">{money(total, user?.hospital.currency)}</b></span><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!selected.length} loading={order.isPending} onClick={() => order.mutate()}>Send to lab</Button></>}
      >
        <div className="space-y-3">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tests…" />
          <div className="grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {shown.map((t) => (
              <label key={t._id} className={cn('flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm', selected.includes(t._id) ? 'border-brand/50 bg-brand/5' : 'border-border')}>
                <input type="checkbox" className="mt-0.5" checked={selected.includes(t._id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, t._id] : s.filter((x) => x !== t._id)))} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{t.name}</span>
                  <span className="block text-[11px] text-muted">{t.category} · {t.sampleType} · ~{t.turnaroundHours} h · {money(t.price, user?.hospital.currency)}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-[160px_1fr] gap-3">
            <Field label="Priority"><Select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}><option>Routine</option><option>Urgent</option><option>STAT</option></Select></Field>
            <Field label="Clinical notes for the lab"><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></Field>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}

/** Medicine field with formulary suggestions (links the line to stock); free text is still allowed. */
function MedicinePicker({ value, onPick, onType, error }: { value: string; onPick: (m: FormularyItem) => void; onType: (v: string) => void; error?: string }) {
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 200);
    return () => clearTimeout(t);
  }, [value]);
  const { data } = useQuery({ queryKey: ['formulary', debounced], queryFn: () => api.get<FormularyItem[]>('/pharmacy/formulary', { search: debounced }), enabled: open && debounced.length >= 2 });
  return (
    <div className="relative">
      <Input value={value} aria-invalid={!!error || undefined} placeholder="Start typing — e.g. Paracetamol" onChange={(e) => { onType(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && !!data?.length && (
        <div className="absolute left-0 right-0 top-10 z-20 max-h-64 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-xl">
          {data.map((m) => (
            <button key={m._id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(m); setOpen(false); }} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-subtle">
              <span>
                {m.name} {m.isControlled && <Badge tone="danger">Controlled</Badge>}
                {m.genericName && <span className="block text-[11px] text-muted">{m.genericName} · {m.form}</span>}
              </span>
              <span className={cn('whitespace-nowrap text-xs', m.available > 0 ? 'text-ok' : 'text-danger')}>{m.available > 0 ? `${m.available} in pharmacy` : 'Out of stock'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface EmrLite {
  patient: Patient;
  vitals: Vitals[];
  diagnoses: Diagnosis[];
  prescriptions: Prescription[];
  visits: Array<{ _id: string; visitNo: string; startedAt: string; chiefComplaint?: string; doctorName?: string; departmentName?: string }>;
}

export function ConsultationPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const ctxQ = useQuery({ queryKey: ['consult', id], queryFn: () => api.get<ConsultContext>(`/clinical/doctor/appointments/${id}`) });
  const ctx = ctxQ.data;
  const emrQ = useQuery({ queryKey: ['emr', ctx?.appointment.patient.id], queryFn: () => api.get<EmrLite>(`/clinical/emr/${ctx!.appointment.patient.id}`), enabled: !!ctx });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['consult', id] });
    qc.invalidateQueries({ queryKey: ['emr', ctx?.appointment.patient.id] });
  };

  const start = useMutation({
    mutationFn: () => api.post(`/clinical/doctor/appointments/${id}/start`),
    onSuccess: refresh,
    onError: (e) => handleFormError(e),
  });
  const complete = useMutation({
    mutationFn: () => api.post(`/clinical/doctor/appointments/${id}/complete`, { followUpDate: followUp || undefined }),
    onSuccess: () => {
      toast.success('Consultation completed', { description: 'Visit closed and consultation fee sent to billing.' });
      qc.invalidateQueries({ queryKey: ['doctor-queue'] });
      navigate('/doctor');
    },
    onError: (e) => {
      setCompleteOpen(false);
      handleFormError(e);
    },
  });

  if (ctxQ.isLoading || !ctx) return ctxQ.error ? <Card className="p-6 text-sm text-danger">{(ctxQ.error as Error).message}</Card> : <PageLoader />;
  const a = ctx.appointment;
  const emr = emrQ.data;
  const editable = a.status === 'InConsultation';
  const vitals = ctx.assessment?.vitalSignId;
  const previousVitals = emr?.vitals.find((v) => v._id !== vitals?._id);

  return (
    <div className="space-y-4">
      <PatientBanner
        name={a.patient.name ?? ''}
        mrn={a.patient.mrn ?? ''}
        age={emr?.patient.age}
        gender={a.patient.gender}
        bloodGroup={emr?.patient.bloodGroup}
        phone={a.patient.phone}
        allergies={emr?.patient.allergies}
        right={
          <>
            <StatusBadge status={a.status} />
            <Link to={`/patients/${a.patient.id}`}><Button size="sm" variant="outline" icon={<History className="h-4 w-4" />}>Full EMR</Button></Link>
            {a.status === 'WaitingForDoctor' && <Button size="sm" loading={start.isPending} onClick={() => start.mutate()}>Start consultation</Button>}
            {editable && <Button size="sm" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setCompleteOpen(true)}>Complete</Button>}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {!editable && a.status !== 'Completed' && <div className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-sm text-info">Start the consultation to record notes, diagnoses and prescriptions.</div>}
          <NoteCard visitId={ctx.visitId} note={ctx.notes.find((n) => n.type === 'Consultation')} defaultComplaint={ctx.assessment?.symptoms ?? a.reason} editable={editable} onSaved={refresh} />
          <DiagnosesCard visitId={ctx.visitId} rows={ctx.diagnoses} editable={editable} onChanged={refresh} />
          <PrescriptionCard visitId={ctx.visitId} rows={ctx.prescriptions} editable={editable} onCreated={refresh} />
          <PlanCard visitId={ctx.visitId} plan={ctx.treatmentPlan} editable={editable} onSaved={refresh} />
          <LabCard visitId={ctx.visitId} orders={ctx.labOrders} editable={editable} onOrdered={refresh} />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Today's vitals" description={ctx.assessment ? `${ctx.assessment.nurseName ?? 'Nursing'} · ${formatDateTime(ctx.assessment.submittedAt)}` : 'No nursing assessment'} />
            <div className="p-4">
              <VitalsComparison current={vitals} previous={previousVitals} />
              {ctx.assessment?.symptoms && <p className="mt-3 rounded-md bg-subtle px-3 py-2 text-sm"><span className="font-medium">Symptoms:</span> {ctx.assessment.symptoms}</p>}
              {ctx.assessment?.notes && <p className="mt-2 text-xs text-muted">Nurse: {ctx.assessment.notes}</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="History" />
            <div className="space-y-3 p-4 text-sm">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Conditions</p>
                <p>{emr?.patient.medicalHistory.map((h) => h.condition + (h.isChronic ? ' (chronic)' : '')).join(', ') || 'None recorded'}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Previous diagnoses</p>
                {emr?.diagnoses.filter((d) => !ctx.diagnoses.some((x) => x._id === d._id)).slice(0, 5).map((d) => (
                  <p key={d._id}>{d.description} <span className="text-xs text-muted">· {formatDate(d.createdAt)}</span></p>
                )) ?? null}
                {!emr?.diagnoses.length && <p className="text-muted">None</p>}
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Previous prescriptions</p>
                {emr?.prescriptions.filter((r) => r.visitId !== ctx.visitId).slice(0, 4).map((r) => (
                  <p key={r._id} className="text-xs">{formatDate(r.prescribedAt)}: {r.items.map((i) => i.medicineName).join(', ')}</p>
                ))}
                {!emr?.prescriptions.some((r) => r.visitId !== ctx.visitId) && <p className="text-muted">None</p>}
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Recent visits</p>
                {emr?.visits.filter((v) => v._id !== ctx.visitId).slice(0, 4).map((v) => (
                  <p key={v._id} className="text-xs">{formatDate(v.startedAt)} · {v.departmentName} · {v.chiefComplaint ?? '—'}</p>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={completeOpen}
        onClose={() => setCompleteOpen(false)}
        onConfirm={() => complete.mutate()}
        loading={complete.isPending}
        title="Complete consultation?"
        confirmLabel="Complete & close visit"
        message="The visit will be closed, clinical records locked and the consultation fee posted to billing. Prescriptions are already with the pharmacy."
      >
        <Field label="Follow-up date (optional)"><Input type="date" min={todayIso()} value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}

function NoteCard({ visitId, note, defaultComplaint, editable, onSaved }: { visitId: string; note?: ClinicalNote; defaultComplaint?: string; editable: boolean; onSaved: () => void }) {
  const form = useForm<z.infer<typeof consultationNoteSchema>>({
    resolver: zodResolver(consultationNoteSchema),
    values: { chiefComplaint: note?.chiefComplaint ?? defaultComplaint ?? '', clinicalNotes: note?.content ?? '' },
  });
  const save = form.handleSubmit(async (v) => {
    try {
      await api.put(`/clinical/visits/${visitId}/note`, v);
      toast.success(note ? 'Note amended' : 'Note saved');
      form.reset(v);
      onSaved();
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <Card>
      <CardHeader
        title="Consultation note"
        description={note ? `Saved ${formatDateTime(note.updatedAt)}` : 'Not saved yet'}
        actions={editable && <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} disabled={!form.formState.isDirty} loading={form.formState.isSubmitting} onClick={save}>Save note</Button>}
      />
      <form onSubmit={save} className="space-y-3 p-4" noValidate>
        <Field label="Chief complaint" required error={form.formState.errors.chiefComplaint}>
          <Input disabled={!editable} {...form.register('chiefComplaint')} />
        </Field>
        <Field label="History, examination & clinical notes" required error={form.formState.errors.clinicalNotes}>
          <Textarea disabled={!editable} className="min-h-[150px]" {...form.register('clinicalNotes')} />
        </Field>
        {note && editable && form.formState.isDirty && (
          <Field label="Reason for amendment" hint="The previous version is kept and shown in the patient's record">
            <Input placeholder="e.g. Examination findings updated after ECG" {...form.register('amendmentReason')} />
          </Field>
        )}
        {!!note?.versions?.length && <p className="text-xs text-muted">This note has {note.versions.length} earlier version{note.versions.length === 1 ? '' : 's'} (visible in the EMR → Clinical notes).</p>}
      </form>
    </Card>
  );
}

function DiagnosesCard({ visitId, rows, editable, onChanged }: { visitId: string; rows: Diagnosis[]; editable: boolean; onChanged: () => void }) {
  const form = useForm<z.input<typeof diagnosisSchema>, unknown, z.output<typeof diagnosisSchema>>({ resolver: zodResolver(diagnosisSchema), defaultValues: { type: 'Provisional' } });
  const add = form.handleSubmit(async (v) => {
    try {
      await api.post(`/clinical/visits/${visitId}/diagnoses`, v);
      form.reset({ type: v.type, description: '', icdCode: '' });
      onChanged();
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  const remove = useMutation({ mutationFn: (dxId: string) => api.del(`/clinical/visits/${visitId}/diagnoses/${dxId}`), onSuccess: onChanged, onError: (e) => handleFormError(e) });
  return (
    <Card>
      <CardHeader title="Diagnosis" description="At least one is required to complete the visit" />
      <ul className="divide-y divide-border">
        {rows.map((d) => (
          <li key={d._id} className="flex items-center gap-2 px-4 py-2 text-sm">
            <ClipboardList className="h-4 w-4 text-muted" />
            {d.icdCode && <span className="font-mono text-xs text-muted">{d.icdCode}</span>}
            <span className="flex-1 font-medium">{d.description}</span>
            <Badge tone={d.type === 'Final' ? 'ok' : 'warn'}>{d.type}</Badge>
            {editable && <button onClick={() => remove.mutate(d._id)} className="text-muted hover:text-danger" aria-label="Retract diagnosis"><X className="h-4 w-4" /></button>}
          </li>
        ))}
        {!rows.length && <li className="px-4 py-3 text-sm text-muted">No diagnosis yet</li>}
      </ul>
      {editable && (
        <form onSubmit={add} className="grid grid-cols-[100px_1fr_140px_auto] items-end gap-2 border-t border-border p-3" noValidate>
          <Field label="ICD-10" error={form.formState.errors.icdCode}><Input placeholder="I10" {...form.register('icdCode')} /></Field>
          <Field label="Description" error={form.formState.errors.description}><Input placeholder="Essential hypertension" {...form.register('description')} /></Field>
          <Field label="Type"><Select {...form.register('type')}>{DIAGNOSIS_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Button type="submit" variant="outline" icon={<Plus className="h-4 w-4" />} loading={form.formState.isSubmitting}>Add</Button>
        </form>
      )}
    </Card>
  );
}

const FREQUENCIES: Array<[string, number]> = [
  ['Once daily', 1],
  ['Twice daily', 2],
  ['3 times daily', 3],
  ['4 times daily', 4],
  ['At night', 1],
  ['Every 8 hours', 3],
  ['When required', 0],
];

export function PrescriptionCard({ visitId, rows, editable, onCreated }: { visitId: string; rows: Prescription[]; editable: boolean; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader title="Prescriptions" description="Sent electronically to pharmacy on save" actions={editable && <Button size="sm" icon={<Pill className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>New prescription</Button>} />
      {rows.length ? (
        <ul className="divide-y divide-border">
          {rows.map((rx) => (
            <li key={rx._id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-medium">{rx.prescriptionNo}</span>
                <StatusBadge status={rx.status} />
                <Button size="sm" variant="ghost" className="ml-auto" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => openPdf(`/clinical/prescriptions/${rx._id}/pdf`).catch((e) => toast.error(e.message))}>Print</Button>
              </div>
              {rx.items.map((i, n) => (
                <p key={n} className="mt-1 text-sm"><span className="font-medium">{i.medicineName}</span> <span className="text-muted">— {i.dosage}, {i.frequency}, {i.durationDays} days (qty {i.quantity})</span></p>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-muted">No prescription for this visit</p>
      )}
      <PrescriptionBuilder open={open} onClose={() => setOpen(false)} visitId={visitId} onCreated={onCreated} />
    </Card>
  );
}

type RxIn = z.input<typeof createPrescriptionSchema>;
type RxOut = z.output<typeof createPrescriptionSchema>;
const blankItem = { medicineName: '', dosage: '1 tablet', frequency: '3 times daily', timesPerDay: 3, route: 'Oral' as const, durationDays: 5, quantity: 15, instructions: '' };

function PrescriptionBuilder({ open, onClose, visitId, onCreated }: { open: boolean; onClose: () => void; visitId: string; onCreated: () => void }) {
  const form = useForm<RxIn, unknown, RxOut>({ resolver: zodResolver(createPrescriptionSchema), defaultValues: { items: [blankItem] } });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const { register, setValue, getValues, formState: { errors, isSubmitting } } = form;

  /** Quantity follows frequency × duration unless the doctor overrides it. */
  const recalc = (i: number) => {
    const it = getValues(`items.${i}`);
    const perDay = Number(it.timesPerDay) || 0;
    const days = Number(it.durationDays) || 0;
    if (perDay && days) setValue(`items.${i}.quantity`, perDay * days);
  };

  const submit = form.handleSubmit(async (v) => {
    try {
      const rx = await api.post<Prescription>(`/clinical/visits/${visitId}/prescriptions`, v);
      toast.success(`Prescription ${rx.prescriptionNo} sent to pharmacy`);
      form.reset({ items: [blankItem] });
      onCreated();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'allergy_conflict') {
        toast.error(e.message, { description: 'Choose an alternative medicine.' });
        return;
      }
      handleFormError(e, form.setError);
    }
  });

  return (
    <Dialog open={open} onClose={onClose} width="max-w-4xl" title="New prescription" description="Medicines are checked against recorded allergies." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={isSubmitting} icon={<Pill className="h-4 w-4" />}>Sign & send to pharmacy</Button></>}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {items.fields.map((f, i) => (
          <div key={f.id} className={cn('rounded-md border border-border p-3', errors.items?.[i] && 'border-danger/50')}>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-12">
              <Field label="Medicine" required error={errors.items?.[i]?.medicineName} className="col-span-2 md:col-span-4">
                <MedicinePicker
                  value={form.watch(`items.${i}.medicineName`) ?? ''}
                  error={errors.items?.[i]?.medicineName?.message}
                  onType={(v) => {
                    setValue(`items.${i}.medicineName`, v, { shouldValidate: form.formState.isSubmitted });
                    setValue(`items.${i}.medicineId`, undefined);
                  }}
                  onPick={(m) => {
                    setValue(`items.${i}.medicineName`, m.name, { shouldValidate: true });
                    setValue(`items.${i}.medicineId`, m._id);
                    if (m.form === 'Syrup') setValue(`items.${i}.dosage`, '10 ml');
                    else if (m.form === 'Injection') setValue(`items.${i}.route`, 'IV');
                  }}
                />
              </Field>
              <Field label="Dosage" required error={errors.items?.[i]?.dosage} className="md:col-span-2"><Input {...register(`items.${i}.dosage`)} /></Field>
              <Field label="Frequency" required className="md:col-span-3">
                <Select
                  {...register(`items.${i}.frequency`, {
                    onChange: (e) => {
                      const match = FREQUENCIES.find(([l]) => l === e.target.value);
                      if (match) setValue(`items.${i}.timesPerDay`, match[1]);
                      recalc(i);
                    },
                  })}
                >
                  {FREQUENCIES.map(([l]) => <option key={l}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Route" className="md:col-span-3"><Select {...register(`items.${i}.route`)}>{MEDICINE_ROUTES.map((r) => <option key={r}>{r}</option>)}</Select></Field>
              <Field label="Days" required error={errors.items?.[i]?.durationDays} className="md:col-span-2"><Input type="number" min={1} {...register(`items.${i}.durationDays`, { onChange: () => recalc(i) })} /></Field>
              <Field label="Quantity" required error={errors.items?.[i]?.quantity} className="md:col-span-2"><Input type="number" min={1} {...register(`items.${i}.quantity`)} /></Field>
              <Field label="Instructions" className="col-span-2 md:col-span-7"><Input placeholder="After meals" {...register(`items.${i}.instructions`)} /></Field>
              <div className="flex items-end md:col-span-1">
                <Button type="button" variant="ghost" size="icon" disabled={items.fields.length === 1} onClick={() => items.remove(i)} aria-label="Remove medicine"><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
        ))}
        {errors.items?.message && <p className="text-xs text-danger">{errors.items.message}</p>}
        <Button type="button" variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => items.append(blankItem)}>Add medicine</Button>
        <Field label="Notes to pharmacist / patient"><Textarea {...register('notes')} /></Field>
      </form>
    </Dialog>
  );
}

function PlanCard({ visitId, plan, editable, onSaved }: { visitId: string; plan: ConsultContext['treatmentPlan']; editable: boolean; onSaved: () => void }) {
  const [text, setText] = useState(plan?.plan ?? '');
  const [date, setDate] = useState(plan?.followUpDate?.slice(0, 10) ?? '');
  const save = useMutation({
    mutationFn: () => api.put(`/clinical/visits/${visitId}/treatment-plan`, { plan: text, followUpDate: date || undefined }),
    onSuccess: () => {
      toast.success('Treatment plan saved');
      onSaved();
    },
    onError: (e) => handleFormError(e),
  });
  return (
    <Card>
      <CardHeader title="Treatment plan & follow-up" actions={editable && <Button size="sm" variant="outline" disabled={text.trim().length < 2} loading={save.isPending} onClick={() => save.mutate()}>Save plan</Button>} />
      <div className="grid gap-3 p-4 sm:grid-cols-[1fr_180px]">
        <Textarea disabled={!editable} value={text} onChange={(e) => setText(e.target.value)} placeholder="Investigations, advice, lifestyle changes…" />
        <Field label="Follow-up date"><Input type="date" disabled={!editable} min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Card>
  );
}
