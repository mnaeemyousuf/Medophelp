import { lazy, useState, type ComponentType } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, BedDouble, CalendarDays, CircleDollarSign, ClipboardCheck, FlaskConical, HeartPulse, Pill, Receipt, Siren, Stethoscope, UserPlus, Users, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, money, todayIso } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, Input, PageHeader, PageLoader, Select } from '@/components/ui/primitives';
import { StatCard } from '@/components/ui/data';
import { StatusBadge, TriageBadge } from '@/components/ui/badge';
import type { Appointment } from '@/types';
import { LabDashboard, PharmacyDashboard, StoresDashboard, useDoctorLabs } from './OperationsDashboards';
import { ConsentCard } from '@/pages/patients/ConsentCard';
import { BRAND } from '@hms/shared';

const PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'This week'],
  ['month', 'This month'],
  ['lastMonth', 'Last month'],
  ['custom', 'Custom range'],
] as const;

// Validated categorical palette (works on light and dark surfaces).
const SERIES = BRAND.chartSeries;

interface Summary {
  range: { from: string; to: string };
  kpis: Record<string, number | null>;
  charts: {
    patientInflow?: Array<{ date: string; visits: number; registrations: number }>;
    opdVsIpd?: Array<{ type: string; count: number }>;
    doctorAppointments?: Array<{ doctor: string; total: number; completed: number }>;
    appointmentStatus?: Array<{ status: string; count: number }>;
    revenueByDepartment?: Array<{ department: string; amount: number }>;
    revenueByDay?: Array<{ date: string; amount: number }>;
    labTurnaround?: Array<{ test: string; avgHours: number; count: number }> | null;
    pharmacyStock?: Array<{ category: string; items: number; value: number; low: number }> | null;
    medicineExpiry?: Array<{ month: string; batches: number; units: number }> | null;
    emergencyCases?: Array<{ date: string; Critical?: number; Urgent?: number; SemiUrgent?: number; NonUrgent?: number; Untriaged?: number }> | null;
    emergencyResponse?: Array<{ level: string; avgMinutes: number; cases: number }> | null;
    bedOccupancy?: Record<string, number> | null;
    [k: string]: unknown;
  };
}

/** Picks the dashboard that fits the user's role, based on permissions rather than role names. */
export function DashboardPage() {
  const { user, can } = useAuth();
  if (user?.patientId) return <PatientDashboard />;
  if (can('dashboard.executive', 'dashboard.financial')) return <ExecutiveDashboard />;
  if (can('clinical.queue')) return <DoctorDashboard />;
  if (can('nursing.queue')) return <FrontDeskDashboard nurse />;
  if (can('lab.process', 'lab.verify')) return <LabDashboard />;
  if (can('pharmacy.dispense')) return <PharmacyDashboard />;
  if (can('inventory.manage', 'purchasing.manage', 'purchasing.approve')) return <StoresDashboard />;
  if (can('appointments.manage')) return <FrontDeskDashboard />;
  if (can('hr.employees')) return <HrDashboard />;
  if (can('payroll.manage')) return <PayrollPage />;
  if (can('recruitment.manage')) return <RecruitmentPage />;
  if (can('self.service')) return <MyWorkspacePage />;
  return (
    <>
      <PageHeader title={`Welcome, ${user?.fullName}`} />
      <Card>
        <EmptyState icon={<Activity className="h-5 w-5" />} title="Nothing to show yet" description="Use the menu to reach the areas you have access to." />
      </Card>
    </>
  );
}

const lazyNamed = <M,>(load: () => Promise<M>, name: keyof M) => lazy(() => load().then((m) => ({ default: m[name] as unknown as ComponentType })));
const HrDashboard = lazyNamed(() => import('@/pages/hr/HrPages'), 'HrDashboard');
const PayrollPage = lazyNamed(() => import('@/pages/payroll/PayrollPages'), 'PayrollPage');
const RecruitmentPage = lazyNamed(() => import('@/pages/recruitment/RecruitmentPages'), 'RecruitmentPage');
const MyWorkspacePage = lazyNamed(() => import('@/pages/hr/MyWorkspacePage'), 'MyWorkspacePage');

