import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BadgeCheck, CalendarCheck, CalendarX2, Clock, FilePlus2, Lock, Pencil, Search, Star, UserPlus, Users, XCircle } from 'lucide-react';
import { BRAND, EMPLOYMENT_TYPES, GENDERS, LEAVE_STATUSES, contractSchema, employeeSchema, performanceReviewSchema } from '@hms/shared';
import { api, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCatalog } from '@/lib/catalog';
import { formatDate, formatTime, humanize, money, todayIso } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, Input, PageHeader, PageLoader, Select, Textarea } from '@/components/ui/primitives';
import { DataTable, KeyValue, Pagination, StatCard, Tabs } from '@/components/ui/data';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Dialog, Drawer } from '@/components/ui/overlay';
import { Field, FormSection, handleFormError } from '@/components/form/Field';
import type { AttendanceRecord, AttendanceSummaryRow, Department, Employee, EmployeeProfile, LeaveRequest } from '@/types';
import { SalaryEditor } from '@/pages/payroll/PayrollPages';

const tooltipStyle = { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 8, fontSize: 12, color: 'rgb(var(--fg))' };
export const hours = (min?: number) => (min ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : '—');
const deptName = (d: Employee['departmentId']) => (typeof d === 'object' ? d?.name : undefined);
const deptId = (d: Employee['departmentId']) => (typeof d === 'object' ? d?._id : d);

export function useDepartments() {
  return useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/admin/departments'), staleTime: 300_000 });
}

interface HrStats {
  headcount: number;
  byDepartment: Array<{ department: string; employees: number }>;
  today: { clockedIn: number; late: number; absent: number; onLeave: number; notYetIn: number };
  pendingLeave: { manager: number; hr: number };
  trend: Array<{ date: string; present: number; late: number; absent: number; onLeave: number }>;
}

type HrTab = 'overview' | 'employees' | 'attendance' | 'summary';

/** HR home: dashboard, employee directory, daily register and monthly summary. */
export function HrPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as HrTab) ?? 'overview';
  const tabs: Array<{ key: HrTab; label: string }> = [{ key: 'overview', label: 'Overview' }];
  if (can('hr.employees', 'hr.attendance')) tabs.push({ key: 'employees', label: 'Employees' });
  if (can('hr.attendance')) tabs.push({ key: 'attendance', label: 'Daily attendance' }, { key: 'summary', label: 'Monthly summary' });
  return (
    <>
      <PageHeader title="Human resources" description="Staff records, attendance and leave" />
      <Tabs tabs={tabs} value={tab} onChange={(k) => setParams({ tab: k })} className="mb-4" />
      {tab === 'overview' && <HrOverview />}
      {tab === 'employees' && <EmployeesTab />}
      {tab === 'attendance' && <AttendanceTab />}
      {tab === 'summary' && <SummaryTab />}
    </>
  );
}

/** Dashboard for HR staff. */
export function HrDashboard() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title={`Good day, ${user?.fullName.split(' ')[0]}`} description="Workforce today" />
      <HrOverview />
    </>
  );
}

