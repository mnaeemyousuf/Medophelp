import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlarmClock, Ban, CheckCircle2, Clock, Pill, SkipForward } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatDateTime, formatTime } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, Input, PageHeader, PageLoader, Textarea } from '@/components/ui/primitives';
import { DataTable, StatCard } from '@/components/ui/data';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';

export interface Dose {
  _id: string;
  scheduleId: string;
  medicineName: string;
  dosage?: string;
  scheduledAt: string;
  status: string;
  recordedAt?: string;
  recordedByName?: string;
  recordedBy?: string;
  note?: string;
}
export interface Schedule {
  _id: string;
  patientId: string;
  prescriptionNo: string;
  doctorName?: string;
  medicineName: string;
  dosage: string;
  route?: string;
  instructions?: string;
  timesPerDay: number;
  durationDays: number;
  times: string[];
  startDate: string;
  endDate: string;
  totalDoses: number;
  chronic: boolean;
  status: string;
  stoppedReason?: string;
  taken: number;
  missed: number;
  skipped: number;
  pending: number;
  adherence: number | null;
  today: Dose[];
  nextDoseAt: string | null;
}

const HOUR = 3_600_000;
const canRecord = (d: Dose) => ['Pending', 'Missed'].includes(d.status) && Date.now() >= Date.parse(d.scheduledAt) - 2 * HOUR && Date.now() <= Date.parse(d.scheduledAt) + 24 * HOUR;
const adherenceTone = (a: number | null) => (a === null ? 'neutral' : a >= 80 ? 'ok' : a >= 60 ? 'warn' : 'danger');

function useRecordDose(onDone: () => void) {
  return useMutation({
    mutationFn: (v: { id: string; status: 'Taken' | 'Skipped'; note?: string }) => api.post<Dose>(`/medications/doses/${v.id}`, { status: v.status, note: v.note }),
    onSuccess: (d) => { toast.success(d.status === 'Taken' ? `${d.medicineName} marked as taken` : `${d.medicineName} skipped`); onDone(); },
    onError: (e) => handleFormError(e),
  });
}

