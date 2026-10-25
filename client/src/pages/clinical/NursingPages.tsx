import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { AlertTriangle, Clock, HeartPulse, Send } from 'lucide-react';
import type { z } from 'zod';
import { calculateBmi, isOutOfRange, nursingAssessmentSchema, vitalFlags, VITAL_RANGES } from '@hms/shared';
import { api } from '@/lib/api';
import { cn, formatTime, minutesSince } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, Input, PageHeader, PageLoader, Textarea } from '@/components/ui/primitives';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Field, handleFormError } from '@/components/form/Field';
import { PatientBanner, VitalsComparison } from '@/components/clinical';
import type { Allergy, Appointment, Vitals } from '@/types';

export function NursingQueuePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['nursing-queue'], queryFn: () => api.get<Appointment[]>('/clinical/nursing/queue'), refetchInterval: 15_000 });
  const start = useMutation({
    mutationFn: (id: string) => api.post(`/clinical/nursing/appointments/${id}/start`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['nursing-queue'] });
      navigate(`/nursing/assess/${id}`);
    },
    onError: (e) => handleFormError(e),
  });

  return (
    <>
      <PageHeader title="Nursing queue" description="Checked-in patients awaiting pre-consultation assessment, oldest first." />
      <Card>
        {isLoading ? (
          <PageLoader />
        ) : !data?.length ? (
          <EmptyState icon={<HeartPulse className="h-5 w-5" />} title="Queue is clear" description="Patients appear here as soon as reception checks them in." />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((a) => {
              const wait = minutesSince(a.checkedInAt);
              return (
                <li key={a.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                  <span className="num flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-semibold text-brand">{a.tokenNumber}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.patient.name} <span className="ml-1 font-mono text-xs text-muted">{a.patient.mrn}</span></p>
                    <p className="text-xs text-muted">{a.doctor.name} · {a.department.name} · {a.reason ?? 'No reason given'}</p>
                  </div>
                  <span className={cn('flex items-center gap-1 text-xs', wait > 30 ? 'font-semibold text-danger' : wait > 15 ? 'text-warn' : 'text-muted')}>
                    <Clock className="h-3.5 w-3.5" /> {wait} min since {formatTime(a.checkedInAt)}
                  </span>
                  <StatusBadge status={a.status} />
                  {a.status === 'CheckedIn' ? (
                    <Button size="sm" loading={start.isPending && start.variables === a.id} onClick={() => start.mutate(a.id)}>Start assessment</Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => navigate(`/nursing/assess/${a.id}`)}>Continue</Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

interface AssessmentContext {
  appointment: Appointment;
  allergies: Allergy[];
  previousVitals: Vitals[];
  assessment: { _id: string } | null;
}

type FormIn = z.input<typeof nursingAssessmentSchema>;
type FormOut = z.output<typeof nursingAssessmentSchema>;

const VITAL_FIELDS: Array<{ name: keyof FormOut['vitals']; label: string; unit: string; step?: string; range?: keyof typeof VITAL_RANGES }> = [
  { name: 'systolicBp', label: 'Systolic BP', unit: 'mmHg', range: 'systolicBp' },
  { name: 'diastolicBp', label: 'Diastolic BP', unit: 'mmHg', range: 'diastolicBp' },
  { name: 'heartRate', label: 'Heart rate', unit: 'bpm', range: 'heartRate' },
  { name: 'temperatureC', label: 'Temperature', unit: '°C', step: '0.1', range: 'temperatureC' },
  { name: 'spo2', label: 'SpO₂', unit: '%', range: 'spo2' },
  { name: 'respiratoryRate', label: 'Resp. rate', unit: '/min', range: 'respiratoryRate' },
  { name: 'weightKg', label: 'Weight', unit: 'kg', step: '0.1' },
  { name: 'heightCm', label: 'Height', unit: 'cm', step: '0.1' },
  { name: 'painScale', label: 'Pain scale', unit: '0–10', range: 'painScale' },
];

export function NursingAssessmentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['assessment', id], queryFn: () => api.get<AssessmentContext>(`/clinical/nursing/appointments/${id}`) });
  const last = data?.previousVitals[0];
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(nursingAssessmentSchema),
    values: last ? ({ vitals: { heightCm: last.heightCm, weightKg: last.weightKg, painScale: 0 } } as FormIn) : undefined,
    resetOptions: { keepDirtyValues: true },
  });
  const watched = useWatch({ control: form.control, name: 'vitals' }) ?? {};
  const num = (v: unknown) => (v === '' || v === undefined || v === null ? undefined : Number(v));
  const bmi = calculateBmi(num(watched.weightKg), num(watched.heightCm));
  const flags = vitalFlags({
    systolicBp: num(watched.systolicBp),
    diastolicBp: num(watched.diastolicBp),
    heartRate: num(watched.heartRate),
    temperatureC: num(watched.temperatureC),
    spo2: num(watched.spo2),
    respiratoryRate: num(watched.respiratoryRate),
    painScale: num(watched.painScale),
    bmi,
  });

  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post(`/clinical/nursing/appointments/${id}/submit`, v);
      toast.success('Assessment submitted — patient is ready for the doctor');
      qc.invalidateQueries({ queryKey: ['nursing-queue'] });
      navigate('/nursing');
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });

  if (isLoading || !data) return <PageLoader />;
  const a = data.appointment;
  const done = !['CheckedIn', 'NurseAssessment'].includes(a.status);

  return (
    <div className="space-y-4">
      <PatientBanner name={a.patient.name ?? ''} mrn={a.patient.mrn ?? ''} gender={a.patient.gender} phone={a.patient.phone} allergies={data.allergies} right={<><Badge tone="brand">Token {a.tokenNumber}</Badge><StatusBadge status={a.status} /></>} />
      <PageHeader title="Pre-consultation assessment" description={`${a.doctor.name} · ${a.department.name} · reason: ${a.reason ?? '—'}`} />
      {done ? (
        <Card className="p-6 text-sm">This assessment has been submitted. The patient is with the doctor.</Card>
      ) : (
        <form onSubmit={submit} noValidate className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Vital signs" description="Values outside adult reference ranges are highlighted." />
            <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
              {VITAL_FIELDS.map((f) => {
                const value = num(watched[f.name]);
                const out = f.range ? isOutOfRange(f.range, value) : false;
                const err = form.formState.errors.vitals?.[f.name];
                return (
                  <Field key={f.name} label={`${f.label} (${f.unit})`} required={f.name !== 'respiratoryRate'} error={err} hint={f.range && value !== undefined && out ? `Outside ${VITAL_RANGES[f.range].low}–${VITAL_RANGES[f.range].high}` : undefined}>
                    <Input type="number" inputMode="decimal" step={f.step ?? '1'} className={cn('num text-base', out && 'border-danger bg-danger/5 text-danger')} {...form.register(`vitals.${f.name}`, { setValueAs: (v) => (v === '' ? undefined : v) })} />
                  </Field>
                );
              })}
              <div className="rounded-md border border-border bg-subtle/60 p-3">
                <p className="text-xs font-medium text-muted">BMI (auto)</p>
                <p className={cn('num mt-1 text-2xl font-semibold', isOutOfRange('bmi', bmi) && 'text-danger')}>{bmi ?? '—'}</p>
                <p className="text-[11px] text-muted">kg/m² from weight & height</p>
              </div>
            </div>
            {flags.length > 0 && (
              <div className="mx-4 mb-4 flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                <AlertTriangle className="h-4 w-4" /> Abnormal: {flags.join(', ')} — the doctor will be alerted.
              </div>
            )}
            <div className="space-y-4 border-t border-border p-4">
              <Field label="Presenting symptoms" required error={form.formState.errors.symptoms}>
                <Textarea placeholder="e.g. Fever for 3 days with chills, productive cough" {...form.register('symptoms')} />
              </Field>
              <Field label="Additional nursing notes" error={form.formState.errors.notes}>
                <Textarea {...form.register('notes')} />
              </Field>
            </div>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title="Comparison" description="Previous reading on file" />
              <div className="p-4">
                {data.previousVitals.length ? <VitalsComparison current={data.previousVitals[0]} previous={data.previousVitals[1]} /> : <p className="text-sm text-muted">First recorded visit.</p>}
              </div>
            </Card>
            <Button type="submit" size="lg" className="w-full justify-center" icon={<Send className="h-4 w-4" />} loading={form.formState.isSubmitting}>
              Submit — ready for doctor
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