function HrOverview() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['hr-stats'], queryFn: () => api.get<HrStats>('/hr/stats'), refetchInterval: 60_000 });
  if (isLoading || !data) return <PageLoader />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Active staff" value={data.headcount} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Clocked in today" value={data.today.clockedIn} hint={`${data.today.late} late`} icon={<Clock className="h-4 w-4" />} tone="ok" />
        <StatCard label="Not yet in" value={data.today.notYetIn} icon={<CalendarX2 className="h-4 w-4" />} tone="warn" />
        <StatCard label="On leave today" value={data.today.onLeave} icon={<CalendarCheck className="h-4 w-4" />} tone="info" />
        <StatCard label="Leave awaiting HR" value={data.pendingLeave.hr} hint={`${data.pendingLeave.manager} with managers`} icon={<BadgeCheck className="h-4 w-4" />} tone="violet" onClick={can('hr.leave.approve') ? () => navigate('/hr/leave') : undefined} />
        <StatCard label="Absent today" value={data.today.absent} icon={<XCircle className="h-4 w-4" />} tone="danger" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Attendance, last 14 days" description="Daily count by status" />
          <div className="p-3">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.trend} margin={{ left: -20, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => formatDate(d, { day: '2-digit', month: 'short' })} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(d) => formatDate(d as string)} cursor={{ fill: 'rgb(var(--subtle))' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="present" name="On time" stackId="a" fill={BRAND.colors.blue} />
                <Bar dataKey="late" name="Late / half day" stackId="a" fill="#d97706" />
                <Bar dataKey="onLeave" name="On leave" stackId="a" fill="#2563eb" />
                <Bar dataKey="absent" name="Absent" stackId="a" fill="#dc2626" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader title="Headcount by department" />
          <ul className="divide-y divide-border">
            {data.byDepartment.map((d) => (
              <li key={d.department} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>{d.department}</span>
                <span className="num font-medium">{d.employees}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function EmployeesTab() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: depts } = useDepartments();
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [active, setActive] = useState('true');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, isFetching } = useQuery({
    queryKey: ['employees', search, departmentId, active, page, sort],
    queryFn: () => api.get<Paged<Employee>>('/hr/employees', { search, departmentId, active, page, sort, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  return (
    <Card>
      <div className="flex flex-wrap gap-2 border-b border-border p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name, employee no., designation or CNIC" className="pl-8" />
        </div>
        <Select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }} className="w-48"><option value="">All departments</option>{depts?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select>
        <Select value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }} className="w-36"><option value="true">Active</option><option value="false">Former staff</option><option value="all">Everyone</option></Select>
        {can('hr.employees') && <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add employee</Button>}
      </div>
      <DataTable
        sort={sort}
        onSort={(s) => { setSort(s); setPage(1); }}
        loading={isFetching}
        rows={data?.items}
        rowKey={(e) => e._id}
        onRowClick={(e) => navigate(`/hr/employees/${e._id}`)}
        empty={{ icon: <Users className="h-5 w-5" />, title: 'No employees found' }}
        columns={[
          { key: 'n', header: 'Employee', sortKey: 'name', cell: (e) => <div><p className="font-medium">{e.fullName}</p><p className="font-mono text-[11px] text-muted">{e.employeeNo}</p></div> },
          { key: 'd', header: 'Designation', sortKey: 'designation', cell: (e) => <div className="text-xs"><p>{e.designation}</p><p className="text-muted">{e.departmentName}</p></div> },
          { key: 'm', header: 'Reports to', cell: (e) => <span className="text-xs">{e.managerName ?? '—'}</span>, hideOnMobile: true },
          { key: 't', header: 'Type', cell: (e) => <span className="text-xs">{humanize(e.employmentType)}</span>, hideOnMobile: true },
          { key: 'j', header: 'Joined', sortKey: 'joiningDate', cell: (e) => <span className="text-xs">{formatDate(e.joiningDate)}</span>, hideOnMobile: true },
          { key: 's', header: 'Today', cell: (e) => (e.today ? <StatusBadge status={e.today.status} /> : <span className="text-xs text-muted">{e.isActive ? 'Not in yet' : 'Inactive'}</span>) },
        ]}
      />
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      <EmployeeDrawer open={creating} onClose={() => setCreating(false)} />
    </Card>
  );
}

type EmpIn = z.input<typeof employeeSchema>;
type EmpOut = z.output<typeof employeeSchema>;

function EmployeeDrawer({ open, onClose, employee }: { open: boolean; onClose: () => void; employee?: EmployeeProfile }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: depts } = useDepartments();
  const { designations } = useCatalog();
  const { data: managers } = useQuery({ queryKey: ['employees', 'managers'], queryFn: () => api.get<Paged<Employee>>('/hr/employees', { pageSize: 100 }), enabled: open });
  const blank: EmpIn = { firstName: '', lastName: '', gender: 'Female', departmentId: '', designation: '', joiningDate: todayIso(), employmentType: 'FullTime', isActive: true };
  const form = useForm<EmpIn, unknown, EmpOut>({
    resolver: zodResolver(employeeSchema),
    values: employee
      ? {
          firstName: employee.firstName,
          lastName: employee.lastName,
          gender: employee.gender as EmpIn['gender'],
          cnic: employee.cnic ?? '',
          dateOfBirth: employee.dateOfBirth?.slice(0, 10),
          departmentId: deptId(employee.departmentId) ?? '',
          designation: employee.designation,
          joiningDate: employee.joiningDate.slice(0, 10),
          employmentType: employee.employmentType as EmpIn['employmentType'],
          phone: employee.phone ?? '',
          email: employee.email ?? '',
          address: employee.address ?? '',
          emergencyContactName: employee.emergencyContactName ?? '',
          emergencyContactPhone: employee.emergencyContactPhone ?? '',
          reportingManagerId: (typeof employee.reportingManagerId === 'object' ? employee.reportingManagerId?._id : employee.reportingManagerId) ?? '',
          shiftStart: employee.shiftStart ?? '',
          shiftEnd: employee.shiftEnd ?? '',
          isActive: employee.isActive,
        }
      : blank,
  });
  const { register, formState: { errors, isSubmitting } } = form;
  const submit = form.handleSubmit(async (v) => {
    try {
      const saved = employee ? await api.put<Employee>(`/hr/employees/${employee._id}`, v) : await api.post<Employee>('/hr/employees', v);
      toast.success(employee ? 'Employee updated' : `Employee ${saved.employeeNo} created`);
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['employee'] });
      onClose();
      if (!employee) navigate(`/hr/employees/${saved._id}`);
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <Drawer open={open} onClose={onClose} width="sm:max-w-2xl" title={employee ? `Edit ${employee.fullName}` : 'New employee'} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={isSubmitting} onClick={submit}>Save</Button></>}>
      <form onSubmit={submit} className="space-y-5">
        <FormSection title="Personal">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" required error={errors.firstName}><Input {...register('firstName')} /></Field>
            <Field label="Last name" required error={errors.lastName}><Input {...register('lastName')} /></Field>
            <Field label="Gender" required error={errors.gender}><Select {...register('gender')}>{GENDERS.map((g) => <option key={g}>{g}</option>)}</Select></Field>
            <Field label="Date of birth" error={errors.dateOfBirth}><Input type="date" {...register('dateOfBirth', { setValueAs: (v) => v || undefined })} /></Field>
            <Field label="CNIC" error={errors.cnic} hint="12345-1234567-1"><Input {...register('cnic')} /></Field>
            <Field label="Phone" error={errors.phone}><Input {...register('phone')} /></Field>
            <Field label="Email" error={errors.email}><Input type="email" {...register('email')} /></Field>
            <Field label="Address" error={errors.address}><Input {...register('address')} /></Field>
            <Field label="Emergency contact" error={errors.emergencyContactName}><Input {...register('emergencyContactName')} /></Field>
            <Field label="Emergency phone" error={errors.emergencyContactPhone}><Input {...register('emergencyContactPhone')} /></Field>
          </div>
        </FormSection>
        <FormSection title="Employment">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Department" required error={errors.departmentId}><Select {...register('departmentId')}><option value="">Select…</option>{depts?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
            <Field label="Designation" required error={errors.designation}><Input list="designation-options" {...register('designation')} /></Field>
            <datalist id="designation-options">{designations.map((d) => <option key={d} value={d} />)}</datalist>
            <Field label="Joining date" required error={errors.joiningDate}><Input type="date" {...register('joiningDate')} /></Field>
            <Field label="Employment type" error={errors.employmentType}><Select {...register('employmentType')}>{EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></Field>
            <Field label="Reports to" error={errors.reportingManagerId}><Select {...register('reportingManagerId')}><option value="">— none (leave goes straight to HR) —</option>{managers?.items.filter((m) => m._id !== employee?._id).map((m) => <option key={m._id} value={m._id}>{m.fullName} · {m.designation}</option>)}</Select></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Shift start" error={errors.shiftStart} hint="Blank = hospital default"><Input type="time" {...register('shiftStart')} /></Field>
              <Field label="Shift end" error={errors.shiftEnd}><Input type="time" {...register('shiftEnd')} /></Field>
            </div>
            {employee && <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('isActive')} /> Currently employed</label>}
          </div>
        </FormSection>
      </form>
    </Drawer>
  );
}

export function EmployeeProfilePage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [tab, setTab] = useState<'overview' | 'contracts' | 'salary' | 'leave' | 'reviews'>('overview');
  const [editing, setEditing] = useState(false);
  const { data: e, isLoading } = useQuery({ queryKey: ['employee', id], queryFn: () => api.get<EmployeeProfile>(`/hr/employees/${id}`) });
  if (isLoading || !e) return <PageLoader />;
  const tabs: Array<{ key: typeof tab; label: string }> = [{ key: 'overview', label: 'Overview' }, { key: 'contracts', label: 'Contracts' }];
  if (can('payroll.manage', 'hr.employees')) tabs.push({ key: 'salary', label: 'Salary' });
  tabs.push({ key: 'leave', label: 'Leave' });
  if (can('hr.employees')) tabs.push({ key: 'reviews', label: 'Performance' });
  const mgr = typeof e.reportingManagerId === 'object' ? e.reportingManagerId : undefined;
  return (
    <div className="space-y-4">
      <PageHeader
        title={e.fullName}
        description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{e.employeeNo}</span> · {e.designation} · {deptName(e.departmentId)} {!e.isActive && <Badge tone="danger">Former employee</Badge>}</span>}
        actions={can('hr.employees') && <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Employment" />
            <div className="p-4">
              <KeyValue items={[['Joined', formatDate(e.joiningDate)], ['Type', humanize(e.employmentType)], ['Reports to', mgr ? `${mgr.firstName} ${mgr.lastName}` : '—'], ['Shift', e.shiftStart ? `${e.shiftStart}–${e.shiftEnd}` : 'Hospital default'], ['Exit date', e.exitDate ? formatDate(e.exitDate) : '—'], ['System login', e.userId ? 'Linked' : 'None']]} />
              {!!e.directReports.length && <p className="mt-3 text-xs text-muted">Direct reports: {e.directReports.map((r) => `${r.firstName} ${r.lastName}`).join(', ')}</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Contact" />
            <div className="p-4">
              <KeyValue items={[['Phone', e.phone], ['Email', e.email], ['CNIC', e.cnic], ['Gender', e.gender], ['Date of birth', e.dateOfBirth ? formatDate(e.dateOfBirth) : '—'], ['Emergency contact', e.emergencyContactName ? `${e.emergencyContactName} · ${e.emergencyContactPhone ?? ''}` : '—']]} />
            </div>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Attendance this month" />
            <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-6">
              {(['present', 'late', 'halfDay', 'absent', 'onLeave'] as const).map((k) => <StatCard key={k} label={humanize(k)} value={e.attendanceThisMonth?.[k] ?? 0} />)}
              <StatCard label="Overtime" value={hours(e.attendanceThisMonth?.overtimeMinutes)} tone="ok" />
            </div>
          </Card>
        </div>
      )}
      {tab === 'contracts' && <ContractsCard employee={e} />}
      {tab === 'salary' && <SalaryEditor employeeId={e._id} history={e.salaryHistory} />}
      {tab === 'leave' && <LeaveBalancesCard balances={e.leaveBalances} employeeId={e._id} />}
      {tab === 'reviews' && <ReviewsCard employee={e} />}
      <EmployeeDrawer open={editing} onClose={() => setEditing(false)} employee={e} />
    </div>
  );
}

