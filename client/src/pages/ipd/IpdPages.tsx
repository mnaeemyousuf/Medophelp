import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { ArrowLeftRight, BedDouble, Building2, ClipboardCheck, DoorOpen, FileText, HeartPulse, LogOut, Plus, Printer, Search, Sparkles, Wrench, XCircle } from 'lucide-react';
import type { z } from 'zod';
import { DISCHARGE_TYPES, WARD_TYPES, ageFromDob, dischargeSchema, vitalsSchema, wardSchema } from '@hms/shared';
import { api, openPdf, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatDateTime, humanize, money, todayIso } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, Input, PageHeader, PageLoader, Select, Textarea } from '@/components/ui/primitives';
import { DataTable, KeyValue, Pagination, StatCard, Tabs } from '@/components/ui/data';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog, Dialog, Drawer } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';
import { AllergyStrip, VitalsComparison, VitalsHistoryTable } from '@/components/clinical';
import { BedPicker } from '@/components/BedPicker';
import { LabCard, PrescriptionCard } from '@/pages/clinical/DoctorPages';
import type { AdmissionDetail, AdmissionRow, BedBoard, BoardBed, Doctor, Patient } from '@/types';

const BED_STYLE: Record<BoardBed['status'], string> = {
  Available: 'border-ok/40 bg-ok/[0.07] hover:border-ok',
  Occupied: 'border-violet-500/40 bg-violet-500/[0.07] hover:border-violet-500',
  Reserved: 'border-info/40 bg-info/[0.07] hover:border-info',
  Cleaning: 'border-warn/40 bg-warn/[0.08] hover:border-warn',
  Maintenance: 'border-border bg-subtle hover:border-muted',
};

