import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, List, LogIn, Plus, RotateCcw, Search, UserX, XCircle } from 'lucide-react';
import { APPOINTMENT_STATUSES, appointmentWorkflow, nextStates } from '@hms/shared';
import { api, type Paged } from '@/lib/api';
import { appointmentTypeLabel, useCatalog } from '@/lib/catalog';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, humanize, todayIso } from '@/lib/utils';
import { Button, Card, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui/primitives';
import { DataTable, Pagination } from '@/components/ui/data';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog, Drawer } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';
import type { Appointment, Department, Doctor, Patient } from '@/types';

const shiftDate = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
};

export function AppointmentsPage({ portal }: { portal?: boolean }) {
  const catalog = useCatalog();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'list' | 'day' | 'week'>('list');
  const [date, setDate] = useState(portal ? '' : todayIso());
  const [doctorId, setDoctorId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<{ kind: 'cancel' | 'reschedule'; appt: Appointment } | null>(null);
  const bookOpen = params.get('book') === '1';
  const closeBook = () => {
    params.delete('book');
    params.delete('patientId');
    setParams(params, { replace: true });
  };

  const { data: doctors } = useQuery({ queryKey: ['doctors'], queryFn: () => api.get<Doctor[]>('/admin/doctors'), staleTime: 300_000 });
  const { data, isFetching } = useQuery({
    queryKey: ['appointments', date, doctorId, status, page, view],
    queryFn: () =>
      api.get<Paged<Appointment>>('/appointments', {
        ...(view === 'week' ? { from: weekStart(date || todayIso()), to: shiftDate(weekStart(date || todayIso()), 6) } : date ? { from: date, to: date } : {}),
        doctorId,
        status,
        page: view === 'list' ? page : 1,
        pageSize: view === 'list' ? 25 : 100,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: ({ id, op }: { id: string; op: 'confirm' | 'check-in' | 'no-show' }) => api.post<Appointment>(`/appointments/${id}/${op}`),
    onSuccess: (a, v) => {
      toast.success(v.op === 'check-in' ? `Checked in — token ${a.tokenNumber}` : `Appointment ${humanize(a.status).toLowerCase()}`);
      qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (e) => handleFormError(e),
  });

  const actions = (a: Appointment) => {
    const next = nextStates(appointmentWorkflow, a.status);
    const isToday = a.date === todayIso();
    return (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {!portal && can('appointments.checkin') && next.includes('CheckedIn') && isToday && (
          <Button size="sm" icon={<LogIn className="h-3.5 w-3.5" />} loading={run.isPending && run.variables?.id === a.id} onClick={() => run.mutate({ id: a.id, op: 'check-in' })}>Check in</Button>
        )}
        {!portal && can('appointments.manage') && next.includes('Confirmed') && (
          <Button size="sm" variant="ghost" title="Confirm" onClick={() => run.mutate({ id: a.id, op: 'confirm' })}><CheckCircle2 className="h-4 w-4" /></Button>
        )}
        {!portal && can('appointments.manage') && ['Scheduled', 'Confirmed'].includes(a.status) && (
          <Button size="sm" variant="ghost" title="Reschedule" onClick={() => setAction({ kind: 'reschedule', appt: a })}><RotateCcw className="h-4 w-4" /></Button>
        )}
        {next.includes('Cancelled') && (portal || can('appointments.manage')) && (
          <Button size="sm" variant="ghost" title="Cancel" onClick={() => setAction({ kind: 'cancel', appt: a })}><XCircle className="h-4 w-4 text-danger" /></Button>
        )}
        {!portal && can('appointments.manage') && next.includes('NoShow') && a.date <= todayIso() && (
          <Button size="sm" variant="ghost" title="Mark no-show" onClick={() => run.mutate({ id: a.id, op: 'no-show' })}><UserX className="h-4 w-4" /></Button>
        )}
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title={portal ? 'My appointments' : 'Appointments'}
        description={portal ? 'Book, view or cancel your visits.' : 'Schedule, check in and track patients through the day.'}
        actions={(portal || can('appointments.manage')) && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setParams({ book: '1' })}>Book appointment</Button>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => setDate(shiftDate(date || todayIso(), view === 'week' ? -7 : -1))} aria-label={view === 'week' ? 'Previous week' : 'Previous day'}><ChevronLeft className="h-4 w-4" /></Button>
            <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setPage(1); }} className="w-40" />
            <Button variant="outline" size="icon" onClick={() => setDate(shiftDate(date || todayIso(), view === 'week' ? 7 : 1))} aria-label={view === 'week' ? 'Next week' : 'Next day'}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => setDate(todayIso())}>Today</Button>
            {portal && <Button variant="ghost" size="sm" onClick={() => setDate('')}>All</Button>}
          </div>
          {!portal && (
            <Select value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setPage(1); }} className="w-52">
              <option value="">All doctors</option>
              {doctors?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            </Select>
          )}
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44">
            <option value="">All statuses</option>
            {APPOINTMENT_STATUSES.map((s) => <option key={s} value={s}>{s === 'WaitingForDoctor' ? 'Ready for doctor' : humanize(s)}</option>)}
          </Select>
          {!portal && (
            <div className="ml-auto flex rounded-md border border-border p-0.5">
              <button onClick={() => setView('list')} className={cn('flex items-center gap-1 rounded px-2 py-1 text-xs', view === 'list' ? 'bg-subtle font-medium' : 'text-muted')}><List className="h-3.5 w-3.5" /> List</button>
              <button onClick={() => { setView('day'); if (!date) setDate(todayIso()); }} className={cn('flex items-center gap-1 rounded px-2 py-1 text-xs', view === 'day' ? 'bg-subtle font-medium' : 'text-muted')}><CalendarDays className="h-3.5 w-3.5" /> Day</button>
              <button onClick={() => { setView('week'); if (!date) setDate(todayIso()); }} className={cn('flex items-center gap-1 rounded px-2 py-1 text-xs', view === 'week' ? 'bg-subtle font-medium' : 'text-muted')}><CalendarRange className="h-3.5 w-3.5" /> Week</button>
            </div>
          )}
        </div>
        {view === 'week' && !portal ? (
          <WeekCalendar start={weekStart(date || todayIso())} appointments={data?.items ?? []} total={data?.total ?? 0} showDoctor={!doctorId} onDay={(d) => { setDate(d); setView('day'); }} />
        ) : view === 'day' && !portal ? (
          <DayCalendar appointments={data?.items ?? []} doctors={(doctors ?? []).filter((d) => !doctorId || d._id === doctorId)} renderActions={actions} />
        ) : (
          <>
            <DataTable
              loading={isFetching}
              rows={data?.items}
              rowKey={(a) => a.id}
              empty={{ icon: <CalendarDays className="h-5 w-5" />, title: 'No appointments', description: 'Try another date or clear the filters.' }}
              columns={[
                { key: 'time', header: 'Time', cell: (a) => <div><p className="num font-medium">{a.startTime}</p><p className="text-[11px] text-muted">{formatDate(a.date, { day: '2-digit', month: 'short' })}</p></div> },
                { key: 'tok', header: '#', cell: (a) => (a.tokenNumber ? <span className="num rounded bg-brand/10 px-1.5 py-0.5 text-xs font-semibold text-brand">{a.tokenNumber}</span> : <span className="text-muted">—</span>), hideOnMobile: true },
                ...(portal ? [] : [{ key: 'patient', header: 'Patient', cell: (a: Appointment) => <div><p className="font-medium">{a.patient.name}</p><p className="font-mono text-[11px] text-muted">{a.patient.mrn}</p></div> }]),
                { key: 'doctor', header: 'Doctor', cell: (a) => <div><p>{a.doctor.name}</p><p className="text-[11px] text-muted">{a.department.name}</p></div>, hideOnMobile: !portal },
                { key: 'type', header: 'Type', cell: (a) => appointmentTypeLabel(a.type, catalog), hideOnMobile: true },
                { key: 'reason', header: 'Reason', cell: (a) => <span className="line-clamp-1 text-muted">{a.reason ?? '—'}</span>, hideOnMobile: true },
                { key: 'status', header: 'Status', cell: (a) => <StatusBadge status={a.status} /> },
                { key: 'actions', header: '', align: 'right', cell: actions },
              ]}
            />
            {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
          </>
        )}
      </Card>

      <BookAppointmentDrawer open={bookOpen} onClose={closeBook} portal={portal} initialPatientId={params.get('patientId') ?? undefined} />
      <CancelDialog appt={action?.kind === 'cancel' ? action.appt : null} onClose={() => setAction(null)} />
      <RescheduleDialog appt={action?.kind === 'reschedule' ? action.appt : null} onClose={() => setAction(null)} />
    </>
  );
}

/** Monday of the week containing `iso` (YYYY-MM-DD). */
function weekStart(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  const dow = (d.getDay() + 6) % 7;
  return shiftDate(iso, -dow);
}

function WeekCalendar({ start, appointments, total, showDoctor, onDay }: { start: string; appointments: Appointment[]; total: number; showDoctor: boolean; onDay: (date: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(start, i));
  return (
    <div className="overflow-x-auto">
      {total > appointments.length && <p className="px-4 pt-2 text-xs text-warn">Showing the first {appointments.length} of {total} appointments — filter by doctor to see all.</p>}
      <div className="grid min-w-[900px] grid-cols-7 divide-x divide-border">
        {days.map((d) => {
          const list = appointments.filter((a) => a.date === d).sort((a, b) => a.startTime.localeCompare(b.startTime));
          return (
            <div key={d} className={cn('min-h-[320px]', d === todayIso() && 'bg-brand/[0.03]')}>
              <button type="button" onClick={() => onDay(d)} className="w-full border-b border-border px-2 py-2 text-left hover:bg-subtle">
                <p className={cn('text-xs font-semibold', d === todayIso() && 'text-brand')}>{formatDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                <p className="text-[11px] text-muted">{list.length} appointment{list.length === 1 ? '' : 's'}</p>
              </button>
              <ul className="space-y-1 p-1.5">
                {list.map((a) => (
                  <li key={a.id} className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-1"><span className="num font-semibold">{a.startTime}</span><StatusBadge status={a.status} /></div>
                    <p className="truncate font-medium">{a.patient.name}</p>
                    {showDoctor && <p className="truncate text-[11px] text-muted">{a.doctor.name}</p>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayCalendar({ appointments, doctors, renderActions }: { appointments: Appointment[]; doctors: Doctor[]; renderActions: (a: Appointment) => React.ReactNode }) {
  const byDoctor = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appointments) m.set(a.doctor.id, [...(m.get(a.doctor.id) ?? []), a]);
    return m;
  }, [appointments]);
  const cols = doctors.filter((d) => byDoctor.has(d._id));
  if (!cols.length) return <p className="p-8 text-center text-sm text-muted">No appointments on this day.</p>;
  return (
    <div className="grid gap-3 overflow-x-auto p-3" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(240px, 1fr))` }}>
      {cols.map((d) => (
        <div key={d._id} className="rounded-md border border-border">
          <div className="border-b border-border bg-subtle/60 px-3 py-2">
            <p className="text-sm font-semibold">{d.name}</p>
            <p className="text-[11px] text-muted">{d.specialization} · {byDoctor.get(d._id)!.length} booked</p>
          </div>
          <ul className="divide-y divide-border">
            {byDoctor.get(d._id)!.sort((a, b) => a.startTime.localeCompare(b.startTime)).map((a) => (
              <li key={a.id} className={cn('px-3 py-2', ['Cancelled', 'NoShow'].includes(a.status) && 'opacity-50')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="num text-xs font-semibold">{a.startTime}–{a.endTime}</span>
                  <StatusBadge status={a.status} />
                </div>
                <p className="mt-1 truncate text-sm font-medium">{a.patient.name}</p>
                <p className="font-mono text-[11px] text-muted">{a.patient.mrn}</p>
                <div className="mt-1">{renderActions(a)}</div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function BookAppointmentDrawer({ open, onClose, portal, initialPatientId }: { open: boolean; onClose: () => void; portal?: boolean; initialPatientId?: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [patient, setPatient] = useState<{ id: string; label: string } | null>(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState('');
  const catalog = useCatalog();
  const activeTypes = catalog.appointmentTypes.filter((t) => t.isActive);
  const [chosenType, setType] = useState('New');
  const type = activeTypes.some((t) => t.code === chosenType) ? chosenType : activeTypes[0]?.code;
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setTime('');
    setErrors({});
    if (portal && user?.patientId) setPatient({ id: user.patientId, label: user.fullName });
    else if (initialPatientId) api.get<Patient>(`/patients/${initialPatientId}`).then((p) => setPatient({ id: p.id, label: `${p.fullName} · ${p.mrn}` })).catch(() => undefined);
  }, [open, portal, user, initialPatientId]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: depts } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/admin/departments'), enabled: open, staleTime: 300_000 });
  const { data: doctors } = useQuery({ queryKey: ['doctors', departmentId], queryFn: () => api.get<Doctor[]>('/admin/doctors', { departmentId, availableOnly: true }), enabled: open });
  const { data: results, isFetching: searching } = useQuery({
    queryKey: ['patient-picker', debounced],
    queryFn: () => api.get<Paged<Patient>>('/patients', { search: debounced, pageSize: 6 }),
    enabled: open && !portal && debounced.length >= 2 && !patient,
  });
  const { data: slots, isFetching: loadingSlots } = useQuery({
    queryKey: ['availability', doctorId, date],
    queryFn: () => api.get<{ slots: Array<{ time: string; available: boolean }>; slotMinutes: number }>('/appointments/availability', { doctorId, date }),
    enabled: open && !!doctorId && !!date,
  });

  const book = useMutation({
    mutationFn: () => api.post<Appointment>('/appointments', { patientId: patient!.id, doctorId, date, startTime: time, type, reason: reason || undefined }),
    onSuccess: (a) => {
      toast.success(`Booked ${a.appointmentNo}`, { description: `${formatDate(a.date)} at ${a.startTime} with ${a.doctor.name}` });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['availability'] });
      onClose();
      setPatient(null);
      setReason('');
    },
    onError: (e) => {
      handleFormError(e);
      qc.invalidateQueries({ queryKey: ['availability'] });
    },
  });

  const submit = () => {
    const errs: Record<string, string> = {};
    if (!patient) errs.patient = 'Select a patient';
    if (!doctorId) errs.doctor = 'Select a doctor';
    if (!time) errs.time = 'Pick a free slot';
    setErrors(errs);
    if (!Object.keys(errs).length) book.mutate();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Book appointment"
      description="Only free slots inside the doctor's duty hours can be booked."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={book.isPending}>Book appointment</Button></>}
    >
      <div className="space-y-4">
        {!portal && (
          <Field label="Patient" required error={errors.patient}>
            {patient ? (
              <div className="flex items-center justify-between rounded-md border border-brand/40 bg-brand/5 px-3 py-2 text-sm">
                <span className="font-medium">{patient.label}</span>
                <button className="text-xs text-brand hover:underline" onClick={() => setPatient(null)}>Change</button>
              </div>
            ) : (
              <div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, MRN, phone or CNIC" className="pl-8" />
                </div>
                {debounced.length >= 2 && (
                  <div className="mt-1 rounded-md border border-border">
                    {searching && <p className="px-3 py-2 text-xs text-muted">Searching…</p>}
                    {results?.items.map((p) => (
                      <button key={p.id} type="button" onClick={() => setPatient({ id: p.id, label: `${p.fullName} · ${p.mrn}` })} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-subtle">
                        <span>{p.fullName}</span>
                        <span className="font-mono text-xs text-muted">{p.mrn}</span>
                      </button>
                    ))}
                    {results && !results.items.length && (
                      <div className="flex items-center justify-between px-3 py-2 text-xs text-muted">
                        No match.
                        <button className="text-brand hover:underline" onClick={() => navigate('/patients/new')}>Register new patient</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department">
            <Select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setDoctorId(''); setTime(''); }}>
              <option value="">All departments</option>
              {depts?.filter((d) => d.isClinical).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Doctor" required error={errors.doctor}>
            <Select value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setTime(''); }}>
              <option value="">Select doctor</option>
              {doctors?.map((d) => <option key={d._id} value={d._id}>{d.name} — {d.specialization}</option>)}
            </Select>
          </Field>
          <Field label="Date" required>
            <Input type="date" min={todayIso()} value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} />
          </Field>
          <Field label="Visit type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {activeTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Time slot" required error={errors.time}>
          <div>
            {!doctorId ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted">Choose a doctor to see free slots</p>
            ) : loadingSlots ? (
              <div className="flex justify-center py-4"><Spinner /></div>
            ) : !slots?.slots.length ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted">The doctor does not work on this day</p>
            ) : (
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                {slots.slots.map((s) => (
                  <button
                    key={s.time}
                    type="button"
                    disabled={!s.available}
                    onClick={() => setTime(s.time)}
                    className={cn(
                      'num rounded-md border px-1 py-1.5 text-xs font-medium transition-colors',
                      time === s.time ? 'border-brand bg-brand text-brand-fg' : s.available ? 'border-border hover:border-brand/60 hover:bg-brand/5' : 'cursor-not-allowed border-border bg-subtle text-muted/50 line-through',
                    )}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>
        <Field label="Reason for visit">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Fever for 3 days" />
        </Field>
      </div>
    </Drawer>
  );
}

function CancelDialog({ appt, onClose }: { appt: Appointment | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.post(`/appointments/${appt!.id}/cancel`, { reason }),
    onSuccess: () => {
      toast.success('Appointment cancelled — slot released');
      qc.invalidateQueries({ queryKey: ['appointments'] });
      setReason('');
      onClose();
    },
    onError: (e) => handleFormError(e),
  });
  return (
    <Dialog
      open={!!appt}
      onClose={onClose}
      title="Cancel appointment"
      description={appt ? `${appt.appointmentNo} · ${appt.patient.name ?? ''} · ${formatDate(appt.date)} ${appt.startTime}` : ''}
      footer={<><Button variant="outline" onClick={onClose}>Keep appointment</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>Cancel appointment</Button></>}
    >
      <Field label="Reason" required hint="Recorded in the appointment history">
        <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </Field>
    </Dialog>
  );
}

function RescheduleDialog({ appt, onClose }: { appt: Appointment | null; onClose: () => void }) {
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState('');
  const qc = useQueryClient();
  useEffect(() => {
    if (appt) {
      setDate(appt.date >= todayIso() ? appt.date : todayIso());
      setTime('');
    }
  }, [appt]);
  const { data: slots } = useQuery({
    queryKey: ['availability', appt?.doctor.id, date],
    queryFn: () => api.get<{ slots: Array<{ time: string; available: boolean }> }>('/appointments/availability', { doctorId: appt!.doctor.id, date }),
    enabled: !!appt,
  });
  const m = useMutation({
    mutationFn: () => api.post(`/appointments/${appt!.id}/reschedule`, { date, startTime: time }),
    onSuccess: () => {
      toast.success('Appointment rescheduled');
      qc.invalidateQueries({ queryKey: ['appointments'] });
      onClose();
    },
    onError: (e) => handleFormError(e),
  });
  return (
    <Dialog open={!!appt} onClose={onClose} title="Reschedule" description={appt ? `${appt.patient.name ?? ''} with ${appt.doctor.name}` : ''} footer={<><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={!time} loading={m.isPending} onClick={() => m.mutate()}>Move appointment</Button></>}>
      <Field label="New date"><Input type="date" min={todayIso()} value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} /></Field>
      <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {slots?.slots.map((s) => (
          <button key={s.time} disabled={!s.available} onClick={() => setTime(s.time)} className={cn('num rounded-md border px-1 py-1.5 text-xs', time === s.time ? 'border-brand bg-brand text-brand-fg' : s.available ? 'border-border hover:bg-brand/5' : 'cursor-not-allowed bg-subtle text-muted/50 line-through')}>
            {s.time}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