function ExecutiveDashboard() {
  const { user, can } = useAuth();
  const [preset, setPreset] = useState<string>('month');
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', preset, from, to],
    queryFn: () => api.get<Summary>('/dashboard/summary', { preset, ...(preset === 'custom' ? { from, to } : {}) }),
  });
  const cur = user?.hospital.currency ?? 'PKR';
  const k = data?.kpis ?? {};
  const exec = can('dashboard.executive');

  return (
    <>
      <PageHeader
        title="Hospital overview"
        description={data ? `${formatDate(data.range.from)} – ${formatDate(data.range.to)}` : ' '}
        actions={
          <>
            <Select value={preset} onChange={(e) => setPreset(e.target.value)} className="w-40">
              {PRESETS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            {preset === 'custom' && (
              <>
                <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
                <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
              </>
            )}
          </>
        }
      />
      {isLoading ? (
        <PageLoader />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {exec && (
              <>
                <StatCard label="Total patients" value={k.totalPatients?.toLocaleString()} hint={`${k.newPatients ?? 0} new in period`} icon={<Users className="h-4 w-4" />} />
                <StatCard label="Today's appointments" value={k.todaysAppointments} icon={<CalendarDays className="h-4 w-4" />} tone="info" />
                <StatCard label="Today's admissions" value={k.todaysAdmissions} unavailable={k.todaysAdmissions === null} icon={<BedDouble className="h-4 w-4" />} tone="violet" />
                <StatCard label="Today's discharges" value={k.todaysDischarges} unavailable={k.todaysDischarges === null} icon={<BedDouble className="h-4 w-4" />} tone="violet" />
                <StatCard label="Emergency cases" value={k.emergencyCases} unavailable={k.emergencyCases === null} icon={<Siren className="h-4 w-4" />} tone="danger" />
                <StatCard label="Pending lab tests" value={k.pendingLabTests} unavailable={k.pendingLabTests === null} icon={<FlaskConical className="h-4 w-4" />} tone="warn" />
                <StatCard label="Pending prescriptions" value={k.pendingPrescriptions} hint="Awaiting dispensing" icon={<Pill className="h-4 w-4" />} tone="warn" />
                <StatCard label="Low-stock medicines" value={k.lowStockMedicines} unavailable={k.lowStockMedicines === null} icon={<Pill className="h-4 w-4" />} tone="danger" />
              </>
            )}
            <StatCard label="Outstanding payments" value={money(k.outstandingAmount, cur)} hint={`${k.outstandingInvoices ?? 0} open invoices`} icon={<Wallet className="h-4 w-4" />} tone="warn" />
            <StatCard label="Today's revenue" value={money(k.todaysRevenue, cur)} hint="Collected today, net of refunds" icon={<CircleDollarSign className="h-4 w-4" />} tone="ok" />
            <StatCard label="Revenue in period" value={money(k.revenue, cur)} hint="Payments net of refunds" icon={<CircleDollarSign className="h-4 w-4" />} tone="ok" />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            {data?.charts.patientInflow && (
              <ChartCard title="Patient inflow" description="Visits and new registrations per day" className="xl:col-span-2">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={data.charts.patientInflow} margin={{ left: -20, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="gV" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(d) => formatDate(d, { day: '2-digit', month: 'short' })} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(d) => formatDate(d as string)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="visits" name="Visits" stroke={SERIES[0]} fill="url(#gV)" strokeWidth={2} />
                    <Area type="monotone" dataKey="registrations" name="New registrations" stroke={SERIES[1]} fill="transparent" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {data?.charts.revenueByDepartment && (
              <ChartCard title="Revenue by department" description="Payments received in period">
                {data.charts.revenueByDepartment.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={data.charts.revenueByDepartment} dataKey="amount" nameKey="department" innerRadius={55} outerRadius={90} paddingAngle={2}>
                        {data.charts.revenueByDepartment.map((_, i) => (
                          <Cell key={i} fill={SERIES[i % SERIES.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => money(v, cur)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState title="No payments in this period" />
                )}
              </ChartCard>
            )}
            {data?.charts.doctorAppointments && (
              <ChartCard title="Doctor appointments" description="Booked vs completed" className="xl:col-span-2">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.charts.doctorAppointments} margin={{ left: -20, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
                    <XAxis dataKey="doctor" tick={{ fontSize: 10, fill: 'rgb(var(--muted))' }} tickFormatter={(n: string) => n.replace('Dr. ', '')} interval={0} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgb(var(--subtle))' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="total" name="Booked" fill={SERIES[1]} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="completed" name="Completed" fill={SERIES[0]} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {data?.charts.opdVsIpd && (
              <ChartCard title="OPD vs IPD vs Emergency" description="Visits in period">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.charts.opdVsIpd} layout="vertical" margin={{ left: 10, right: 16 }}>
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                    <YAxis type="category" dataKey="type" tick={{ fontSize: 12, fill: 'rgb(var(--muted))' }} width={70} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgb(var(--subtle))' }} />
                    <Bar dataKey="count" name="Visits" radius={[0, 3, 3, 0]}>
                      {data.charts.opdVsIpd.map((_, i) => (
                        <Cell key={i} fill={SERIES[i]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {data?.charts.revenueByDay && (
              <ChartCard title="Daily collections" description="Payments received per day" className={exec ? 'xl:col-span-3' : 'xl:col-span-2'}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.charts.revenueByDay} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(d) => formatDate(d, { day: '2-digit', month: 'short' })} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => money(v, cur)} labelFormatter={(d) => formatDate(d as string)} cursor={{ fill: 'rgb(var(--subtle))' }} />
                    <Bar dataKey="amount" name="Collected" fill={SERIES[0]} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {data?.charts.labTurnaround && (
              <ChartCard title="Lab turnaround" description="Average hours order → verified, last 30 days">
                {data.charts.labTurnaround.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.charts.labTurnaround} layout="vertical" margin={{ left: 10, right: 16 }}>
                      <XAxis type="number" tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} unit=" h" />
                      <YAxis type="category" dataKey="test" width={120} tick={{ fontSize: 10, fill: 'rgb(var(--muted))' }} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v} h`} cursor={{ fill: 'rgb(var(--subtle))' }} />
                      <Bar dataKey="avgHours" name="Avg hours" fill={SERIES[3]} radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState title="No verified results yet" />
                )}
              </ChartCard>
            )}
            {data?.charts.pharmacyStock && (
              <ChartCard title="Stock value by category" description="On-hand quantity × purchase price">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.charts.pharmacyStock} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
                    <XAxis dataKey="category" tick={{ fontSize: 10, fill: 'rgb(var(--muted))' }} interval={0} tickFormatter={(c: string) => c.split(' ')[0]} />
                    <YAxis tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n) => (n === 'Stock value' ? money(v, cur) : v)} cursor={{ fill: 'rgb(var(--subtle))' }} />
                    <Bar dataKey="value" name="Stock value" fill={SERIES[1]} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {data?.charts.medicineExpiry && (
              <ChartCard title="Medicine expiry" description="Batches expiring per month, next 6 months">
                {data.charts.medicineExpiry.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.charts.medicineExpiry} margin={{ left: -20, right: 8, top: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} tickFormatter={(m: string) => formatDate(`${m}-01`, { month: 'short', year: '2-digit' })} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={(m) => formatDate(`${m}-01`, { month: 'long', year: 'numeric' })} cursor={{ fill: 'rgb(var(--subtle))' }} />
                      <Bar dataKey="batches" name="Batches" fill={SERIES[2]} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState title="Nothing expiring in the next 6 months" />
                )}
              </ChartCard>
            )}
            {data?.charts.emergencyCases && (
              <ChartCard title="Emergency cases" description="Arrivals per day by triage level" className="xl:col-span-2">
                {data.charts.emergencyCases.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.charts.emergencyCases} margin={{ left: -20, right: 8, top: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={(d) => formatDate(d, { day: '2-digit', month: 'short' })} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={(d) => formatDate(d as string)} cursor={{ fill: 'rgb(var(--subtle))' }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {(['Critical', 'Urgent', 'SemiUrgent', 'NonUrgent', 'Untriaged'] as const).map((l) => (
                        <Bar key={l} dataKey={l} name={l === 'SemiUrgent' ? 'Semi-urgent' : l === 'NonUrgent' ? 'Non-urgent' : l} stackId="er" fill={TRIAGE_COLORS[l]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState title="No emergency arrivals in this period" />
                )}
                {!!data.charts.emergencyResponse?.length && (
                  <p className="mt-2 px-1 text-xs text-muted">
                    Average door-to-doctor: {data.charts.emergencyResponse.map((r) => `${r.level === 'SemiUrgent' ? 'Semi-urgent' : r.level === 'NonUrgent' ? 'Non-urgent' : r.level} ${r.avgMinutes} min`).join(' · ')}
                  </p>
                )}
              </ChartCard>
            )}
            {data?.charts.bedOccupancy && (
              <ChartCard title="Bed status" description={`${k.inpatients ?? 0} inpatients · ${k.bedOccupancyPct ?? 0}% occupancy`}>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={Object.entries(data.charts.bedOccupancy).map(([status, n]) => ({ status, n }))} dataKey="n" nameKey="status" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {Object.keys(data.charts.bedOccupancy).map((s) => <Cell key={s} fill={BED_COLORS[s] ?? SERIES[5]} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>
          {exec && !!data?.charts.staffAttendance && (
            <ChartCard title="Staff attendance" description="Last 14 days by status" className="mt-4">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.charts.staffAttendance as Array<Record<string, number | string>>} margin={{ left: -20, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(d) => formatDate(d, { day: '2-digit', month: 'short' })} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(d) => formatDate(d as string)} cursor={{ fill: 'rgb(var(--subtle))' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="present" name="On time" stackId="a" fill={SERIES[0]} />
                  <Bar dataKey="late" name="Late / half day" stackId="a" fill={SERIES[2]} />
                  <Bar dataKey="onLeave" name="On leave" stackId="a" fill={SERIES[1]} />
                  <Bar dataKey="absent" name="Absent" stackId="a" fill="#dc2626" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </>
      )}
    </>
  );
}

const TRIAGE_COLORS = { Critical: '#dc2626', Urgent: '#f97316', SemiUrgent: '#fbbf24', NonUrgent: '#059669', Untriaged: '#94a3b8' } as const;
const BED_COLORS: Record<string, string> = { Available: '#16a34a', Occupied: '#7c3aed', Reserved: '#2563eb', Cleaning: '#d97706', Maintenance: '#94a3b8' };

const tooltipStyle = { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 8, fontSize: 12, color: 'rgb(var(--fg))' };

function ChartCard({ title, description, className, children }: { title: string; description?: string; className?: string; children: React.ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} />
      <div className="p-3">{children}</div>
    </Card>
  );
}

interface FrontDesk {
  registeredToday: number;
  scheduled: number;
  checkedIn: number;
  inNursing: number;
  waitingForDoctor: number;
  inConsultation: number;
  completed: number;
  cancelled: number;
  noShow: number;
}

function FrontDeskDashboard({ nurse }: { nurse?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['front-desk'], queryFn: () => api.get<FrontDesk>('/dashboard/front-desk'), refetchInterval: 30_000 });
  const { data: appts } = useQuery({
    queryKey: ['appointments', 'today-desk'],
    queryFn: () => api.get<{ items: Appointment[] }>('/appointments', { from: todayIso(), to: todayIso(), pageSize: 100 }),
    refetchInterval: 30_000,
  });
  const queue = (appts?.items ?? []).filter((a) => (nurse ? ['CheckedIn', 'NurseAssessment'] : ['Scheduled', 'Confirmed']).includes(a.status));

  return (
    <>
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${user?.fullName.split(' ')[0]}`}
        description={nurse ? 'Patients waiting for nursing assessment' : "Today's front desk"}
        actions={
          nurse ? (
            <Button icon={<HeartPulse className="h-4 w-4" />} onClick={() => navigate('/nursing')}>Open nursing queue</Button>
          ) : (
            <>
              <Button variant="outline" icon={<CalendarDays className="h-4 w-4" />} onClick={() => navigate('/appointments?book=1')}>Book appointment</Button>
              <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => navigate('/patients/new')}>Register patient</Button>
            </>
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {!nurse && <StatCard label="Registered today" value={data?.registeredToday ?? '…'} icon={<UserPlus className="h-4 w-4" />} />}
        <StatCard label="Yet to arrive" value={data?.scheduled ?? '…'} icon={<CalendarDays className="h-4 w-4" />} tone="info" />
        <StatCard label="Waiting for nurse" value={data ? data.checkedIn + data.inNursing : '…'} icon={<HeartPulse className="h-4 w-4" />} tone="warn" />
        <StatCard label="Ready for doctor" value={data?.waitingForDoctor ?? '…'} icon={<Stethoscope className="h-4 w-4" />} tone="violet" />
        {nurse && <StatCard label="Seen today" value={data?.completed ?? '…'} icon={<ClipboardCheck className="h-4 w-4" />} tone="ok" />}
      </div>
      <Card className="mt-4">
        <CardHeader title={nurse ? 'Assessment queue' : 'Arrivals expected'} actions={<Link to={nurse ? '/nursing' : '/appointments'} className="text-xs text-brand hover:underline">View all</Link>} />
        {queue.length ? (
          <ul className="divide-y divide-border">
            {queue.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="num w-12 text-muted">{a.startTime}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.patient.name}</span>
                  <span className="block text-xs text-muted">{a.patient.mrn} · {a.doctor.name}</span>
                </span>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nobody waiting right now" />
        )}
      </Card>
    </>
  );
}

function DoctorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['doctor-queue'],
    queryFn: () => api.get<{ waiting: Appointment[]; inConsultation: Appointment[]; upcoming: Appointment[]; completed: Appointment[] }>('/clinical/doctor/queue'),
    refetchInterval: 20_000,
  });
  const labs = useDoctorLabs();
  const total = data ? data.waiting.length + data.inConsultation.length + data.upcoming.length + data.completed.length : 0;
  return (
    <>
      <PageHeader title={`Good day, ${user?.fullName}`} description="Your clinic today" actions={<Button icon={<Stethoscope className="h-4 w-4" />} onClick={() => navigate('/doctor')}>Open consultation queue</Button>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Today's appointments" value={total} icon={<CalendarDays className="h-4 w-4" />} tone="info" />
        <StatCard label="Waiting for you" value={data?.waiting.length ?? '…'} icon={<HeartPulse className="h-4 w-4" />} tone="warn" />
        <StatCard label="In consultation" value={data?.inConsultation.length ?? '…'} icon={<Stethoscope className="h-4 w-4" />} />
        <StatCard label="Completed" value={data?.completed.length ?? '…'} icon={<ClipboardCheck className="h-4 w-4" />} tone="ok" />
        <StatCard label="Lab results to review" value={labs.toReview.length} hint={`${labs.pending.length} still in the lab`} icon={<FlaskConical className="h-4 w-4" />} tone="violet" />
      </div>
      <Card className="mt-4">
        <CardHeader title="Ready for consultation" description="Assessed by nursing, in arrival order" />
        {data?.waiting.length ? (
          <ul className="divide-y divide-border">
            {data.waiting.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="num flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">{a.tokenNumber}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium">{a.patient.name}</span>
                  <span className="text-xs text-muted">{a.patient.mrn} · {a.reason}</span>
                </span>
                <Button size="sm" onClick={() => navigate(`/doctor/consult/${a.id}`)}>See patient</Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No patients waiting" description="Patients appear here once nursing submits their assessment." />
        )}
      </Card>
      <EmergencyAlerts />
      {!!data?.upcoming.length && (
        <Card className="mt-4">
          <CardHeader title="Later today" description="Booked, not yet arrived or with nursing" />
          <ul className="divide-y divide-border">
            {data.upcoming.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="num w-12 text-muted">{a.startTime}</span>
                <Link to={`/patients/${a.patient.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{a.patient.name}</Link>
                <span className="hidden text-xs text-muted sm:inline">{a.reason}</span>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {labs.panel}
    </>
  );
}

interface ErBoard {
  cases: Array<{ _id: string; caseNo: string; status: string; triageLevel?: string; presentingComplaint: string; assignedDoctorName?: string; waitingMinutes: number; breach: boolean; patient: { name: string; mrn: string } }>;
}

/** Critical and urgent emergency cases for clinicians who can see the ER (doctor portal "Emergency alerts"). */
function EmergencyAlerts() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['er-board'], queryFn: () => api.get<ErBoard>('/emergency/board'), enabled: can('emergency.view'), refetchInterval: 20_000 });
  if (!can('emergency.view')) return null;
  const urgent = (data?.cases ?? []).filter((c) => !c.triageLevel || ['Critical', 'Urgent'].includes(c.triageLevel));
  return (
    <Card className="mt-4">
      <CardHeader title="Emergency alerts" description="Critical, urgent and untriaged cases in the ER now" actions={<Link to="/emergency" className="text-xs text-brand hover:underline">Open ER board</Link>} />
      {urgent.length ? (
        <ul className="divide-y divide-border">
          {urgent.map((c) => (
            <li key={c._id} className={cn('flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-subtle', c.breach && 'bg-danger/[0.05]')} onClick={() => navigate(`/emergency/${c._id}`)}>
              <TriageBadge level={c.triageLevel} />
              <span className="min-w-0 flex-1 truncate"><span className="font-medium">{c.patient.name}</span> <span className="text-xs text-muted">· {c.presentingComplaint}</span></span>
              <span className={cn('num text-xs', c.breach ? 'font-semibold text-danger' : 'text-muted')}>{c.waitingMinutes} min</span>
              <span className="hidden text-xs text-muted sm:inline">{c.assignedDoctorName ?? 'Unassigned'}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Siren className="h-5 w-5" />} title="No critical or urgent cases" />
      )}
    </Card>
  );
}

function PatientDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: appts } = useQuery({ queryKey: ['portal-appts'], queryFn: () => api.get<{ items: Appointment[] }>('/appointments', { from: todayIso(), pageSize: 5 }) });
  const { data: bills } = useQuery({ queryKey: ['portal-bills'], queryFn: () => api.get<{ items: Array<{ _id: string; balance: number }>; totals: { balance: number } }>('/billing/invoices', { pageSize: 5 }) });
  const { data: meds } = useQuery({ queryKey: ['my-medicines'], queryFn: () => api.get<{ schedules: Array<{ status: string; today: Array<{ status: string; scheduledAt: string }> }>; adherence: number | null }>('/medications/mine') });
  const upcoming = (appts?.items ?? []).filter((a) => !['Cancelled', 'NoShow', 'Completed'].includes(a.status));
  const todayDoses = (meds?.schedules ?? []).filter((s) => s.status === 'Active').flatMap((s) => s.today);
  const pendingDoses = todayDoses.filter((d) => d.status === 'Pending').length;
  return (
    <>
      <PageHeader title={`Hello, ${user?.fullName.split(' ')[0]}`} description="Your health at a glance" actions={<Button icon={<CalendarDays className="h-4 w-4" />} onClick={() => navigate('/portal/appointments?book=1')}>Book appointment</Button>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Medicines today" value={`${todayDoses.length - pendingDoses} / ${todayDoses.length}`} hint={meds?.adherence != null ? `${meds.adherence}% adherence` : 'doses taken'} icon={<Pill className="h-4 w-4" />} tone={pendingDoses ? 'warn' : 'ok'} onClick={() => navigate('/portal/medications')} />
        <StatCard label="Upcoming appointments" value={upcoming.length} icon={<CalendarDays className="h-4 w-4" />} onClick={() => navigate('/portal/appointments')} />
        <StatCard label="Amount due" value={money(bills?.totals.balance, user?.hospital.currency)} icon={<Receipt className="h-4 w-4" />} tone="warn" onClick={() => navigate('/portal/bills')} />
        <StatCard label="Medical records" value="View" icon={<ClipboardCheck className="h-4 w-4" />} tone="ok" onClick={() => navigate('/portal/records')} />
      </div>
      <Card className="mt-4">
        <CardHeader title="Next appointments" />
        {upcoming.length ? (
          <ul className="divide-y divide-border">
            {upcoming.map((a) => (
              <li key={a.id} className={cn('flex items-center gap-3 px-4 py-3 text-sm')}>
                <span className="w-28 font-medium">{formatDate(a.date)}</span>
                <span className="num w-14 text-muted">{a.startTime}</span>
                <span className="flex-1">{a.doctor.name} · {a.department.name}</span>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No upcoming appointments" action={<Button size="sm" variant="outline" onClick={() => navigate('/portal/appointments?book=1')}>Book one now</Button>} />
        )}
      </Card>
      {user?.patientId && <div className="mt-4"><ConsentCard patientId={user.patientId} portal /></div>}
    </>
  );
}
