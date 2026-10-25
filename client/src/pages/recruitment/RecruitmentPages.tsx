import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Briefcase, CalendarClock, ClipboardCheck, FileText, FileUp, Mail, Plus, Search, Send, UserCheck, UserPlus, UsersRound } from 'lucide-react';
import { CANDIDATE_SOURCES, CANDIDATE_STAGES, EMPLOYMENT_TYPES, GENDERS, INTERVIEW_MODES, JOB_STATUSES, RECOMMENDATIONS, candidateSchema, jobSchema } from '@hms/shared';
import { api, openPdf, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCatalog } from '@/lib/catalog';
import { cn, formatDate, formatDateTime, humanize, money, todayIso } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, Input, PageHeader, PageLoader, Select, Textarea } from '@/components/ui/primitives';
import { DataTable, KeyValue, Pagination, StatCard, Tabs } from '@/components/ui/data';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Dialog, Drawer } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';
import type { Candidate, Interview, JobPosting, LineItem, OfferLetter } from '@/types';
import { useDepartments } from '@/pages/hr/HrPages';
import { LineEditor } from '@/pages/payroll/PayrollPages';

interface Stats {
  openJobs: number;
  pipeline: Record<string, number>;
  interviewsThisWeek: number;
  offersOutstanding: number;
}

type Tab = 'overview' | 'jobs' | 'candidates';

export function RecruitmentPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'overview';
  return (
    <>
      <PageHeader title="Recruitment" description="Job openings, candidate pipeline, interviews and offer letters" />
      <Tabs tabs={[{ key: 'overview', label: 'Overview' }, { key: 'jobs', label: 'Job openings' }, { key: 'candidates', label: 'Candidates' }]} value={tab} onChange={(k) => setParams({ tab: k })} className="mb-4" />
      {tab === 'overview' && <Overview />}
      {tab === 'jobs' && <JobsTab />}
      {tab === 'candidates' && <CandidatesTab jobId={params.get('jobId') ?? ''} />}
    </>
  );
}