export function IpdPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'beds' | 'inpatients' | 'discharged') ?? 'beds';
  const [page, setPage] = useState(1);
  const [admitBed, setAdmitBed] = useState<{ id: string; label: string } | null | 'any'>(null);
  const [bedMenu, setBedMenu] = useState<(BoardBed & { wardName: string; roomNo: string }) | null>(null);
  const { data: board, isLoading } = useQuery({ queryKey: ['bed-board'], queryFn: () => api.get<BedBoard>('/ipd/beds/board'), refetchInterval: 20_000 });
  const list = useQuery({
    queryKey: ['admissions', tab, page],
    queryFn: () => api.get<Paged<AdmissionRow>>('/ipd/admissions', { status: tab === 'discharged' ? 'Discharged' : 'Admitted', page, pageSize: 25 }),
    enabled: tab !== 'beds',
    placeholderData: keepPreviousData,
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.post(`/ipd/beds/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Bed updated');
      setBedMenu(null);
      qc.invalidateQueries({ queryKey: ['bed-board'] });
    },
    onError: (e) => handleFormError(e),
  });
  const t = board?.totals;

  return (
    <>
      <PageHeader
        title="Admissions & beds"
        description="Real-time bed status by ward. Occupancy changes only through admission, transfer and discharge."
        actions={
          <>
            {can('ipd.config') && <Link to="/ipd/setup"><Button variant="outline" icon={<Building2 className="h-4 w-4" />}>Wards & beds</Button></Link>}
            {can('ipd.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdmitBed('any')}>Admit patient</Button>}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Occupancy" value={t ? `${Math.round((t.occupied / Math.max(1, t.beds)) * 100)}%` : '…'} hint={t ? `${t.occupied} of ${t.beds} beds` : undefined} icon={<BedDouble className="h-4 w-4" />} tone="violet" />
        <StatCard label="Available" value={t?.available ?? '…'} icon={<DoorOpen className="h-4 w-4" />} tone="ok" />
        <StatCard label="Reserved" value={t?.reserved ?? '…'} icon={<ClipboardCheck className="h-4 w-4" />} tone="info" />
        <StatCard label="Being cleaned" value={t?.cleaning ?? '…'} icon={<Sparkles className="h-4 w-4" />} tone="warn" />
        <StatCard label="Maintenance" value={t?.maintenance ?? '…'} icon={<Wrench className="h-4 w-4" />} />
      </div>
      <Card>
        <Tabs className="px-2" value={tab} onChange={(k) => { setParams({ tab: k }); setPage(1); }} tabs={[{ key: 'beds', label: 'Bed board' }, { key: 'inpatients', label: 'Inpatients', count: t?.occupied }, { key: 'discharged', label: 'Discharged' }]} />
        {tab === 'beds' ? (
          isLoading || !board ? (
            <PageLoader />
          ) : (
            <div className="space-y-5 p-4">
              <div className="flex flex-wrap gap-3 text-xs text-muted">
                {(['Available', 'Occupied', 'Reserved', 'Cleaning', 'Maintenance'] as const).map((s) => <span key={s} className="flex items-center gap-1"><span className={cn('h-3 w-3 rounded border', BED_STYLE[s])} />{s}</span>)}
              </div>
              {board.wards.map((w) => (
                <div key={w._id}>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h3 className="text-sm font-semibold">{w.name} <span className="font-normal text-muted">· {w.type}{w.floor ? ` · ${w.floor} floor` : ''}</span></h3>
                    <span className="text-xs text-muted">{money(w.chargePerDay, user?.hospital.currency)}/day</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                    {w.rooms.flatMap((r) =>
                      r.beds.map((b) => (
                        <button
                          key={b._id}
                          onClick={() => (b.occupant ? navigate(`/ipd/admissions/${b.occupant.admissionId}`) : setBedMenu({ ...b, wardName: w.name, roomNo: r.roomNo }))}
                          className={cn('focus-ring min-h-[78px] rounded-md border p-2 text-left text-xs transition-colors', BED_STYLE[b.status])}
                        >
                          <p className="flex items-center justify-between font-semibold">
                            <span>{r.roomNo}/{b.bedNo}</span>
                            <BedDouble className="h-3.5 w-3.5 opacity-60" />
                          </p>
                          {b.occupant ? (
                            <>
                              <p className="mt-1 truncate font-medium">{b.occupant.name}</p>
                              <p className="truncate text-[10px] text-muted">{b.occupant.mrn} · {b.occupant.doctor?.replace('Dr. ', 'Dr ')}</p>
                              <p className="text-[10px] text-muted">since {formatDate(b.occupant.admittedAt, { day: '2-digit', month: 'short' })}</p>
                            </>
                          ) : (
                            <p className="mt-1 text-muted">{b.status}{b.statusNote ? ` — ${b.statusNote}` : ''}</p>
                          )}
                        </button>
                      )),
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            <DataTable
              loading={list.isFetching}
              rows={list.data?.items}
              rowKey={(a) => a._id}
              onRowClick={(a) => navigate(`/ipd/admissions/${a._id}`)}
              empty={{ icon: <BedDouble className="h-5 w-5" />, title: tab === 'inpatients' ? 'No inpatients' : 'No discharges yet' }}
              columns={[
                { key: 'no', header: 'Admission', cell: (a) => <div><p className="font-mono text-xs font-medium">{a.admissionNo}</p><p className="text-[11px] text-muted">{a.source}</p></div> },
                { key: 'pt', header: 'Patient', cell: (a) => <div><p className="font-medium">{a.patient?.name}</p><p className="font-mono text-[11px] text-muted">{a.patient?.mrn}</p></div> },
                { key: 'bed', header: 'Bed', cell: (a) => <span className="text-xs">{a.bedLabel}</span> },
                { key: 'doc', header: 'Consultant', cell: (a) => <span className="text-xs">{a.attendingDoctorName}</span>, hideOnMobile: true },
                { key: 'reason', header: 'Reason', cell: (a) => <span className="line-clamp-1 text-xs text-muted">{a.reason}</span>, hideOnMobile: true },
                { key: 'adm', header: tab === 'discharged' ? 'Discharged' : 'Admitted', cell: (a) => <span className="text-xs">{formatDateTime(tab === 'discharged' ? a.discharge?.at : a.admittedAt)}</span> },
                { key: 'st', header: '', cell: (a) => <StatusBadge status={a.status} /> },
              ]}
            />
            {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
          </>
        )}
      </Card>

      <Dialog open={!!bedMenu} onClose={() => setBedMenu(null)} width="max-w-sm" title={bedMenu ? `${bedMenu.wardName} · ${bedMenu.roomNo}/${bedMenu.bedNo}` : ''} description={bedMenu ? `Status: ${bedMenu.status}` : ''}>
        {bedMenu && (
          <div className="flex flex-col gap-2">
            {can('ipd.manage') && ['Available', 'Reserved'].includes(bedMenu.status) && <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setAdmitBed({ id: bedMenu._id, label: `${bedMenu.wardName} · ${bedMenu.roomNo}/${bedMenu.bedNo}` }); setBedMenu(null); }}>Admit a patient here</Button>}
            {can('ipd.manage') && bedMenu.status === 'Cleaning' && <Button variant="outline" icon={<Sparkles className="h-4 w-4" />} loading={setStatus.isPending} onClick={() => setStatus.mutate({ id: bedMenu._id, status: 'Available' })}>Mark cleaned — available</Button>}
            {can('ipd.manage') && ['Available', 'Cleaning'].includes(bedMenu.status) && <Button variant="outline" icon={<Wrench className="h-4 w-4" />} onClick={() => setStatus.mutate({ id: bedMenu._id, status: 'Maintenance' })}>Take out for maintenance</Button>}
            {can('ipd.manage') && bedMenu.status === 'Maintenance' && <Button variant="outline" onClick={() => setStatus.mutate({ id: bedMenu._id, status: 'Available' })}>Back in service</Button>}
            {can('ipd.manage') && bedMenu.status === 'Available' && <Button variant="outline" onClick={() => setStatus.mutate({ id: bedMenu._id, status: 'Reserved' })}>Reserve</Button>}
            {can('ipd.manage') && bedMenu.status === 'Reserved' && <Button variant="outline" onClick={() => setStatus.mutate({ id: bedMenu._id, status: 'Available' })}>Release reservation</Button>}
          </div>
        )}
      </Dialog>
      <AdmitDrawer open={!!admitBed} presetBed={admitBed && admitBed !== 'any' ? admitBed : undefined} onClose={() => setAdmitBed(null)} />
    </>
  );
}

function AdmitDrawer({ open, presetBed, onClose }: { open: boolean; presetBed?: { id: string; label: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [patient, setPatient] = useState<{ id: string; label: string } | null>(null);
  const [bed, setBed] = useState<{ id: string; label: string } | null>(null);
  const [f, setF] = useState({ attendingDoctorId: '', reason: '', provisionalDiagnosis: '', expectedDischarge: '', source: 'OPD' });
  useEffect(() => {
    if (open) {
      setPatient(null);
      setSearch('');
      setBed(presetBed ?? null);
      setF({ attendingDoctorId: '', reason: '', provisionalDiagnosis: '', expectedDischarge: '', source: 'OPD' });
    }
  }, [open, presetBed]);
  const { data: found } = useQuery({ queryKey: ['admit-search', search], queryFn: () => api.get<Paged<Patient>>('/patients', { search, pageSize: 6 }), enabled: open && !patient && search.trim().length >= 2 });
  const { data: doctors } = useQuery({ queryKey: ['doctors'], queryFn: () => api.get<Doctor[]>('/admin/doctors'), enabled: open });
  const m = useMutation({
    mutationFn: () => api.post<{ _id: string; admissionNo: string }>('/ipd/admissions', { patientId: patient!.id, bedId: bed!.id, attendingDoctorId: f.attendingDoctorId, reason: f.reason, provisionalDiagnosis: f.provisionalDiagnosis || undefined, expectedDischarge: f.expectedDischarge || undefined, source: f.source }),
    onSuccess: (a) => {
      toast.success(`Admitted — ${a.admissionNo}`, { description: bed?.label });
      qc.invalidateQueries({ queryKey: ['bed-board'] });
      qc.invalidateQueries({ queryKey: ['admissions'] });
      onClose();
      navigate(`/ipd/admissions/${a._id}`);
    },
    onError: (e) => handleFormError(e),
  });
  const valid = patient && bed && f.attendingDoctorId && f.reason.trim().length >= 2;
  return (
    <Drawer open={open} onClose={onClose} width="sm:max-w-2xl" title="Admit patient" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>Admit</Button></>}>
      <div className="space-y-4">
        <Field label="Patient" required>
          {patient ? (
            <div className="flex items-center justify-between rounded-md border border-brand/40 bg-brand/5 px-3 py-2 text-sm">{patient.label}<button className="text-xs text-brand" onClick={() => setPatient(null)}>Change</button></div>
          ) : (
            <div>
              <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, MRN, CNIC or phone" className="pl-8" /></div>
              {found?.items.map((p) => (
                <button key={p.id} type="button" onClick={() => setPatient({ id: p.id, label: `${p.fullName} · ${p.mrn}` })} className="flex w-full justify-between px-2 py-1.5 text-left text-sm hover:bg-subtle">{p.fullName}<span className="font-mono text-xs text-muted">{p.mrn}</span></button>
              ))}
            </div>
          )}
        </Field>
        <Field label="Bed" required>{bed && presetBed ? <p className="rounded-md border border-brand/40 bg-brand/5 px-3 py-2 text-sm">{bed.label}</p> : <BedPicker value={bed?.id} onChange={(id, label) => setBed({ id, label })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Attending doctor" required><Select value={f.attendingDoctorId} onChange={(e) => setF({ ...f, attendingDoctorId: e.target.value })}><option value="">Select…</option>{doctors?.map((d) => <option key={d._id} value={d._id}>{d.name} — {d.specialization}</option>)}</Select></Field>
          <Field label="Admitted from"><Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{['OPD', 'Direct', 'Referral'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="Reason for admission" required className="col-span-2"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <Field label="Provisional diagnosis"><Input value={f.provisionalDiagnosis} onChange={(e) => setF({ ...f, provisionalDiagnosis: e.target.value })} /></Field>
          <Field label="Expected discharge"><Input type="date" min={todayIso()} value={f.expectedDischarge} onChange={(e) => setF({ ...f, expectedDischarge: e.target.value })} /></Field>
        </div>
      </div>
    </Drawer>
  );
}

export function AdmissionPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [discharging, setDischarging] = useState(false);
  const [recordingVitals, setRecordingVitals] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const { data: a, isLoading } = useQuery({ queryKey: ['admission', id], queryFn: () => api.get<AdmissionDetail>(`/ipd/admissions/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admission', id] });
    qc.invalidateQueries({ queryKey: ['bed-board'] });
    qc.invalidateQueries({ queryKey: ['admissions'] });
  };
  const addNote = useMutation({ mutationFn: () => api.post(`/ipd/admissions/${id}/notes`, { note }), onSuccess: () => { setNote(''); refresh(); }, onError: (e) => handleFormError(e) });
  const cancel = useMutation({ mutationFn: () => api.post(`/ipd/admissions/${id}/cancel`, { reason: 'Admitted in error' }), onSuccess: () => { toast.success('Admission cancelled; bed released'); setCancelling(false); refresh(); }, onError: (e) => handleFormError(e) });
  if (isLoading || !a) return <PageLoader />;
  const active = a.status === 'Admitted';
  const attending = !!user?.doctorId && user.doctorId === a.attendingDoctorId;
  const clinician = !!user?.doctorId || !!user?.nurseId;
  const stay = a.stays.at(-1);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface shadow-card">
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">{a.patient.name} <span className="text-sm font-normal text-muted">{ageFromDob(a.patient.dateOfBirth)}y · {a.patient.gender}{a.patient.bloodGroup !== 'Unknown' ? ` · ${a.patient.bloodGroup}` : ''}</span></h1>
            <p className="text-xs text-muted">
              <span className="font-mono">{a.admissionNo}</span> · MRN <Link to={`/patients/${a.patient.id}`} className="font-mono text-brand hover:underline">{a.patient.mrn}</Link> · {a.attendingDoctorName} · day {a.lengthOfStayDays}
              {a.emergencyCaseId && <> · <Link to={`/emergency/${a.emergencyCaseId}`} className="text-brand hover:underline">from Emergency</Link></>}
            </p>
            {stay && <p className="mt-1 text-sm"><BedDouble className="mr-1 inline h-4 w-4 text-muted" />{stay.wardName} · room {stay.roomNo} · bed {stay.bedNo}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} />
            {active && can('ipd.manage') && <Button variant="outline" icon={<ArrowLeftRight className="h-4 w-4" />} onClick={() => setTransferring(true)}>Transfer</Button>}
            {active && (user?.nurseId || user?.doctorId) && can('vitals.record', 'clinical.consult') && <Button variant="outline" icon={<HeartPulse className="h-4 w-4" />} onClick={() => setRecordingVitals(true)}>Record vitals</Button>}
            {active && can('ipd.discharge') && attending && <Button icon={<LogOut className="h-4 w-4" />} onClick={() => setDischarging(true)}>Discharge</Button>}
            {a.status === 'Discharged' && <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => openPdf(`/ipd/admissions/${a._id}/discharge-summary.pdf`).catch((e) => toast.error(e.message))}>Discharge summary</Button>}
            {a.invoiceId && can('billing.view') && <Link to={`/billing/invoices/${a.invoiceId}`}><Button variant="ghost" icon={<FileText className="h-4 w-4" />}>Bill</Button></Link>}
            {active && can('ipd.manage') && Date.now() - new Date(a.admittedAt).getTime() < 24 * 3_600_000 && <Button variant="ghost" className="text-danger" icon={<XCircle className="h-4 w-4" />} onClick={() => setCancelling(true)}>Cancel</Button>}
          </div>
        </div>
        <AllergyStrip allergies={a.patient.allergies} />
      </div>

      {a.discharge && (
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">Discharged {formatDateTime(a.discharge.at)} — {humanize(a.discharge.type)} · {a.discharge.byName}</p>
          <KeyValue items={[['Final diagnosis', a.discharge.finalDiagnosis], ['Condition', a.discharge.conditionAtDischarge], ['Treatment', a.discharge.treatmentGiven], ['Follow-up', formatDate(a.discharge.followUpDate)]]} />
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {a.vitals.length > 0 && (
            <Card>
              <CardHeader title="Vital signs" description={`${a.vitals.length} reading(s) this admission`} />
              <div className="p-4"><VitalsComparison current={a.vitals[0]} previous={a.vitals[1]} /></div>
              <VitalsHistoryTable rows={a.vitals.slice(0, 10)} />
            </Card>
          )}
          {(attending && active) || a.prescriptions.length ? <PrescriptionCard visitId={a.visitId} rows={a.prescriptions} editable={attending && active} onCreated={refresh} /> : null}
          {(attending && active) || a.labOrders.length ? <LabCard visitId={a.visitId} orders={a.labOrders} editable={attending && active} onOrdered={refresh} /> : null}
          <Card>
            <CardHeader title="Ward notes" description="Doctors write progress notes, nurses nursing notes — append-only" />
            {active && clinician && (
              <div className="border-b border-border p-4">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={user?.doctorId ? 'Ward round: findings, plan…' : 'Observations, care given…'} />
                <Button className="mt-2" size="sm" disabled={note.trim().length < 2} loading={addNote.isPending} onClick={() => addNote.mutate()}>Add {user?.doctorId ? 'progress' : 'nursing'} note</Button>
              </div>
            )}
            <ul className="divide-y divide-border">
              {[...a.notes].reverse().map((n) => (
                <li key={n._id} className="px-4 py-2.5 text-sm">
                  <div className="mb-0.5 flex items-center gap-2 text-xs text-muted">
                    <Badge tone={n.kind === 'Progress' ? 'info' : n.kind === 'Nursing' ? 'brand' : 'neutral'}>{n.kind}</Badge>
                    {formatDateTime(n.at)} · {n.authorName}
                  </div>
                  <p className="whitespace-pre-wrap">{n.text}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Admission" />
            <div className="p-4">
              <KeyValue
                cols={1}
                items={[
                  ['Reason', a.reason],
                  ['Provisional diagnosis', a.provisionalDiagnosis],
                  ['Admitted', formatDateTime(a.admittedAt)],
                  ['Expected discharge', formatDate(a.expectedDischargeAt)],
                  ['Assigned nurse', a.assignedNurseName],
                  ...(a.estimatedCharges !== undefined ? ([['Bed charges so far', money(a.estimatedCharges, user?.hospital.currency)]] as Array<[string, string]>) : []),
                ]}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Bed history" />
            <ol className="space-y-2 p-4 text-xs">
              {a.stays.map((s, i) => (
                <li key={i}>
                  <p className="font-medium">{s.wardName} · {s.roomNo}/{s.bedNo} <span className="font-normal text-muted">({money(s.ratePerDay, user?.hospital.currency)}/day)</span></p>
                  <p className="text-muted">{formatDateTime(s.from)} → {s.to ? formatDateTime(s.to) : 'now'}{s.reason ? ` · ${s.reason}` : ''}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <TransferDialog open={transferring} admission={a} onClose={() => setTransferring(false)} onDone={refresh} />
      <DischargeDialog open={discharging} admission={a} onClose={() => setDischarging(false)} onDone={refresh} />
      <VitalsDialog open={recordingVitals} patientId={a.patient.id} visitId={a.visitId} onClose={() => setRecordingVitals(false)} onDone={refresh} />
      <ConfirmDialog open={cancelling} onClose={() => setCancelling(false)} onConfirm={() => cancel.mutate()} loading={cancel.isPending} danger title="Cancel this admission?" confirmLabel="Cancel admission" message="Use only for admissions recorded in error. The bed is released and no charges are raised. Admissions with treatment must be discharged instead." />
    </div>
  );
}

function TransferDialog({ open, admission, onClose, onDone }: { open: boolean; admission: AdmissionDetail; onClose: () => void; onDone: () => void }) {
  const [bed, setBed] = useState<{ id: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) { setBed(null); setReason(''); } }, [open]);
  const m = useMutation({ mutationFn: () => api.post(`/ipd/admissions/${admission._id}/transfer`, { bedId: bed!.id, reason }), onSuccess: () => { toast.success('Transferred', { description: bed?.label }); onClose(); onDone(); }, onError: (e) => handleFormError(e) });
  return (
    <Dialog open={open} onClose={onClose} width="max-w-2xl" title="Transfer to another bed" description="The current bed goes to cleaning; charges follow the new ward's rate from now." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!bed || reason.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>Transfer</Button></>}>
      <div className="space-y-3">
        <BedPicker value={bed?.id} onChange={(id, label) => setBed({ id, label })} />
        <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Step-down from ICU" /></Field>
      </div>
    </Dialog>
  );
}

type DIn = z.input<typeof dischargeSchema>;
type DOut = z.output<typeof dischargeSchema>;

function DischargeDialog({ open, admission, onClose, onDone }: { open: boolean; admission: AdmissionDetail; onClose: () => void; onDone: () => void }) {
  const { user } = useAuth();
  const form = useForm<DIn, unknown, DOut>({ resolver: zodResolver(dischargeSchema), values: { type: 'Routine', finalDiagnosis: admission.provisionalDiagnosis ?? '', treatmentGiven: '', conditionAtDischarge: 'Stable', medications: admission.prescriptions.flatMap((p) => p.items.map((i) => `${i.medicineName} ${i.dosage} ${i.frequency} × ${i.durationDays}d`)).join('\n') } });
  const { register, formState: { errors, isSubmitting } } = form;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post(`/ipd/admissions/${admission._id}/discharge`, v);
      toast.success('Patient discharged', { description: 'Bed charges billed; bed sent for cleaning.', action: { label: 'Summary PDF', onClick: () => void openPdf(`/ipd/admissions/${admission._id}/discharge-summary.pdf`) } });
      onClose();
      onDone();
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <Dialog open={open} onClose={onClose} width="max-w-2xl" title="Discharge & summary" description={`Estimated bed charges: ${money(admission.estimatedCharges, user?.hospital.currency)} (${admission.lengthOfStayDays} day(s))`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={isSubmitting}>Discharge patient</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3" noValidate>
        <Field label="Discharge type"><Select {...register('type')}>{DISCHARGE_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></Field>
        <Field label="Follow-up date"><Input type="date" min={todayIso()} {...register('followUpDate', { setValueAs: (v) => v || undefined })} /></Field>
        <Field label="Final diagnosis" required error={errors.finalDiagnosis} className="col-span-2"><Input {...register('finalDiagnosis')} /></Field>
        <Field label="Treatment given" required error={errors.treatmentGiven} className="col-span-2"><Textarea {...register('treatmentGiven')} /></Field>
        <Field label="Condition at discharge" required error={errors.conditionAtDischarge} className="col-span-2"><Input {...register('conditionAtDischarge')} /></Field>
        <Field label="Discharge medications" className="col-span-2"><Textarea {...register('medications')} /></Field>
        <Field label="Instructions to patient" className="col-span-2"><Textarea {...register('instructions')} /></Field>
      </form>
    </Dialog>
  );
}

type VIn = z.input<typeof vitalsSchema>;
type VOut = z.output<typeof vitalsSchema>;

function VitalsDialog({ open, patientId, visitId, onClose, onDone }: { open: boolean; patientId: string; visitId: string; onClose: () => void; onDone: () => void }) {
  const form = useForm<VIn, unknown, VOut>({ resolver: zodResolver(vitalsSchema), defaultValues: { painScale: 0 } });
  const fields: Array<[keyof VIn, string]> = [['systolicBp', 'Sys BP'], ['diastolicBp', 'Dia BP'], ['heartRate', 'HR'], ['temperatureC', 'Temp °C'], ['spo2', 'SpO₂'], ['respiratoryRate', 'RR'], ['weightKg', 'Weight kg'], ['heightCm', 'Height cm'], ['painScale', 'Pain']];
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post(`/clinical/patients/${patientId}/vitals`, { ...v, visitId });
      toast.success('Vitals recorded');
      form.reset({ painScale: 0 });
      onClose();
      onDone();
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <Dialog open={open} onClose={onClose} title="Record vitals" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-3 gap-3" noValidate>
        {fields.map(([k, label]) => <Field key={k} label={label} error={form.formState.errors[k]}><Input type="number" step="any" {...form.register(k, { setValueAs: (x) => (x === '' ? undefined : x) })} /></Field>)}
      </form>
    </Dialog>
  );
}

type WIn = z.input<typeof wardSchema>;
type WOut = z.output<typeof wardSchema>;

export function WardSetupPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editingWard, setEditingWard] = useState<(WOut & { _id?: string }) | null>(null);
  const [roomFor, setRoomFor] = useState<string | null>(null);
  const [bedFor, setBedFor] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const { data: board } = useQuery({ queryKey: ['bed-board'], queryFn: () => api.get<BedBoard>('/ipd/beds/board') });
  const form = useForm<WIn, unknown, WOut>({ resolver: zodResolver(wardSchema), values: editingWard ?? { code: '', name: '', type: 'General', chargePerDay: 0, isActive: true } });
  const saveWard = form.handleSubmit(async (v) => {
    try {
      if (editingWard?._id) await api.put(`/ipd/wards/${editingWard._id}`, v);
      else await api.post('/ipd/wards', v);
      toast.success('Ward saved');
      setEditingWard(null);
      qc.invalidateQueries({ queryKey: ['bed-board'] });
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  const add = useMutation({
    mutationFn: () => (roomFor ? api.post('/ipd/rooms', { wardId: roomFor, roomNo: value }) : api.post('/ipd/beds', { roomId: bedFor, bedNo: value })),
    onSuccess: () => { toast.success(roomFor ? 'Room added' : 'Bed added'); setRoomFor(null); setBedFor(null); setValue(''); qc.invalidateQueries({ queryKey: ['bed-board'] }); },
    onError: (e) => handleFormError(e),
  });
  return (
    <>
      <PageHeader title="Wards, rooms & beds" description="Daily bed rates drive inpatient billing. Changes are audited." actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditingWard({ code: '', name: '', type: 'General', chargePerDay: 0, isActive: true })}>New ward</Button>} />
      <div className="space-y-4">
        {board?.wards.map((w) => (
          <Card key={w._id}>
            <CardHeader
              title={`${w.name} (${w.code})`}
              description={`${w.type} · ${money(w.chargePerDay, user?.hospital.currency)}/day · ${w.rooms.reduce((s, r) => s + r.beds.length, 0)} beds`}
              actions={<><Button size="sm" variant="ghost" onClick={() => setEditingWard({ _id: w._id, code: w.code, name: w.name, type: w.type as WOut['type'], floor: w.floor, chargePerDay: w.chargePerDay, isActive: true })}>Edit</Button><Button size="sm" variant="outline" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRoomFor(w._id)}>Room</Button></>}
            />
            <div className="flex flex-wrap gap-2 p-4">
              {w.rooms.map((r) => (
                <div key={r._id} className="rounded-md border border-border px-3 py-2 text-xs">
                  <p className="font-semibold">Room {r.roomNo}</p>
                  <p className="text-muted">{r.beds.map((b) => b.bedNo).join(', ') || 'no beds'}</p>
                  <button className="mt-1 text-brand hover:underline" onClick={() => setBedFor(r._id)}>+ bed</button>
                </div>
              ))}
            </div>
          </Card>
        ))}
        {!board?.wards.length && <Card><EmptyState title="No wards configured" /></Card>}
      </div>
      <Dialog open={!!editingWard} onClose={() => setEditingWard(null)} title={editingWard?._id ? 'Edit ward' : 'New ward'} footer={<><Button variant="outline" onClick={() => setEditingWard(null)}>Cancel</Button><Button onClick={saveWard} loading={form.formState.isSubmitting}>Save</Button></>}>
        <form onSubmit={saveWard} className="grid grid-cols-2 gap-3" noValidate>
          <Field label="Code" required error={form.formState.errors.code}><Input {...form.register('code')} /></Field>
          <Field label="Name" required error={form.formState.errors.name}><Input {...form.register('name')} /></Field>
          <Field label="Type"><Select {...form.register('type')}>{WARD_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Floor"><Input {...form.register('floor')} /></Field>
          <Field label="Charge per day" required error={form.formState.errors.chargePerDay}><Input type="number" min={0} {...form.register('chargePerDay')} /></Field>
        </form>
      </Dialog>
      <Dialog open={!!roomFor || !!bedFor} onClose={() => { setRoomFor(null); setBedFor(null); }} width="max-w-sm" title={roomFor ? 'Add room' : 'Add bed'} footer={<Button disabled={!value.trim()} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>}>
        <Field label={roomFor ? 'Room number' : 'Bed number'}><Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} /></Field>
      </Dialog>
    </>
  );
}