function ContractsCard({ employee }: { employee: EmployeeProfile }) {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [terminating, setTerminating] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const form = useForm<z.input<typeof contractSchema>, unknown, z.output<typeof contractSchema>>({ resolver: zodResolver(contractSchema), values: { type: employee.employmentType as never, startDate: todayIso(), basicSalary: employee.contracts[0]?.basicSalary ?? 0, noticePeriodDays: 30, probationMonths: 3 } });
  const refresh = () => qc.invalidateQueries({ queryKey: ['employee', employee._id] });
  const add = form.handleSubmit(async (v) => {
    try {
      const c = await api.post<{ contractNo: string }>(`/hr/employees/${employee._id}/contracts`, v);
      toast.success(`Contract ${c.contractNo} issued; the previous one is now expired`);
      setAdding(false);
      refresh();
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  const term = useMutation({ mutationFn: () => api.post(`/hr/contracts/${terminating}/terminate`, { reason }), onSuccess: () => { toast.success('Contract terminated'); setTerminating(null); setReason(''); refresh(); }, onError: (e) => handleFormError(e) });
  return (
    <Card>
      <CardHeader title="Contracts" actions={can('hr.employees') && <Button size="sm" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setAdding(true)}>New contract</Button>} />
      <DataTable
        rows={employee.contracts}
        rowKey={(c) => c._id}
        empty={{ title: 'No contracts on file' }}
        columns={[
          { key: 'no', header: 'Contract', cell: (c) => <span className="font-mono text-xs">{c.contractNo}</span> },
          { key: 't', header: 'Type', cell: (c) => humanize(c.type) },
          { key: 'p', header: 'Period', cell: (c) => <span className="text-xs">{formatDate(c.startDate)} – {c.endDate ? formatDate(c.endDate) : 'open-ended'}</span> },
          { key: 'b', header: 'Basic', align: 'right', cell: (c) => money(c.basicSalary, user?.hospital.currency) },
          { key: 's', header: 'Status', cell: (c) => <div><StatusBadge status={c.status} />{c.terminationReason && <p className="mt-0.5 text-[11px] text-muted">{c.terminationReason}</p>}</div> },
          { key: 'a', header: '', cell: (c) => c.status === 'Active' && can('hr.employees') && <Button size="sm" variant="ghost" onClick={() => setTerminating(c._id)}>Terminate</Button> },
        ]}
      />
      <Dialog open={adding} onClose={() => setAdding(false)} title="Issue new contract" description="The current active contract is marked expired." footer={<><Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button><Button loading={form.formState.isSubmitting} onClick={add}>Issue contract</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" error={form.formState.errors.type}><Select {...form.register('type')}>{EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></Field>
          <Field label="Basic salary" error={form.formState.errors.basicSalary}><Input type="number" {...form.register('basicSalary')} /></Field>
          <Field label="Start" error={form.formState.errors.startDate}><Input type="date" {...form.register('startDate')} /></Field>
          <Field label="End (optional)" error={form.formState.errors.endDate}><Input type="date" {...form.register('endDate', { setValueAs: (v) => v || undefined })} /></Field>
          <Field label="Notice (days)" error={form.formState.errors.noticePeriodDays}><Input type="number" {...form.register('noticePeriodDays')} /></Field>
          <Field label="Probation (months)" error={form.formState.errors.probationMonths}><Input type="number" {...form.register('probationMonths')} /></Field>
          <Field label="Terms" className="col-span-2" error={form.formState.errors.terms}><Textarea {...form.register('terms')} /></Field>
        </div>
      </Dialog>
      <Dialog open={!!terminating} onClose={() => setTerminating(null)} title="Terminate contract" footer={<><Button variant="outline" onClick={() => setTerminating(null)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={term.isPending} onClick={() => term.mutate()}>Terminate</Button></>}>
        <Field label="Reason" required><Textarea value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field>
      </Dialog>
    </Card>
  );
}

export function LeaveBalancesCard({ balances, employeeId }: { balances: EmployeeProfile['leaveBalances']; employeeId?: string }) {
  const { data } = useQuery({ queryKey: ['leave', 'employee', employeeId], queryFn: () => api.get<Paged<LeaveRequest>>('/hr/leave', { employeeId, scope: 'all', pageSize: 20 }), enabled: !!employeeId });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {balances.map((b) => <StatCard key={b.type} label={`${b.type} leave`} value={b.available ?? '∞'} hint={`${b.used} used · ${b.pending} pending of ${b.entitled}`} tone={b.available === 0 ? 'danger' : 'brand'} />)}
      </div>
      {employeeId && (
        <Card>
          <CardHeader title="Leave history" />
          <LeaveTable rows={data?.items} />
        </Card>
      )}
    </div>
  );
}

export function LeaveTable({ rows, actions, showEmployee }: { rows?: LeaveRequest[]; actions?: (l: LeaveRequest) => React.ReactNode; showEmployee?: boolean }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(l) => l._id}
      empty={{ icon: <CalendarCheck className="h-5 w-5" />, title: 'No leave requests' }}
      columns={[
        ...(showEmployee ? [{ key: 'e', header: 'Employee', cell: (l: LeaveRequest) => <div><p className="font-medium">{l.employeeName}</p><p className="text-[11px] text-muted">{l.departmentName}</p></div> }] : []),
        { key: 'no', header: 'Request', cell: (l) => <div><p className="font-mono text-xs">{l.requestNo}</p><p className="text-[11px] text-muted">{formatDate(l.createdAt)}</p></div> },
        { key: 't', header: 'Type', cell: (l) => l.type },
        { key: 'd', header: 'Dates', cell: (l) => <div className="text-xs"><p>{formatDate(l.from)}{l.to !== l.from && ` – ${formatDate(l.to)}`}</p><p className="text-muted">{l.days} day{l.days === 1 ? '' : 's'}{l.halfDay ? ' (half)' : ''}</p></div> },
        { key: 'r', header: 'Reason', cell: (l) => <span className="line-clamp-2 text-xs">{l.reason}</span>, hideOnMobile: true },
        {
          key: 's',
          header: 'Status',
          cell: (l) => (
            <div>
              <StatusBadge status={l.status} />
              {[l.managerDecision, l.hrDecision].filter(Boolean).map((d, i) => <p key={i} className="mt-0.5 text-[11px] text-muted">{d!.approve ? '✓' : '✗'} {d!.byName}{d!.note ? `: ${d!.note}` : ''}</p>)}
            </div>
          ),
        },
        ...(actions ? [{ key: 'a', header: '', cell: actions }] : []),
      ]}
    />
  );
}

function ReviewsCard({ employee }: { employee: EmployeeProfile }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const draft = employee.reviews.find((r) => r.status === 'Draft');
  const form = useForm<z.input<typeof performanceReviewSchema>, unknown, z.output<typeof performanceReviewSchema>>({
    resolver: zodResolver(performanceReviewSchema),
    values: draft ? { period: draft.period, rating: draft.rating, goals: draft.goals ?? '', strengths: draft.strengths ?? '', improvements: draft.improvements ?? '', submit: false } : { period: `${new Date().getFullYear()} ${new Date().getMonth() < 6 ? 'H1' : 'H2'}`, rating: 3, submit: false },
  });
  const save = (submit: boolean) =>
    form.handleSubmit(async (v) => {
      try {
        await api.post(`/hr/employees/${employee._id}/reviews`, { ...v, submit });
        toast.success(submit ? 'Review shared with the employee' : 'Draft saved');
        setOpen(false);
        qc.invalidateQueries({ queryKey: ['employee', employee._id] });
      } catch (e) {
        handleFormError(e, form.setError);
      }
    })();
  return (
    <Card>
      <CardHeader title="Performance reviews" actions={<Button size="sm" icon={<Star className="h-4 w-4" />} onClick={() => setOpen(true)}>{draft ? 'Continue draft' : 'New review'}</Button>} />
      {employee.reviews.length ? (
        <ul className="divide-y divide-border">
          {employee.reviews.map((r) => (
            <li key={r._id} className="space-y-1 px-4 py-3 text-sm">
              <div className="flex items-center gap-2"><span className="font-medium">{r.period}</span><span className="text-amber-500">{'★'.repeat(r.rating)}<span className="text-border">{'★'.repeat(5 - r.rating)}</span></span><StatusBadge status={r.status} /><span className="ml-auto text-xs text-muted">{r.reviewerName}</span></div>
              {r.strengths && <p className="text-xs"><b>Strengths:</b> {r.strengths}</p>}
              {r.improvements && <p className="text-xs"><b>To improve:</b> {r.improvements}</p>}
              {r.goals && <p className="text-xs"><b>Goals:</b> {r.goals}</p>}
              {r.employeeComment && <p className="text-xs text-muted">Employee: “{r.employeeComment}”</p>}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No reviews yet" />
      )}
      <Dialog open={open} onClose={() => setOpen(false)} width="max-w-2xl" title="Performance review" footer={<><Button variant="outline" onClick={() => save(false)}>Save draft</Button><Button onClick={() => save(true)}>Submit to employee</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Period" error={form.formState.errors.period}><Input {...form.register('period')} /></Field>
          <Field label="Rating (1–5)" error={form.formState.errors.rating}><Select {...form.register('rating')}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} — {['', 'Unsatisfactory', 'Needs improvement', 'Meets expectations', 'Exceeds expectations', 'Outstanding'][n]}</option>)}</Select></Field>
          <Field label="Strengths" className="col-span-2"><Textarea {...form.register('strengths')} /></Field>
          <Field label="Areas to improve" className="col-span-2"><Textarea {...form.register('improvements')} /></Field>
          <Field label="Goals for next period" className="col-span-2"><Textarea {...form.register('goals')} /></Field>
        </div>
      </Dialog>
    </Card>
  );
}

interface RegisterRow {
  employeeId: string;
  employeeNo: string;
  name: string;
  designation: string;
  departmentName?: string;
  record: AttendanceRecord | null;
}

function AttendanceTab() {
  const qc = useQueryClient();
  const { data: depts } = useDepartments();
  const [date, setDate] = useState(todayIso());
  const [departmentId, setDepartmentId] = useState('');
  const [editing, setEditing] = useState<RegisterRow | null>(null);
  const { data, isFetching } = useQuery({ queryKey: ['attendance-day', date, departmentId], queryFn: () => api.get<RegisterRow[]>('/hr/attendance/day', { date, departmentId }) });
  const close = useMutation({
    mutationFn: () => api.post<{ marked: number } & Record<string, number>>('/hr/attendance/close-day', { date }),
    onSuccess: (r) => {
      toast.success(r.marked ? `Day closed: ${r.marked} record(s) marked (${Object.entries(r).filter(([k]) => !['marked', 'date'].includes(k)).map(([k, v]) => `${v} ${humanize(k).toLowerCase()}`).join(', ')})` : 'Everyone already has a record for this day');
      qc.invalidateQueries({ queryKey: ['attendance-day'] });
    },
    onError: (e) => handleFormError(e),
  });
  const counts = (data ?? []).reduce<Record<string, number>>((m, r) => ((m[r.record?.status ?? 'NoRecord'] = (m[r.record?.status ?? 'NoRecord'] ?? 0) + 1), m), {});
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} className="w-40" />
        <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="w-48"><option value="">All departments</option>{depts?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select>
        <div className="flex flex-1 flex-wrap gap-1.5 text-xs">{Object.entries(counts).map(([s, n]) => <Badge key={s} tone={s === 'NoRecord' ? 'neutral' : s === 'Absent' ? 'danger' : s === 'Late' ? 'warn' : 'ok'}>{humanize(s)} {n}</Badge>)}</div>
        <Button variant="outline" icon={<Lock className="h-4 w-4" />} loading={close.isPending} onClick={() => close.mutate()}>Close day</Button>
      </div>
      <DataTable
        loading={isFetching}
        rows={data}
        rowKey={(r) => r.employeeId}
        empty={{ title: 'No employees' }}
        columns={[
          { key: 'n', header: 'Employee', cell: (r) => <div><p className="font-medium">{r.name}</p><p className="text-[11px] text-muted">{r.employeeNo} · {r.designation}</p></div> },
          { key: 'd', header: 'Department', cell: (r) => <span className="text-xs">{r.departmentName}</span>, hideOnMobile: true },
          { key: 'i', header: 'In', cell: (r) => <span className="num text-xs">{formatTime(r.record?.clockIn) || '—'}</span> },
          { key: 'o', header: 'Out', cell: (r) => <span className="num text-xs">{formatTime(r.record?.clockOut) || '—'}</span> },
          { key: 'w', header: 'Worked', cell: (r) => <span className="num text-xs">{hours(r.record?.workedMinutes)}</span>, hideOnMobile: true },
          { key: 'l', header: 'Late / OT', cell: (r) => <span className="num text-xs">{r.record?.lateMinutes ? `${r.record.lateMinutes}m late` : ''}{r.record?.overtimeMinutes ? ` ${hours(r.record.overtimeMinutes)} OT` : ''}</span>, hideOnMobile: true },
          { key: 's', header: 'Status', cell: (r) => (r.record ? <div><StatusBadge status={r.record.status} />{r.record.source === 'Manual' && <p className="mt-0.5 text-[11px] text-muted" title={r.record.note}>manual</p>}</div> : <span className="text-xs text-muted">No record</span>) },
          { key: 'a', header: '', cell: (r) => <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Correct</Button> },
        ]}
      />
      <ManualEntryDialog row={editing} date={date} onClose={() => setEditing(null)} />
    </Card>
  );
}

function ManualEntryDialog({ row, date, onClose }: { row: RegisterRow | null; date: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'times' | 'status'>('times');
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [status, setStatus] = useState('Absent');
  const [note, setNote] = useState('');
  const t = (d?: string) => (d ? new Date(d).toTimeString().slice(0, 5) : '');
  useEffect(() => {
    if (row) {
      setClockIn(t(row.record?.clockIn));
      setClockOut(t(row.record?.clockOut));
      setMode(row.record && !row.record.clockIn ? 'status' : 'times');
      setStatus(row.record?.status && !row.record.clockIn ? row.record.status : 'Absent');
      setNote('');
    }
  }, [row]);
  const m = useMutation({
    mutationFn: () => api.post('/hr/attendance/manual', { employeeId: row!.employeeId, date, note, ...(mode === 'times' ? { clockIn, clockOut: clockOut || undefined } : { status }) }),
    onSuccess: () => { toast.success('Attendance updated'); qc.invalidateQueries({ queryKey: ['attendance-day'] }); onClose(); },
    onError: (e) => handleFormError(e),
  });
  return (
    <Dialog open={!!row} onClose={onClose} title={`Attendance · ${row?.name ?? ''}`} description={`${formatDate(date)} — every correction is audited with its reason.`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={note.trim().length < 3 || (mode === 'times' && !clockIn)} loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        <Tabs tabs={[{ key: 'times', label: 'Punch times' }, { key: 'status', label: 'Status only' }]} value={mode} onChange={setMode} />
        {mode === 'times' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Clock in" required><Input type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} /></Field>
            <Field label="Clock out"><Input type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} /></Field>
          </div>
        ) : (
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{['Absent', 'OnLeave', 'WeeklyOff', 'Holiday'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
        )}
        <Field label="Reason" required><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Badge reader fault, approved by supervisor" /></Field>
      </div>
    </Dialog>
  );
}

function SummaryTab() {
  const { data: depts } = useDepartments();
  const [period, setPeriod] = useState(todayIso().slice(0, 7));
  const [departmentId, setDepartmentId] = useState('');
  const { data, isFetching } = useQuery({ queryKey: ['attendance-summary', period, departmentId], queryFn: () => api.get<{ period: string; workingDays: number; rows: AttendanceSummaryRow[] }>('/hr/attendance/summary', { period, departmentId }) });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <Input type="month" value={period} max={todayIso().slice(0, 7)} onChange={(e) => setPeriod(e.target.value)} className="w-40" />
        <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="w-48"><option value="">All departments</option>{depts?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select>
        {data && <span className="text-xs text-muted">{data.workingDays} working days in {formatDate(`${period}-01`, { month: 'long', year: 'numeric' })}</span>}
      </div>
      <DataTable
        loading={isFetching}
        rows={data?.rows}
        rowKey={(r) => r.employeeId}
        empty={{ title: 'No attendance for this month' }}
        columns={[
          { key: 'n', header: 'Employee', cell: (r) => <div><p className="font-medium">{r.name}</p><p className="text-[11px] text-muted">{r.employeeNo} · {r.department}</p></div> },
          { key: 'p', header: 'Present', align: 'right', cell: (r) => r.present },
          { key: 'l', header: 'Late', align: 'right', cell: (r) => (r.late ? <span className="text-amber-600">{r.late}</span> : 0) },
          { key: 'h', header: 'Half', align: 'right', cell: (r) => r.halfDay, hideOnMobile: true },
          { key: 'a', header: 'Absent', align: 'right', cell: (r) => (r.absent ? <span className="text-red-600">{r.absent}</span> : 0) },
          { key: 'v', header: 'Leave', align: 'right', cell: (r) => r.onLeave },
          { key: 'lm', header: 'Late min', align: 'right', cell: (r) => r.lateMinutes, hideOnMobile: true },
          { key: 'ot', header: 'Overtime', align: 'right', cell: (r) => hours(r.overtimeMinutes), hideOnMobile: true },
          { key: 'w', header: 'Worked', align: 'right', cell: (r) => hours(r.workedMinutes), hideOnMobile: true },
        ]}
      />
    </Card>
  );
}

/** HR leave desk: requests that cleared the manager, plus full history. */
export function LeaveApprovalsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('PendingHR');
  const [page, setPage] = useState(1);
  const [deciding, setDeciding] = useState<{ leave: LeaveRequest; approve: boolean } | null>(null);
  const { data, isFetching } = useQuery({ queryKey: ['leave', 'hr', status, page], queryFn: () => api.get<Paged<LeaveRequest>>('/hr/leave', { scope: 'all', status, page, pageSize: 25 }), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="Leave approvals" description="Requests approved by the reporting manager come here for the HR decision. Approval deducts the balance and marks the days as leave." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-52">
            <option value="">All requests</option>
            {LEAVE_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
        </div>
        {isFetching && !data ? <PageLoader /> : (
          <LeaveTable
            showEmployee
            rows={data?.items}
            actions={(l) =>
              l.status === 'PendingHR' ? (
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => setDeciding({ leave: l, approve: true })}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => setDeciding({ leave: l, approve: false })}>Reject</Button>
                </div>
              ) : null
            }
          />
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
      <LeaveDecisionDialog value={deciding} stage="hr" onClose={() => setDeciding(null)} onDone={() => qc.invalidateQueries({ queryKey: ['leave'] })} />
    </>
  );
}

export function LeaveDecisionDialog({ value, stage, onClose, onDone }: { value: { leave: LeaveRequest; approve: boolean } | null; stage: 'manager' | 'hr'; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  useEffect(() => setNote(''), [value]);
  const m = useMutation({
    mutationFn: () => api.post(`/hr/leave/${value!.leave._id}/${stage}-decision`, { approve: value!.approve, note: note || undefined }),
    onSuccess: () => { toast.success(value!.approve ? (stage === 'manager' ? 'Approved; sent to HR' : 'Leave approved') : 'Leave rejected'); onDone(); onClose(); },
    onError: (e) => handleFormError(e),
  });
  const l = value?.leave;
  return (
    <Dialog open={!!value} onClose={onClose} title={value?.approve ? 'Approve leave' : 'Reject leave'} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={value?.approve ? 'primary' : 'danger'} disabled={!value?.approve && note.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>{value?.approve ? 'Approve' : 'Reject'}</Button></>}>
      {l && <p className="mb-3 text-sm">{l.employeeName}: <b>{l.type}</b> leave {formatDate(l.from)} – {formatDate(l.to)} ({l.days} day{l.days === 1 ? '' : 's'}) — “{l.reason}”</p>}
      <Field label={value?.approve ? 'Note (optional)' : 'Reason for rejecting'} required={!value?.approve}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Dialog>
  );
}