/** Patient portal: today's doses, active medicines with adherence, reminder times. */
export function MyMedicinesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [history, setHistory] = useState<Schedule | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['my-medicines'], queryFn: () => api.get<{ schedules: Schedule[]; adherence: number | null; totals: { taken: number; missed: number; skipped: number } }>('/medications/mine'), refetchInterval: 60_000 });
  const record = useRecordDose(() => qc.invalidateQueries({ queryKey: ['my-medicines'] }));
  if (isLoading || !data) return <PageLoader />;
  const active = data.schedules.filter((s) => s.status === 'Active');
  const today = active.flatMap((s) => s.today).sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const dueNow = today.filter((d) => canRecord(d));
  return (
    <>
      <PageHeader title="My medicines" description="Reminders arrive in the app (and by SMS when enabled) at each dose time. Mark each dose as taken so your doctor can see how treatment is going." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Active medicines" value={active.length} icon={<Pill className="h-4 w-4" />} />
        <StatCard label="Doses today" value={today.length} hint={`${today.filter((d) => d.status === 'Taken').length} taken`} icon={<Clock className="h-4 w-4" />} tone="info" />
        <StatCard label="Waiting for you" value={dueNow.length} icon={<AlarmClock className="h-4 w-4" />} tone={dueNow.length ? 'warn' : 'ok'} />
        <StatCard label="Adherence" value={data.adherence === null ? '—' : `${data.adherence}%`} hint={`${data.totals.missed} missed · ${data.totals.skipped} skipped`} icon={<CheckCircle2 className="h-4 w-4" />} tone={data.adherence !== null && data.adherence < 80 ? 'warn' : 'ok'} />
      </div>
      <Card className="mt-4">
        <CardHeader title="Today" description={formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })} />
        {today.length ? (
          <ul className="divide-y divide-border">
            {today.map((d) => (
              <li key={d._id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3 text-sm', canRecord(d) && d.status === 'Pending' && 'bg-amber-50/60 dark:bg-amber-950/20')}>
                <span className="num w-14 font-semibold">{formatTime(d.scheduledAt)}</span>
                <span className="min-w-0 flex-1"><span className="font-medium">{d.medicineName}</span> <span className="text-muted">· {d.dosage}</span></span>
                <StatusBadge status={d.status} />
                {canRecord(d) && (
                  <span className="flex gap-1">
                    <Button size="sm" icon={<CheckCircle2 className="h-4 w-4" />} loading={record.isPending && record.variables?.id === d._id && record.variables.status === 'Taken'} onClick={() => record.mutate({ id: d._id, status: 'Taken' })}>Taken</Button>
                    <Button size="sm" variant="outline" icon={<SkipForward className="h-4 w-4" />} onClick={() => record.mutate({ id: d._id, status: 'Skipped' })}>Skip</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No doses scheduled today" />
        )}
      </Card>
      <Card className="mt-4">
        <CardHeader title="My medicines" />
        <ScheduleTable rows={data.schedules} onTimes={setEditing} onHistory={setHistory} />
      </Card>
      <TimesDialog schedule={editing} onClose={() => setEditing(null)} onDone={() => qc.invalidateQueries({ queryKey: ['my-medicines'] })} />
      <HistoryDialog schedule={history} onClose={() => setHistory(null)} />
    </>
  );
}

function ScheduleTable({ rows, onTimes, onHistory, onStop }: { rows: Schedule[]; onTimes?: (s: Schedule) => void; onHistory: (s: Schedule) => void; onStop?: (s: Schedule) => void }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(s) => s._id}
      empty={{ icon: <Pill className="h-5 w-5" />, title: 'No medicines on a reminder schedule', description: 'Schedules start when the pharmacy dispenses a prescription.' }}
      columns={[
        { key: 'm', header: 'Medicine', cell: (s) => <div><p className="font-medium">{s.medicineName} {s.chronic && <Badge tone="violet">Long-term</Badge>}</p><p className="text-[11px] text-muted">{s.dosage} · {s.timesPerDay}× daily for {s.durationDays} days{s.instructions ? ` · ${s.instructions}` : ''}</p></div> },
        { key: 't', header: 'Reminder times', cell: (s) => <span className="num text-xs">{s.times.join(', ')}</span> },
        { key: 'p', header: 'Course', cell: (s) => <span className="text-xs">{formatDate(s.startDate)} – {formatDate(s.endDate)}<br /><span className="text-muted">{s.prescriptionNo} · {s.doctorName}</span></span>, hideOnMobile: true },
        { key: 'a', header: 'Adherence', cell: (s) => <div><Badge tone={adherenceTone(s.adherence)}>{s.adherence === null ? '—' : `${s.adherence}%`}</Badge><p className="mt-0.5 text-[11px] text-muted">{s.taken} taken · {s.missed} missed · {s.skipped} skipped</p></div> },
        { key: 's', header: 'Status', cell: (s) => <div><StatusBadge status={s.status} />{s.stoppedReason && <p className="mt-0.5 text-[11px] text-muted">{s.stoppedReason}</p>}{s.status === 'Active' && s.nextDoseAt && <p className="mt-0.5 text-[11px] text-muted">next {formatDateTime(s.nextDoseAt)}</p>}</div> },
        {
          key: 'x',
          header: '',
          cell: (s) => (
            <span className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => onHistory(s)}>Doses</Button>
              {s.status === 'Active' && onTimes && <Button size="sm" variant="ghost" icon={<AlarmClock className="h-4 w-4" />} onClick={() => onTimes(s)}>Times</Button>}
              {s.status === 'Active' && onStop && <Button size="sm" variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => onStop(s)}>Stop</Button>}
            </span>
          ),
        },
      ]}
    />
  );
}

function TimesDialog({ schedule, onClose, onDone }: { schedule: Schedule | null; onClose: () => void; onDone: () => void }) {
  const [times, setTimes] = useState<string[]>([]);
  useEffect(() => { if (schedule) setTimes([...schedule.times]); }, [schedule]);
  const m = useMutation({ mutationFn: () => api.put(`/medications/schedules/${schedule!._id}/times`, { times }), onSuccess: () => { toast.success('Reminder times updated'); onDone(); onClose(); }, onError: (e) => handleFormError(e) });
  return (
    <Dialog open={!!schedule} onClose={onClose} title={`Reminder times · ${schedule?.medicineName ?? ''}`} description="Upcoming doses move to the new times; past doses are not changed." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={times.some((t) => !t) || new Set(times).size !== times.length} loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        {times.map((t, i) => (
          <Field key={i} label={`Dose ${i + 1}`}><Input type="time" value={t} onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))} /></Field>
        ))}
      </div>
    </Dialog>
  );
}

