import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Activity, AlertTriangle, Ambulance, Clock, LogOut, Plus, Search, Siren, Stethoscope, UserPlus, Users } from 'lucide-react';
import { ARRIVAL_MODES, ER_DISPOSITIONS, GENDERS, TRIAGE_LEVELS, TRIAGE_TARGET_MIN, ageFromDob, isOutOfRange } from '@hms/shared';
import { api, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDateTime, formatTime, humanize } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, Input, PageHeader, PageLoader, Select, Textarea } from '@/components/ui/primitives';
import { DataTable, Pagination, StatCard, Tabs } from '@/components/ui/data';
import { Badge, StatusBadge, TRIAGE_LABEL, TriageBadge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';
import { AllergyStrip, VitalsHistoryTable } from '@/components/clinical';
import { BedPicker } from '@/components/BedPicker';
import { LabCard, PrescriptionCard } from '@/pages/clinical/DoctorPages';
import type { Doctor, ErBoardCase, ErCase, Patient, TriageLevel } from '@/types';

interface Board {
  cases: ErBoardCase[];
  today: { arrivals: number; waiting: number; inTreatment: number; admitted: number; discharged: number; avgDoorToDoctorMin: number | null; byTriage: Record<TriageLevel, number> };
}

const fmtWait = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);

export function EmergencyBoardPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'board' | 'history') ?? 'board';
  const [registering, setRegistering] = useState(params.get('register') === '1');
  const [triageFor, setTriageFor] = useState<ErBoardCase | null>(null);
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ['er-board'], queryFn: () => api.get<Board>('/emergency/board'), refetchInterval: 10_000 });
  const history = useQuery({ queryKey: ['er-history', page], queryFn: () => api.get<Paged<ErBoardCase & { disposition?: { type: string } }>>('/emergency/cases', { page, pageSize: 25 }), enabled: tab === 'history', placeholderData: keepPreviousData });
  const take = useMutation({
    mutationFn: (id: string) => api.post(`/emergency/cases/${id}/take`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['er-board'] });
      navigate(`/emergency/${id}`);
    },
    onError: (e) => handleFormError(e),
  });

  // F2 opens quick registration from anywhere on the board.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F2' && can('emergency.manage', 'emergency.treat')) {
        e.preventDefault();
        setRegistering(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [can]);

  const t = data?.today;
  return (
    <>
      <PageHeader
        title="Emergency department"
        description="Live board, sorted by triage priority then arrival. Refreshes every 10 seconds."
        actions={can('emergency.manage', 'emergency.treat') && <Button size="lg" variant="danger" icon={<UserPlus className="h-4 w-4" />} onClick={() => setRegistering(true)}>Quick registration <span className="ml-1 rounded bg-white/20 px-1 text-[10px]">F2</span></Button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Arrivals today" value={t?.arrivals ?? '…'} icon={<Ambulance className="h-4 w-4" />} tone="info" />
        <StatCard label="Waiting for doctor" value={t?.waiting ?? '…'} icon={<Clock className="h-4 w-4" />} tone="warn" />
        <StatCard label="In treatment" value={t?.inTreatment ?? '…'} icon={<Stethoscope className="h-4 w-4" />} />
        <StatCard label="Admitted / discharged" value={t ? `${t.admitted} / ${t.discharged}` : '…'} icon={<Users className="h-4 w-4" />} tone="violet" />
        <StatCard label="Avg door-to-doctor" value={t?.avgDoorToDoctorMin != null ? `${t.avgDoorToDoctorMin} min` : '—'} icon={<Activity className="h-4 w-4" />} tone="ok" />
      </div>
      {!!t?.byTriage.Critical && (
        <div className="mb-4 flex animate-pulse items-center gap-2 rounded-md border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm font-semibold text-red-600">
          <Siren className="h-4 w-4" /> {t.byTriage.Critical} CRITICAL patient{t.byTriage.Critical > 1 ? 's' : ''} in the department
        </div>
      )}
      <Card>
        <Tabs className="px-2" value={tab} onChange={(k) => setParams({ tab: k })} tabs={[{ key: 'board', label: 'Live board', count: data?.cases.length }, { key: 'history', label: 'All cases' }]} />
        {tab === 'board' ? (
          isLoading ? (
            <PageLoader />
          ) : !data?.cases.length ? (
            <EmptyState icon={<Siren className="h-5 w-5" />} title="No patients in the department" />
          ) : (
            <ul className="divide-y divide-border">
              {data.cases.map((c) => (
                <li key={c._id} className={cn('flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center', c.triageLevel === 'Critical' && 'bg-red-600/[0.06]', c.breach && c.triageLevel !== 'Critical' && 'bg-warn/[0.06]')}>
                  <div className="flex w-40 shrink-0 items-center gap-2">
                    <TriageBadge level={c.triageLevel} />
                    {c.breach && <span title={`Over the ${c.triageLevel ? TRIAGE_TARGET_MIN[c.triageLevel] : 10}-minute target`}><AlertTriangle className="h-4 w-4 text-danger" /></span>}
                  </div>
                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => navigate(`/emergency/${c._id}`)}>
                    <p className="font-medium">
                      {c.patient.name}
                      <span className="ml-2 text-xs text-muted">{ageFromDob(c.patient.dateOfBirth)}y {c.patient.gender[0]}</span>
                      {c.patient.isProvisional && <Badge tone="warn" className="ml-2">Provisional</Badge>}
                      {c.patient.allergies.length > 0 && <Badge tone="danger" className="ml-2">Allergy: {c.patient.allergies.join(', ')}</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted">{c.caseNo} · {c.arrivalMode} · {c.presentingComplaint}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className={cn('num flex items-center gap-1', c.breach ? 'font-bold text-danger' : 'text-muted')}><Clock className="h-3.5 w-3.5" />{fmtWait(c.waitingMinutes)}</span>
                    <span className="w-28 truncate text-muted">{c.assignedDoctorName ?? 'Unassigned'}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="flex gap-1">
                    {can('emergency.manage', 'emergency.treat') && c.status !== 'InTreatment' && <Button size="sm" variant="outline" onClick={() => setTriageFor(c)}>{c.triageLevel ? 'Re-triage' : 'Triage'}</Button>}
                    {user?.doctorId && can('emergency.treat') && c.status !== 'InTreatment' && <Button size="sm" loading={take.isPending && take.variables === c._id} onClick={() => take.mutate(c._id)}>Take case</Button>}
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/emergency/${c._id}`)}>Open</Button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            <DataTable
              loading={history.isFetching}
              rows={history.data?.items}
              rowKey={(c) => c._id}
              onRowClick={(c) => navigate(`/emergency/${c._id}`)}
              columns={[
                { key: 'no', header: 'Case', cell: (c) => <div><p className="font-mono text-xs font-medium">{c.caseNo}</p><p className="text-[11px] text-muted">{formatDateTime(c.arrivalAt)}</p></div> },
                { key: 'pt', header: 'Patient', cell: (c) => <div><p className="font-medium">{c.patient?.name}</p><p className="font-mono text-[11px] text-muted">{c.patient?.mrn}</p></div> },
                { key: 'tri', header: 'Triage', cell: (c) => <TriageBadge level={c.triageLevel} /> },
                { key: 'cc', header: 'Complaint', cell: (c) => <span className="line-clamp-1 text-sm text-muted">{c.presentingComplaint}</span>, hideOnMobile: true },
                { key: 'doc', header: 'Doctor', cell: (c) => <span className="text-xs">{c.assignedDoctorName ?? '—'}</span>, hideOnMobile: true },
                { key: 'st', header: 'Outcome', cell: (c) => <StatusBadge status={c.status} /> },
              ]}
            />
            {history.data && <Pagination page={history.data.page} pageSize={history.data.pageSize} total={history.data.total} onPage={setPage} />}
          </>
        )}
      </Card>
      <QuickRegisterDialog open={registering} onClose={() => { setRegistering(false); if (params.get('register')) setParams({}); }} />
      <TriageDialog caseId={triageFor?._id} current={triageFor?.triageLevel} title={triageFor ? `${triageFor.patient.name} · ${triageFor.caseNo}` : ''} onClose={() => setTriageFor(null)} />
    </>
  );
}

function Segmented<T extends string>({ options, value, onChange, labels, tone }: { options: readonly T[]; value?: T; onChange: (v: T) => void; labels?: Record<string, string>; tone?: (v: T) => string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)} className={cn('rounded-md border px-3 py-1.5 text-sm font-medium transition-colors', value === o ? tone?.(o) ?? 'border-brand bg-brand text-brand-fg' : 'border-border hover:bg-subtle')}>
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

const TRIAGE_SELECTED: Record<string, string> = {
  Critical: 'border-red-600 bg-red-600 text-white',
  Urgent: 'border-orange-500 bg-orange-500 text-white',
  SemiUrgent: 'border-amber-400 bg-amber-300 text-amber-950',
  NonUrgent: 'border-emerald-600 bg-emerald-600 text-white',
};

function QuickRegisterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [existing, setExisting] = useState<{ id: string; label: string } | null>(null);
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ name: '', gender: '' as string, age: '', cnic: '', emergencyContactName: '', emergencyContactPhone: '', arrivalMode: 'Walk-in', presentingComplaint: '', triageLevel: '' as string });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  useEffect(() => {
    if (open) {
      setExisting(null);
      setSearch('');
      setF({ name: '', gender: '', age: '', cnic: '', emergencyContactName: '', emergencyContactPhone: '', arrivalMode: 'Walk-in', presentingComplaint: '', triageLevel: '' });
    }
  }, [open]);
  const { data: found } = useQuery({ queryKey: ['er-patient-search', search], queryFn: () => api.get<Paged<Patient>>('/patients', { search, pageSize: 5 }), enabled: open && search.trim().length >= 3 && !existing });
  const m = useMutation({
    mutationFn: () =>
      api.post<{ _id: string; caseNo: string }>('/emergency/cases', {
        ...(existing ? { patientId: existing.id } : { name: f.name || 'Unknown', gender: f.gender || undefined, age: f.age || undefined, cnic: f.cnic, emergencyContactName: f.emergencyContactName, emergencyContactPhone: f.emergencyContactPhone }),
        arrivalMode: f.arrivalMode,
        presentingComplaint: f.presentingComplaint,
        triageLevel: f.triageLevel || undefined,
      }),
    onSuccess: (c) => {
      toast.success(`Registered ${c.caseNo}`);
      qc.invalidateQueries({ queryKey: ['er-board'] });
      onClose();
      if (f.triageLevel === 'Critical') navigate(`/emergency/${c._id}`);
    },
    onError: (e) => handleFormError(e),
  });
  const ready = f.presentingComplaint.trim().length >= 2 && (existing || f.gender);
  return (
    <Dialog open={open} onClose={onClose} width="max-w-2xl" title="Emergency quick registration" description="Only the essentials. Full registration can be completed later — an MRN is issued now." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" size="lg" disabled={!ready} loading={m.isPending} onClick={() => m.mutate()}>Register patient</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (ready) m.mutate(); }}>
        <div>
          {existing ? (
            <div className="flex items-center justify-between rounded-md border border-brand/40 bg-brand/5 px-3 py-2 text-sm">
              <span>Existing patient: <b>{existing.label}</b></span>
              <button type="button" className="text-xs text-brand" onClick={() => setExisting(null)}>Change</button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Known patient? Search MRN, CNIC, phone or name (optional)" className="pl-8" />
              </div>
              {found?.items.map((p) => (
                <button key={p.id} type="button" onClick={() => setExisting({ id: p.id, label: `${p.fullName} · ${p.mrn}` })} className="flex w-full justify-between px-2 py-1.5 text-left text-sm hover:bg-subtle">
                  {p.fullName} <span className="font-mono text-xs text-muted">{p.mrn}</span>
                </button>
              ))}
            </>
          )}
        </div>
        {!existing && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Name" className="col-span-2" hint="Leave blank for an unidentified patient"><Input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Unknown" /></Field>
            <Field label="Age (years)"><Input type="number" min={0} max={120} value={f.age} onChange={(e) => set('age', e.target.value)} /></Field>
            <Field label="CNIC / ID"><Input value={f.cnic} onChange={(e) => set('cnic', e.target.value)} /></Field>
            <Field label="Gender" required className="col-span-2 sm:col-span-4"><Segmented options={GENDERS} value={f.gender as never} onChange={(v) => set('gender', v)} /></Field>
            <Field label="Emergency contact" className="col-span-2"><Input value={f.emergencyContactName} onChange={(e) => set('emergencyContactName', e.target.value)} /></Field>
            <Field label="Contact phone" className="col-span-2"><Input type="tel" value={f.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', e.target.value)} /></Field>
          </div>
        )}
        <Field label="Arrival"><Segmented options={ARRIVAL_MODES} value={f.arrivalMode as never} onChange={(v) => set('arrivalMode', v)} /></Field>
        <Field label="Presenting complaint" required><Textarea className="min-h-[60px]" value={f.presentingComplaint} onChange={(e) => set('presentingComplaint', e.target.value)} placeholder="e.g. Chest pain for 1 hour, sweating" /></Field>
        <Field label="Triage now (optional)" hint="Critical and urgent cases alert the on-duty doctors immediately">
          <Segmented options={TRIAGE_LEVELS} value={f.triageLevel as never} onChange={(v) => set('triageLevel', f.triageLevel === v ? '' : v)} labels={TRIAGE_LABEL} tone={(v) => TRIAGE_SELECTED[v]} />
        </Field>
      </form>
    </Dialog>
  );
}

const VITAL_KEYS = [
  ['systolicBp', 'Sys BP'],
  ['diastolicBp', 'Dia BP'],
  ['heartRate', 'HR'],
  ['spo2', 'SpO₂'],
  ['temperatureC', 'Temp °C'],
  ['respiratoryRate', 'RR'],
  ['painScale', 'Pain'],
] as const;

function TriageDialog({ caseId, current, title, onClose }: { caseId?: string; current?: string; title: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [level, setLevel] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [withVitals, setWithVitals] = useState(true);
  const [v, setV] = useState<Record<string, string>>({});
  useEffect(() => {
    if (caseId) {
      setLevel(current ?? '');
      setNotes('');
      setV({ weightKg: '70', heightCm: '170' });
    }
  }, [caseId, current]);
  const m = useMutation({
    mutationFn: () => {
      const vitals = withVitals && VITAL_KEYS.slice(0, 5).every(([k]) => v[k]) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '').map(([k, x]) => [k, Number(x)])) : undefined;
      return api.post(`/emergency/cases/${caseId}/triage`, { level, notes: notes || undefined, vitals: vitals ? { painScale: 0, ...vitals } : undefined });
    },
    onSuccess: () => {
      toast.success(`Triaged ${TRIAGE_LABEL[level]}`);
      qc.invalidateQueries({ queryKey: ['er-board'] });
      qc.invalidateQueries({ queryKey: ['er-case', caseId] });
      onClose();
    },
    onError: (e) => handleFormError(e),
  });
  return (
    <Dialog open={!!caseId} onClose={onClose} width="max-w-xl" title="Triage" description={title} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!level} loading={m.isPending} onClick={() => m.mutate()}>Save triage</Button></>}>
      <div className="space-y-4">
        <Segmented options={TRIAGE_LEVELS} value={level as never} onChange={setLevel} labels={TRIAGE_LABEL} tone={(x) => TRIAGE_SELECTED[x]} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={withVitals} onChange={(e) => setWithVitals(e.target.checked)} /> Record vital signs</label>
        {withVitals && (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {VITAL_KEYS.map(([k, label]) => {
              const out = k !== 'painScale' && isOutOfRange(k as never, v[k] ? Number(v[k]) : undefined);
              return (
                <Field key={k} label={label}>
                  <Input type="number" inputMode="decimal" value={v[k] ?? ''} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))} className={cn('num px-2', out && 'border-danger bg-danger/5 text-danger')} />
                </Field>
              );
            })}
          </div>
        )}
        <Field label="Notes"><Textarea className="min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

export function EmergencyCasePage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const [triaging, setTriaging] = useState(false);
  const [disposing, setDisposing] = useState(false);
  const [note, setNote] = useState('');
  const { data: c, isLoading } = useQuery({ queryKey: ['er-case', id], queryFn: () => api.get<ErCase>(`/emergency/cases/${id}`), refetchInterval: 15_000 });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['er-case', id] });
    qc.invalidateQueries({ queryKey: ['er-board'] });
  };
  const take = useMutation({ mutationFn: () => api.post(`/emergency/cases/${id}/take`), onSuccess: refresh, onError: (e) => handleFormError(e) });
  const addNote = useMutation({ mutationFn: () => api.post(`/emergency/cases/${id}/notes`, { note }), onSuccess: () => { setNote(''); refresh(); }, onError: (e) => handleFormError(e) });
  if (isLoading || !c) return <PageLoader />;
  const active = ['Registered', 'Triaged', 'InTreatment'].includes(c.status);
  const treating = !!user?.doctorId && c.assignedDoctorId === user.doctorId && c.status === 'InTreatment';

  return (
    <div className="space-y-4">
      <div className={cn('rounded-lg border bg-surface shadow-card', c.triageLevel === 'Critical' ? 'border-red-600/50' : 'border-border')}>
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <TriageBadge level={c.triageLevel} className="self-start px-3 py-1 text-xs" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">
              {c.patient.name} <span className="text-sm font-normal text-muted">{ageFromDob(c.patient.dateOfBirth)}y · {c.patient.gender}{c.patient.bloodGroup !== 'Unknown' ? ` · ${c.patient.bloodGroup}` : ''}</span>
            </h1>
            <p className="text-xs text-muted">
              <span className="font-mono">{c.caseNo}</span> · MRN <Link to={`/patients/${c.patient.id}`} className="font-mono text-brand hover:underline">{c.patient.mrn}</Link> · arrived {formatTime(c.arrivalAt)} by {c.arrivalMode} · {c.treatmentStartedAt ? `seen after ${c.waitingMinutes} min` : `waiting ${fmtWait(c.waitingMinutes)}`}
            </p>
            <p className="mt-1 text-sm"><span className="font-medium">Complaint:</span> {c.presentingComplaint}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={c.status} />
            {active && can('emergency.manage', 'emergency.treat') && c.status !== 'InTreatment' && <Button variant="outline" onClick={() => setTriaging(true)}>{c.triageLevel ? 'Re-triage' : 'Triage'}</Button>}
            {active && user?.doctorId && can('emergency.treat') && !treating && <Button loading={take.isPending} icon={<Stethoscope className="h-4 w-4" />} onClick={() => take.mutate()}>{c.status === 'InTreatment' ? 'Take over' : 'Take case'}</Button>}
            {active && (treating || c.status !== 'InTreatment') && can('emergency.manage', 'emergency.treat') && <Button variant={treating ? 'primary' : 'outline'} icon={<LogOut className="h-4 w-4" />} onClick={() => setDisposing(true)}>{treating ? 'Disposition' : 'Left without being seen'}</Button>}
          </div>
        </div>
        <AllergyStrip allergies={c.patient.allergies} />
        {c.patient.isProvisional && (
          <div className="border-t border-warn/30 bg-warn/10 px-4 py-2 text-xs text-warn">
            Provisional registration. <Link to={`/patients/${c.patient.id}`} className="font-medium underline">Complete the patient's details</Link> when possible.
            {c.patient.emergencyContactName && ` Contact: ${c.patient.emergencyContactName} ${c.patient.emergencyContactPhone ?? ''}`}
          </div>
        )}
      </div>

      {c.disposition && (
        <Card className="p-4 text-sm">
          <p className="font-semibold">Outcome: {humanize(c.disposition.type)}{c.disposition.referredTo ? ` to ${c.disposition.referredTo}` : ''}</p>
          <p className="text-muted">{c.disposition.notes} — {c.disposition.byName}, {formatDateTime(c.disposition.at)}</p>
          {c.disposition.admissionId && <Link to={`/ipd/admissions/${c.disposition.admissionId}`} className="text-brand hover:underline">Open admission →</Link>}
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {c.vitals.length > 0 && (
            <Card>
              <CardHeader title="Vital signs" />
              <VitalsHistoryTable rows={c.vitals} />
            </Card>
          )}
          {(treating || c.prescriptions.length > 0) && <PrescriptionCard visitId={c.visitId} rows={c.prescriptions} editable={treating} onCreated={refresh} />}
          {(treating || c.labOrders.length > 0) && <LabCard visitId={c.visitId} orders={c.labOrders} editable={treating} onOrdered={refresh} />}
          {c.notes.length > 0 && (
            <Card>
              <CardHeader title="Treatment notes" />
              <ul className="divide-y divide-border">
                {c.notes.map((n) => (
                  <li key={n._id} className="px-4 py-2.5 text-sm">
                    <p className="whitespace-pre-wrap">{n.content}</p>
                    <p className="mt-0.5 text-xs text-muted">{n.type} · {n.authorName} · {formatDateTime(n.createdAt)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          {active && can('emergency.manage', 'emergency.treat') && (
            <Card className="p-4">
              <Field label="Add treatment note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Interventions, response, plan…" /></Field>
              <Button className="mt-2" size="sm" disabled={note.trim().length < 2} loading={addNote.isPending} icon={<Plus className="h-3.5 w-3.5" />} onClick={() => addNote.mutate()}>Add note</Button>
            </Card>
          )}
          <Card>
            <CardHeader title="Timeline" />
            <ol className="space-y-3 p-4 text-sm">
              {[...c.events].reverse().map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', e.kind === 'triage' ? 'bg-warn' : e.kind === 'disposition' ? 'bg-ok' : e.kind === 'assigned' ? 'bg-info' : 'bg-brand')} />
                  <span>
                    {e.text}
                    <span className="block text-xs text-muted">{formatTime(e.at)} · {e.byName}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
          {c.patient.medicalHistory.length > 0 && (
            <Card className="p-4 text-sm">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">History</p>
              {c.patient.medicalHistory.map((h) => <p key={h._id}>{h.condition}{h.isChronic ? ' (chronic)' : ''}</p>)}
            </Card>
          )}
        </div>
      </div>
      <TriageDialog caseId={triaging ? c._id : undefined} current={c.triageLevel} title={`${c.patient.name} · ${c.caseNo}`} onClose={() => setTriaging(false)} />
      <DispositionDialog erCase={disposing ? c : null} lwbsOnly={!treating} onClose={() => setDisposing(false)} onDone={refresh} />
    </div>
  );
}

function DispositionDialog({ erCase, lwbsOnly, onClose, onDone }: { erCase: ErCase | null; lwbsOnly: boolean; onClose: () => void; onDone: () => void }) {
  const navigate = useNavigate();
  const [type, setType] = useState<string>('Discharged');
  const [notes, setNotes] = useState('');
  const [referredTo, setReferredTo] = useState('');
  const [bed, setBed] = useState<{ id: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const { data: doctors } = useQuery({ queryKey: ['doctors'], queryFn: () => api.get<Doctor[]>('/admin/doctors'), enabled: !!erCase && type === 'Admitted' });
  useEffect(() => {
    if (erCase) {
      setType(lwbsOnly ? 'LeftWithoutBeingSeen' : 'Discharged');
      setNotes('');
      setReferredTo('');
      setBed(null);
      setReason(erCase.presentingComplaint);
      setDoctorId('');
    }
  }, [erCase, lwbsOnly]);
  const m = useMutation({
    mutationFn: () =>
      api.post<ErCase & { disposition: { admissionId?: string } }>(`/emergency/cases/${erCase!._id}/disposition`, {
        type,
        notes,
        referredTo: type === 'Referred' ? referredTo : undefined,
        admission: type === 'Admitted' ? { bedId: bed?.id, reason, attendingDoctorId: doctorId || undefined } : undefined,
      }),
    onSuccess: (r) => {
      toast.success(type === 'Admitted' ? 'Patient admitted' : `Case closed: ${humanize(type)}`, { description: type === 'Admitted' ? bed?.label : undefined });
      onClose();
      onDone();
      if (r.disposition?.admissionId) navigate(`/ipd/admissions/${r.disposition.admissionId}`);
    },
    onError: (e) => handleFormError(e),
  });
  const valid = notes.trim().length >= 2 && (type !== 'Admitted' || (bed && reason.trim().length >= 2)) && (type !== 'Referred' || referredTo.trim());
  return (
    <Dialog open={!!erCase} onClose={onClose} width="max-w-2xl" title="Disposition" description="Closes the emergency episode. The emergency consultation is billed if a doctor saw the patient." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>{type === 'Admitted' ? 'Admit patient' : 'Close case'}</Button></>}>
      <div className="space-y-4">
        {!lwbsOnly && <Segmented options={ER_DISPOSITIONS} value={type as never} onChange={setType} labels={{ LeftWithoutBeingSeen: 'Left (LWBS)' }} />}
        {type === 'Admitted' && (
          <>
            <Field label="Bed" required>{<BedPicker value={bed?.id} onChange={(id, label) => setBed({ id, label })} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Reason for admission" required><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <Field label="Attending doctor" hint="Defaults to you"><Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}><option value="">Me</option>{doctors?.map((d) => <option key={d._id} value={d._id}>{d.name} — {d.specialization}</option>)}</Select></Field>
            </div>
          </>
        )}
        {type === 'Referred' && <Field label="Referred to" required><Input value={referredTo} onChange={(e) => setReferredTo(e.target.value)} placeholder="Hospital / service" /></Field>}
        <Field label="Disposition note" required><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