function Overview() {
  const navigate = useNavigate();
  const { data: stats } = useQuery({ queryKey: ['recruitment-stats'], queryFn: () => api.get<Stats>('/recruitment/stats') });
  const { data: upcoming } = useQuery({ queryKey: ['interviews-upcoming'], queryFn: () => api.get<Interview[]>('/recruitment/interviews/upcoming') });
  if (!stats) return <PageLoader />;
  const max = Math.max(1, ...CANDIDATE_STAGES.map((s) => stats.pipeline[s] ?? 0));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Open positions" value={stats.openJobs} icon={<Briefcase className="h-4 w-4" />} onClick={() => navigate('/recruitment?tab=jobs')} />
        <StatCard label="In pipeline" value={['Applied', 'Shortlisted', 'Interview', 'Selected', 'Offer'].reduce((s, k) => s + (stats.pipeline[k] ?? 0), 0)} icon={<UsersRound className="h-4 w-4" />} tone="info" onClick={() => navigate('/recruitment?tab=candidates')} />
        <StatCard label="Interviews this week" value={stats.interviewsThisWeek} icon={<CalendarClock className="h-4 w-4" />} tone="violet" />
        <StatCard label="Offers outstanding" value={stats.offersOutstanding} icon={<Mail className="h-4 w-4" />} tone="warn" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Pipeline" />
          <div className="space-y-2 p-4">
            {CANDIDATE_STAGES.map((s) => (
              <button key={s} type="button" onClick={() => navigate(`/recruitment?tab=candidates&stage=${s}`)} className="flex w-full items-center gap-3 text-left text-sm">
                <span className="w-24 text-muted">{s}</span>
                <span className="h-5 flex-1 rounded bg-subtle"><span className="block h-5 rounded bg-brand/70" style={{ width: `${((stats.pipeline[s] ?? 0) / max) * 100}%` }} /></span>
                <span className="num w-8 text-right font-medium">{stats.pipeline[s] ?? 0}</span>
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Upcoming interviews" />
          {upcoming?.length ? (
            <ul className="divide-y divide-border">
              {upcoming.map((iv) => (
                <li key={iv._id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-36 text-xs text-muted">{formatDateTime(iv.scheduledAt)}</span>
                  <Link to={`/recruitment/candidates/${typeof iv.candidateId === 'object' ? (iv.candidateId as { _id: string })._id : iv.candidateId}`} className="flex-1 font-medium hover:underline">{iv.candidateName}</Link>
                  <span className="text-xs text-muted">{iv.jobTitle} · {iv.mode}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No interviews scheduled" />
          )}
        </Card>
      </div>
    </div>
  );
}

function JobsTab() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<JobPosting | 'new' | null>(null);
  const { data, isFetching } = useQuery({ queryKey: ['jobs', status], queryFn: () => api.get<JobPosting[]>('/recruitment/jobs', { status }) });
  return (
    <Card>
      <div className="flex flex-wrap gap-2 border-b border-border p-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="">All statuses</option>{JOB_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
        <div className="flex-1" />
        {can('recruitment.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New opening</Button>}
      </div>
      <DataTable
        loading={isFetching}
        rows={data}
        rowKey={(j) => j._id}
        onRowClick={(j) => navigate(`/recruitment?tab=candidates&jobId=${j._id}`)}
        empty={{ icon: <Briefcase className="h-5 w-5" />, title: 'No job openings' }}
        columns={[
          { key: 't', header: 'Position', cell: (j) => <div><p className="font-medium">{j.title}</p><p className="font-mono text-[11px] text-muted">{j.jobNo} · {j.departmentName}</p></div> },
          { key: 'o', header: 'Openings', cell: (j) => `${j.filled ?? 0} / ${j.openings} filled` },
          { key: 'c', header: 'Candidates', cell: (j) => <span className="text-xs">{j.candidates ?? 0}{Object.entries(j.pipeline ?? {}).length ? ` (${Object.entries(j.pipeline ?? {}).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(', ')})` : ''}</span>, hideOnMobile: true },
          { key: 'd', header: 'Closes', cell: (j) => <span className="text-xs">{j.closingDate ? formatDate(j.closingDate) : '—'}</span>, hideOnMobile: true },
          { key: 's', header: 'Status', cell: (j) => <StatusBadge status={j.status} /> },
          { key: 'e', header: '', cell: (j) => can('recruitment.manage') && <Button size="sm" variant="ghost" onClick={(ev) => { ev.stopPropagation(); setEditing(j); }}>Edit</Button> },
        ]}
      />
      <JobDrawer job={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function JobDrawer({ job, onClose }: { job: JobPosting | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: depts } = useDepartments();
  const j = job && job !== 'new' ? job : undefined;
  const form = useForm<z.input<typeof jobSchema>, unknown, z.output<typeof jobSchema>>({
    resolver: zodResolver(jobSchema),
    values: j
      ? { title: j.title, departmentId: typeof j.departmentId === 'object' ? j.departmentId._id : j.departmentId, employmentType: j.employmentType as never, openings: j.openings, description: j.description, requirements: j.requirements ?? '', salaryMin: j.salaryMin, salaryMax: j.salaryMax, closingDate: j.closingDate?.slice(0, 10), status: j.status as never }
      : { title: '', departmentId: '', employmentType: 'FullTime', openings: 1, description: '', status: 'Open' },
  });
  const { register, formState: { errors, isSubmitting } } = form;
  const num = { setValueAs: (v: string) => (v === '' ? undefined : Number(v)) };
  const submit = form.handleSubmit(async (v) => {
    try {
      if (j) await api.put(`/recruitment/jobs/${j._id}`, v);
      else await api.post('/recruitment/jobs', v);
      toast.success(j ? 'Job updated' : 'Job opening created');
      qc.invalidateQueries({ queryKey: ['jobs'] });
      onClose();
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <Drawer open={!!job} onClose={onClose} width="sm:max-w-2xl" title={j ? `Edit ${j.jobNo}` : 'New job opening'} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={isSubmitting} onClick={submit}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" required error={errors.title} className="sm:col-span-2"><Input {...register('title')} /></Field>
        <Field label="Department" required error={errors.departmentId}><Select {...register('departmentId')}><option value="">Select…</option>{depts?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
        <Field label="Employment type"><Select {...register('employmentType')}>{EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></Field>
        <Field label="Openings" error={errors.openings}><Input type="number" min={1} {...register('openings')} /></Field>
        <Field label="Status"><Select {...register('status')}>{JOB_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
        <Field label="Salary from" error={errors.salaryMin}><Input type="number" {...register('salaryMin', num)} /></Field>
        <Field label="Salary to" error={errors.salaryMax}><Input type="number" {...register('salaryMax', num)} /></Field>
        <Field label="Closing date" error={errors.closingDate}><Input type="date" {...register('closingDate', { setValueAs: (v) => v || undefined })} /></Field>
        <Field label="Description" required error={errors.description} className="sm:col-span-2"><Textarea rows={4} {...register('description')} /></Field>
        <Field label="Requirements" error={errors.requirements} className="sm:col-span-2"><Textarea rows={3} {...register('requirements')} /></Field>
      </div>
    </Drawer>
  );
}

function CandidatesTab({ jobId: initialJob }: { jobId: string }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [jobId, setJobId] = useState(initialJob);
  const [stage, setStage] = useState(params.get('stage') ?? '');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const { data: jobs } = useQuery({ queryKey: ['jobs', ''], queryFn: () => api.get<JobPosting[]>('/recruitment/jobs') });
  const { data, isFetching } = useQuery({ queryKey: ['candidates', jobId, stage, search, page], queryFn: () => api.get<Paged<Candidate>>('/recruitment/candidates', { jobId, stage, search, page, pageSize: 25 }), placeholderData: keepPreviousData });
  return (
    <Card>
      <div className="flex flex-wrap gap-2 border-b border-border p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name, email or phone" className="pl-8" />
        </div>
        <Select value={jobId} onChange={(e) => { setJobId(e.target.value); setPage(1); }} className="w-56"><option value="">All positions</option>{jobs?.map((j) => <option key={j._id} value={j._id}>{j.title} ({j.jobNo})</option>)}</Select>
        <Select value={stage} onChange={(e) => { setStage(e.target.value); setPage(1); }} className="w-40"><option value="">All stages</option>{CANDIDATE_STAGES.map((s) => <option key={s}>{s}</option>)}</Select>
        {can('recruitment.manage') && <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add candidate</Button>}
      </div>
      <DataTable
        loading={isFetching}
        rows={data?.items}
        rowKey={(c) => c._id}
        onRowClick={(c) => navigate(`/recruitment/candidates/${c._id}`)}
        empty={{ icon: <UsersRound className="h-5 w-5" />, title: 'No candidates' }}
        columns={[
          { key: 'n', header: 'Candidate', cell: (c) => <div><p className="font-medium">{c.fullName}</p><p className="text-[11px] text-muted">{c.email} · {c.phone}</p></div> },
          { key: 'j', header: 'Position', cell: (c) => <span className="text-xs">{c.jobTitle}</span> },
          { key: 'x', header: 'Experience', cell: (c) => <span className="text-xs">{c.experienceYears != null ? `${c.experienceYears} yrs` : '—'}{c.currentEmployer ? ` · ${c.currentEmployer}` : ''}</span>, hideOnMobile: true },
          { key: 'src', header: 'Source', cell: (c) => <span className="text-xs">{c.source}</span>, hideOnMobile: true },
          { key: 's', header: 'Stage', cell: (c) => <StatusBadge status={c.stage} /> },
          { key: 'u', header: 'Updated', cell: (c) => <span className="text-xs text-muted">{formatDate(c.updatedAt)}</span>, hideOnMobile: true },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      <CandidateDrawer open={adding} onClose={() => setAdding(false)} jobs={jobs?.filter((j) => j.status === 'Open') ?? []} presetJob={jobId} />
    </Card>
  );
}

function CandidateDrawer({ open, onClose, jobs, presetJob }: { open: boolean; onClose: () => void; jobs: JobPosting[]; presetJob?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<z.input<typeof candidateSchema>, unknown, z.output<typeof candidateSchema>>({ resolver: zodResolver(candidateSchema), values: { jobId: presetJob ?? '', firstName: '', lastName: '', gender: 'Female', email: '', phone: '', source: 'Website' } });
  const { register, formState: { errors, isSubmitting } } = form;
  const num = { setValueAs: (v: string) => (v === '' ? undefined : Number(v)) };
  const submit = form.handleSubmit(async (v) => {
    try {
      const c = await api.post<Candidate>('/recruitment/candidates', v);
      toast.success('Candidate added');
      qc.invalidateQueries({ queryKey: ['candidates'] });
      onClose();
      navigate(`/recruitment/candidates/${c._id}`);
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <Drawer open={open} onClose={onClose} width="sm:max-w-2xl" title="Add candidate" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={isSubmitting} onClick={submit}>Add</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Position" required error={errors.jobId} className="sm:col-span-2"><Select {...register('jobId')}><option value="">Select an open position…</option>{jobs.map((j) => <option key={j._id} value={j._id}>{j.title} ({j.jobNo})</option>)}</Select></Field>
        <Field label="First name" required error={errors.firstName}><Input {...register('firstName')} /></Field>
        <Field label="Last name" required error={errors.lastName}><Input {...register('lastName')} /></Field>
        <Field label="Gender" required><Select {...register('gender')}>{GENDERS.map((g) => <option key={g}>{g}</option>)}</Select></Field>
        <Field label="CNIC" error={errors.cnic}><Input {...register('cnic')} /></Field>
        <Field label="Email" required error={errors.email}><Input type="email" {...register('email')} /></Field>
        <Field label="Phone" required error={errors.phone}><Input {...register('phone')} /></Field>
        <Field label="Source"><Select {...register('source')}>{CANDIDATE_SOURCES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Current employer"><Input {...register('currentEmployer')} /></Field>
        <Field label="Experience (years)" error={errors.experienceYears}><Input type="number" step="0.5" {...register('experienceYears', num)} /></Field>
        <Field label="Expected salary" error={errors.expectedSalary}><Input type="number" {...register('expectedSalary', num)} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea {...register('notes')} /></Field>
      </div>
    </Drawer>
  );
}

const NEXT_STAGE: Record<string, string | undefined> = { Applied: 'Shortlisted', Interview: 'Selected' };

export function CandidatePage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [scheduling, setScheduling] = useState(false);
  const [evaluating, setEvaluating] = useState<Interview | null>(null);
  const [offering, setOffering] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const { data: c, isLoading } = useQuery({ queryKey: ['candidate', id], queryFn: () => api.get<Candidate>(`/recruitment/candidates/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['candidate', id] });
    qc.invalidateQueries({ queryKey: ['candidates'] });
    qc.invalidateQueries({ queryKey: ['recruitment-stats'] });
  };
  const stage = useMutation({ mutationFn: (v: { stage: string; note?: string }) => api.post(`/recruitment/candidates/${id}/stage`, v), onSuccess: (_d, v) => { toast.success(`Moved to ${v.stage}`); setRejecting(false); setReason(''); refresh(); }, onError: (e) => handleFormError(e) });
  const hire = useMutation({
    mutationFn: () => api.post<{ employee: { _id: string; employeeNo: string } }>(`/recruitment/candidates/${id}/hire`),
    onSuccess: (r) => { toast.success(`Hired as ${r.employee.employeeNo}: employee record, contract and salary created`); refresh(); navigate(`/hr/employees/${r.employee._id}`); },
    onError: (e) => handleFormError(e),
  });
  const ivStatus = useMutation({ mutationFn: (v: { id: string; status: string }) => api.post(`/recruitment/interviews/${v.id}/status`, { status: v.status }), onSuccess: () => { toast.success('Interview updated'); refresh(); }, onError: (e) => handleFormError(e) });
  const offerAct = useMutation({
    mutationFn: (v: { id: string; op: string }) => api.post(`/recruitment/offers/${v.id}/${v.op}`),
    onSuccess: (_d, v) => { toast.success({ submit: 'Sent for approval', approve: 'Offer approved', reject: 'Returned to draft', send: 'Offer marked as sent', accept: 'Offer accepted', decline: 'Offer declined', withdraw: 'Offer withdrawn' }[v.op] ?? 'Done'); refresh(); },
    onError: (e) => handleFormError(e),
  });
  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post(`/recruitment/candidates/${id}/resume`, fd);
      toast.success('CV uploaded');
      refresh();
    } catch (e) {
      handleFormError(e);
    }
  };
  if (isLoading || !c) return <PageLoader />;
  const job = typeof c.jobId === 'object' ? c.jobId : undefined;
  const manage = can('recruitment.manage');
  const accepted = c.offers?.find((o) => o.status === 'Accepted');
  const open = !['Hired', 'Rejected'].includes(c.stage);
  const cur = user?.hospital.currency;
  return (
    <div className="space-y-4">
      <PageHeader
        title={c.fullName}
        description={<span className="flex flex-wrap items-center gap-2">{job?.title} <span className="font-mono text-xs">{job?.jobNo}</span> · <StatusBadge status={c.stage} /></span>}
        actions={
          <>
            {manage && NEXT_STAGE[c.stage] && <Button icon={<UserCheck className="h-4 w-4" />} loading={stage.isPending} onClick={() => stage.mutate({ stage: NEXT_STAGE[c.stage]! })}>Move to {NEXT_STAGE[c.stage]}</Button>}
            {manage && ['Shortlisted', 'Interview'].includes(c.stage) && <Button variant="outline" icon={<CalendarClock className="h-4 w-4" />} onClick={() => setScheduling(true)}>Schedule interview</Button>}
            {manage && c.stage === 'Selected' && !c.offers?.some((o) => ['Draft', 'PendingApproval', 'Approved', 'Sent'].includes(o.status)) && <Button icon={<Mail className="h-4 w-4" />} onClick={() => setOffering(true)}>Draft offer</Button>}
            {can('recruitment.approve') && c.stage === 'Offer' && accepted && <Button icon={<UserPlus className="h-4 w-4" />} loading={hire.isPending} onClick={() => hire.mutate()}>Hire</Button>}
            {manage && open && c.stage !== 'Offer' && <Button variant="outline" onClick={() => setRejecting(true)}>Reject</Button>}
          </>
        }
      />
      {c.stage === 'Hired' && c.employeeId && <p className="text-sm">Hired — <Link className="text-brand hover:underline" to={`/hr/employees/${c.employeeId}`}>open employee record</Link></p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Profile" />
          <div className="p-4">
            <KeyValue items={[['Email', c.email], ['Phone', c.phone], ['Gender', c.gender], ['CNIC', c.cnic], ['Source', c.source], ['Current employer', c.currentEmployer], ['Experience', c.experienceYears != null ? `${c.experienceYears} years` : '—'], ['Expected salary', c.expectedSalary ? money(c.expectedSalary, cur) : '—']]} />
            {c.notes && <p className="mt-3 text-sm text-muted">{c.notes}</p>}
          </div>
        </Card>
        <Card>
          <CardHeader title="CV" />
          <div className="space-y-2 p-4 text-sm">
            {c.resume ? (
              <Button variant="outline" icon={<FileText className="h-4 w-4" />} onClick={() => openPdf(`/recruitment/candidates/${c._id}/resume`).catch((e) => handleFormError(e))}>{c.resume.fileName}</Button>
            ) : (
              <p className="text-muted">No CV uploaded</p>
            )}
            {manage && (
              <>
                <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                <Button size="sm" variant="ghost" icon={<FileUp className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>{c.resume ? 'Replace' : 'Upload PDF'}</Button>
              </>
            )}
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Interviews" />
        {c.interviews?.length ? (
          <ul className="divide-y divide-border">
            {c.interviews.map((iv) => (
              <li key={iv._id} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{formatDateTime(iv.scheduledAt)}</span>
                  <span className="text-xs text-muted">{iv.mode} · {iv.durationMinutes} min{iv.location ? ` · ${iv.location}` : ''} · panel: {iv.panel.join(', ')}</span>
                  <StatusBadge status={iv.status} />
                  <span className="ml-auto flex gap-1">
                    {iv.status === 'Scheduled' && <Button size="sm" icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => setEvaluating(iv)}>Evaluate</Button>}
                    {iv.status === 'Scheduled' && manage && <Button size="sm" variant="ghost" onClick={() => ivStatus.mutate({ id: iv._id, status: 'NoShow' })}>No-show</Button>}
                    {iv.status === 'Scheduled' && manage && <Button size="sm" variant="ghost" onClick={() => ivStatus.mutate({ id: iv._id, status: 'Cancelled' })}>Cancel</Button>}
                  </span>
                </div>
                {iv.evaluation && (
                  <p className="text-xs">
                    <Badge tone={iv.evaluation.recommendation === 'Hire' ? 'ok' : iv.evaluation.recommendation === 'Reject' ? 'danger' : 'warn'}>{iv.evaluation.recommendation}</Badge> overall <b>{iv.evaluation.overall}</b>/5 (technical {iv.evaluation.technical}, communication {iv.evaluation.communication}, experience {iv.evaluation.experience}, attitude {iv.evaluation.attitude}) — {iv.evaluation.comments} <span className="text-muted">· {iv.evaluation.byName}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No interviews yet" />
        )}
      </Card>
      <Card>
        <CardHeader title="Offer letters" />
        {c.offers?.length ? (
          <ul className="divide-y divide-border">
            {c.offers.map((o) => (
              <li key={o._id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <span className="font-mono text-xs">{o.offerNo}</span>
                <span>{o.designation} · {money(o.basicSalary, cur)} basic{o.allowances.length ? ` + ${money(o.allowances.reduce((s, a) => s + a.amount, 0), cur)} allowances` : ''} · joins {formatDate(o.joiningDate)}</span>
                <StatusBadge status={o.status} />
                {o.approvedByName && <span className="text-xs text-muted">approved by {o.approvedByName}</span>}
                <span className="ml-auto flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" icon={<FileText className="h-4 w-4" />} onClick={() => openPdf(`/recruitment/offers/${o._id}/pdf`).catch((e) => handleFormError(e))}>Letter</Button>
                  {offerButtons(o, manage, can('recruitment.approve')).map(([op, label]) => (
                    <Button key={op} size="sm" variant={['reject', 'decline', 'withdraw'].includes(op) ? 'outline' : 'primary'} icon={op === 'send' ? <Send className="h-4 w-4" /> : undefined} loading={offerAct.isPending && offerAct.variables?.op === op} onClick={() => offerAct.mutate({ id: o._id, op })}>{label}</Button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No offers" description="Offers can be drafted once a candidate is selected." />
        )}
      </Card>
      {c.history && (
        <Card>
          <CardHeader title="Stage history" />
          <ol className="space-y-1 p-4 text-sm">{c.history.map((h, i) => <li key={i}><b>{h.stage}</b> · {formatDateTime(h.at)} · {h.byName}{h.note && <span className="text-muted"> — {h.note}</span>}</li>)}</ol>
        </Card>
      )}
      <ScheduleDialog open={scheduling} candidateId={c._id} onClose={() => setScheduling(false)} onDone={refresh} />
      <EvaluationDialog interview={evaluating} onClose={() => setEvaluating(null)} onDone={refresh} />
      <OfferDrawer open={offering} candidate={c} onClose={() => setOffering(false)} onDone={refresh} />
      <Dialog open={rejecting} onClose={() => setRejecting(false)} title="Reject candidate" footer={<><Button variant="outline" onClick={() => setRejecting(false)}>Cancel</Button><Button variant="danger" loading={stage.isPending} onClick={() => stage.mutate({ stage: 'Rejected', note: reason || undefined })}>Reject</Button></>}>
        <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}

function offerButtons(o: OfferLetter, manage: boolean, approve: boolean): Array<[string, string]> {
  const b: Array<[string, string]> = [];
  if (o.status === 'Draft' && manage) b.push(['submit', 'Submit for approval']);
  if (o.status === 'PendingApproval' && approve) b.push(['approve', 'Approve'], ['reject', 'Return']);
  if (o.status === 'Approved' && manage) b.push(['send', 'Mark as sent']);
  if (o.status === 'Sent' && manage) b.push(['accept', 'Accepted'], ['decline', 'Declined']);
  if (['Draft', 'PendingApproval', 'Approved', 'Sent'].includes(o.status) && manage) b.push(['withdraw', 'Withdraw']);
  return b;
}

function ScheduleDialog({ open, candidateId, onClose, onDone }: { open: boolean; candidateId: string; onClose: () => void; onDone: () => void }) {
  const { user } = useAuth();
  const [at, setAt] = useState('');
  const [duration, setDuration] = useState('45');
  const [mode, setMode] = useState<string>('In person');
  const [location, setLocation] = useState('');
  const [panel, setPanel] = useState('');
  useEffect(() => {
    if (open) {
      const t = new Date(Date.now() + 86_400_000);
      t.setHours(11, 0, 0, 0);
      setAt(new Date(t.getTime() - t.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
      setPanel(user?.fullName ?? '');
    }
  }, [open, user]);
  const m = useMutation({
    mutationFn: () => api.post('/recruitment/interviews', { candidateId, scheduledAt: new Date(at).toISOString(), durationMinutes: Number(duration), mode, location: location || undefined, panel: panel.split(',').map((p) => p.trim()).filter(Boolean) }),
    onSuccess: () => { toast.success('Interview scheduled'); onDone(); onClose(); },
    onError: (e) => handleFormError(e),
  });
  return (
    <Dialog open={open} onClose={onClose} title="Schedule interview" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!at || !panel.trim()} loading={m.isPending} onClick={() => m.mutate()}>Schedule</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date & time" required><Input type="datetime-local" value={at} min={new Date().toISOString().slice(0, 16)} onChange={(e) => setAt(e.target.value)} /></Field>
        <Field label="Duration (min)"><Input type="number" min={10} value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
        <Field label="Mode"><Select value={mode} onChange={(e) => setMode(e.target.value)}>{INTERVIEW_MODES.map((m2) => <option key={m2}>{m2}</option>)}</Select></Field>
        <Field label="Location / link"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        <Field label="Panel" required hint="Comma-separated names" className="col-span-2"><Input value={panel} onChange={(e) => setPanel(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function EvaluationDialog({ interview, onClose, onDone }: { interview: Interview | null; onClose: () => void; onDone: () => void }) {
  const [scores, setScores] = useState({ technical: 3, communication: 3, experience: 3, attitude: 3 });
  const [recommendation, setRecommendation] = useState<string>('Hire');
  const [comments, setComments] = useState('');
  useEffect(() => {
    if (interview) {
      setScores({ technical: 3, communication: 3, experience: 3, attitude: 3 });
      setRecommendation('Hire');
      setComments('');
    }
  }, [interview]);
  const m = useMutation({ mutationFn: () => api.post(`/recruitment/interviews/${interview!._id}/evaluation`, { ...scores, recommendation, comments }), onSuccess: () => { toast.success('Evaluation recorded'); onDone(); onClose(); }, onError: (e) => handleFormError(e) });
  return (
    <Dialog open={!!interview} onClose={onClose} title="Interview evaluation" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={comments.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>Save evaluation</Button></>}>
      <div className="space-y-3">
        {(Object.keys(scores) as Array<keyof typeof scores>).map((k) => (
          <div key={k} className="flex items-center gap-3 text-sm">
            <span className="w-32">{humanize(k)}</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setScores({ ...scores, [k]: n })} className={cn('h-8 w-8 rounded-md border text-sm', scores[k] >= n ? 'border-brand bg-brand text-white' : 'border-border')}>{n}</button>
              ))}
            </div>
          </div>
        ))}
        <p className="text-xs text-muted">Overall {((scores.technical + scores.communication + scores.experience + scores.attitude) / 4).toFixed(2)} / 5</p>
        <Field label="Recommendation"><Select value={recommendation} onChange={(e) => setRecommendation(e.target.value)}>{RECOMMENDATIONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <Field label="Comments" required><Textarea value={comments} onChange={(e) => setComments(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function OfferDrawer({ open, candidate, onClose, onDone }: { open: boolean; candidate: Candidate; onClose: () => void; onDone: () => void }) {
  const { data: depts } = useDepartments();
  const { designations } = useCatalog();
  const job = typeof candidate.jobId === 'object' ? candidate.jobId : undefined;
  const [designation, setDesignation] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [employmentType, setEmploymentType] = useState('FullTime');
  const [basic, setBasic] = useState('');
  const [allowances, setAllowances] = useState<LineItem[]>([]);
  const [joiningDate, setJoiningDate] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [terms, setTerms] = useState('');
  const plus = (d: number) => new Date(Date.now() + d * 86_400_000).toLocaleDateString('en-CA');
  useEffect(() => {
    if (open) {
      setDesignation(job?.title ?? '');
      setDepartmentId(job?.departmentId ?? '');
      setEmploymentType(job?.employmentType ?? 'FullTime');
      setBasic(String(candidate.expectedSalary ?? ''));
      setAllowances([{ name: 'House rent', amount: Math.round((candidate.expectedSalary ?? 0) * 0.45) }, { name: 'Medical', amount: Math.round((candidate.expectedSalary ?? 0) * 0.1) }]);
      setJoiningDate(plus(30));
      setExpiresOn(plus(7));
      setTerms('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: () => api.post('/recruitment/offers', { candidateId: candidate._id, designation, departmentId, employmentType, basicSalary: Number(basic), allowances: allowances.filter((a) => a.name), joiningDate, expiresOn, terms: terms || undefined }),
    onSuccess: () => { toast.success('Offer drafted — submit it for approval'); onDone(); onClose(); },
    onError: (e) => handleFormError(e),
  });
  return (
    <Drawer open={open} onClose={onClose} width="sm:max-w-2xl" title={`Offer for ${candidate.fullName}`} description="Another approver must approve the offer before it can be sent." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!designation || !departmentId || !(Number(basic) > 0)} loading={m.isPending} onClick={() => m.mutate()}>Create draft</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Designation" required><Input list="offer-designations" value={designation} onChange={(e) => setDesignation(e.target.value)} /></Field>
          <datalist id="offer-designations">{designations.map((d) => <option key={d} value={d} />)}</datalist>
          <Field label="Department" required><Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}><option value="">Select…</option>{depts?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
          <Field label="Employment type"><Select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>{EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></Field>
          <Field label="Basic salary" required><Input type="number" min={0} value={basic} onChange={(e) => setBasic(e.target.value)} /></Field>
          <Field label="Joining date" required><Input type="date" min={todayIso()} value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} /></Field>
          <Field label="Offer valid until" required><Input type="date" min={todayIso()} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></Field>
        </div>
        <LineEditor title="Allowances" rows={allowances} onChange={setAllowances} />
        <Field label="Additional terms"><Textarea value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}