function HistoryDialog({ schedule, onClose, onRecord }: { schedule: Schedule | null; onClose: () => void; onRecord?: (d: Dose) => void }) {
  const { data } = useQuery({ queryKey: ['doses', schedule?._id], queryFn: () => api.get<{ doses: Dose[] }>(`/medications/schedules/${schedule!._id}/doses`), enabled: !!schedule });
  const past = (data?.doses ?? []).filter((d) => Date.parse(d.scheduledAt) <= Date.now() + 2 * HOUR).reverse();
  return (
    <Dialog open={!!schedule} onClose={onClose} width="max-w-2xl" title={`Dose history · ${schedule?.medicineName ?? ''}`} footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      <div className="max-h-[60vh] overflow-y-auto">
        <DataTable
          rows={past}
          rowKey={(d) => d._id}
          empty={{ title: 'No doses due yet' }}
          columns={[
            { key: 'a', header: 'Due', cell: (d) => formatDateTime(d.scheduledAt) },
            { key: 's', header: 'Status', cell: (d) => <StatusBadge status={d.status} /> },
            { key: 'r', header: 'Recorded', cell: (d) => <span className="text-xs text-muted">{d.recordedAt ? `${formatDateTime(d.recordedAt)} · ${d.recordedBy === 'System' ? 'automatic' : d.recordedByName ?? ''}` : '—'}{d.note ? ` — ${d.note}` : ''}</span> },
            ...(onRecord ? [{ key: 'x', header: '', cell: (d: Dose) => canRecord(d) && <Button size="sm" variant="ghost" onClick={() => onRecord(d)}>Record given</Button> }] : []),
          ]}
        />
      </div>
    </Dialog>
  );
}

/** Staff view on the patient profile: schedules, adherence, record administered doses, stop. */
export function PatientMedicationsPanel({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [history, setHistory] = useState<Schedule | null>(null);
  const [stopping, setStopping] = useState<Schedule | null>(null);
  const [reason, setReason] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['patient-medications', patientId], queryFn: () => api.get<Schedule[]>(`/medications/patients/${patientId}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['patient-medications', patientId] });
    qc.invalidateQueries({ queryKey: ['doses'] });
  };
  const record = useRecordDose(refresh);
  const stop = useMutation({ mutationFn: () => api.post(`/medications/schedules/${stopping!._id}/stop`, { reason }), onSuccess: () => { toast.success('Medicine stopped; the patient has been notified'); setStopping(null); setReason(''); refresh(); }, onError: (e) => handleFormError(e) });
  if (isLoading || !data) return <PageLoader />;
  const totals = data.reduce((m, s) => ({ taken: m.taken + s.taken, missed: m.missed + s.missed, skipped: m.skipped + s.skipped }), { taken: 0, missed: 0, skipped: 0 });
  const due = totals.taken + totals.missed + totals.skipped;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Active schedules" value={data.filter((s) => s.status === 'Active').length} icon={<Pill className="h-4 w-4" />} />
        <StatCard label="Overall adherence" value={due ? `${Math.round((totals.taken / due) * 100)}%` : '—'} tone="ok" />
        <StatCard label="Missed doses" value={totals.missed} tone={totals.missed ? 'danger' : 'ok'} />
        <StatCard label="Skipped doses" value={totals.skipped} tone="warn" />
      </div>
      <Card>
        <CardHeader title="Medication schedules" description="Created automatically when prescriptions are dispensed" />
        <ScheduleTable rows={data} onHistory={setHistory} onStop={can('medication.manage') ? setStopping : undefined} />
      </Card>
      <HistoryDialog schedule={history} onClose={() => setHistory(null)} onRecord={(d) => record.mutate({ id: d._id, status: 'Taken', note: 'Administered by staff' })} />
      <Dialog open={!!stopping} onClose={() => setStopping(null)} title={`Stop ${stopping?.medicineName ?? ''}`} description="Remaining reminders are cancelled and the patient is notified." footer={<><Button variant="outline" onClick={() => setStopping(null)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={stop.isPending} onClick={() => stop.mutate()}>Stop medicine</Button></>}>
        <Field label="Reason" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Adverse reaction, course changed" /></Field>
      </Dialog>
    </div>
  );
}
