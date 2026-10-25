import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, FileSpreadsheet, FileText, Play, Printer, Sheet } from 'lucide-react';
import { BRAND, type ReportColumn, type ReportDefinition, type ReportResult } from '@hms/shared';
import { api, openPdf, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatDateTime, money, todayIso } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, Input, PageHeader, PageLoader, Select } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data';
import { Field, handleFormError } from '@/components/form/Field';
import type { Department, Doctor } from '@/types';

const SERIES = BRAND.chartSeries;
const tooltipStyle = { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 8, fontSize: 12, color: 'rgb(var(--fg))' };

const shift = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString('en-CA');
const PRESETS: Array<[string, string, () => [string, string]]> = [
  ['today', 'Today', () => [todayIso(), todayIso()]],
  ['7d', 'Last 7 days', () => [shift(-6), todayIso()]],
  ['month', 'This month', () => [`${todayIso().slice(0, 7)}-01`, todayIso()]],
  ['lastMonth', 'Last month', () => {
    const d = new Date();
    const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const last = new Date(d.getFullYear(), d.getMonth(), 0);
    return [first.toLocaleDateString('en-CA'), last.toLocaleDateString('en-CA')];
  }],
  ['90d', 'Last 90 days', () => [shift(-89), todayIso()]],
  ['year', 'This year', () => [`${todayIso().slice(0, 4)}-01-01`, todayIso()]],
];

function fmt(v: string | number | null | undefined, c: ReportColumn, currency?: string) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') {
    if (c.type === 'money') return money(v, currency);
    if (c.type === 'percent') return `${v}%`;
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  if (c.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
  return v;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Print view in its own window: just the report, with the hospital letterhead. */
function printReport(r: ReportResult, hospital: string, currency?: string) {
  const w = window.open('', '_blank');
  if (!w) return;
  const num = (c: ReportColumn) => ['number', 'money', 'percent'].includes(c.type ?? '');
  const head = r.columns.map((c) => `<th class="${num(c) ? 'n' : ''}">${escapeHtml(c.label)}</th>`).join('');
  const row = (x: Record<string, string | number | null>, cls = '') => `<tr class="${cls}">${r.columns.map((c) => `<td class="${num(c) ? 'n' : ''}">${escapeHtml(String(fmt(x[c.key], c, currency)))}</td>`).join('')}</tr>`;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(r.title)}</title><style>
    body{font:12px system-ui,sans-serif;color:#0B1F44;margin:24px} h1{font-size:16px;margin:0;color:#1A56DB} h2{font-size:14px;margin:12px 0 2px}
    p{margin:0;color:#64748b} table{border-collapse:collapse;width:100%;margin-top:12px} th,td{padding:4px 6px;border-bottom:1px solid #e2e8f0;text-align:left}
    th{background:#f1f5f9;font-size:11px} .n{text-align:right} tr.t td{font-weight:700;border-top:2px solid #94a3b8} @page{size:auto;margin:12mm}
  </style></head><body><h1>${escapeHtml(hospital)}</h1><h2>${escapeHtml(r.title)}</h2><p>${escapeHtml(r.subtitle)} · generated ${escapeHtml(formatDateTime(r.generatedAt))}</p>
  <table><thead><tr>${head}</tr></thead><tbody>${r.rows.map((x) => row(x)).join('')}${r.totals ? row(r.totals, 't') : ''}</tbody></table></body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

/** Report centre: pick a report, filter by dates / department / doctor, view, chart, export or print. */
export function ReportsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const key = params.get('report') ?? '';
  const [preset, setPreset] = useState('month');
  const [[from, to], setRange] = useState<[string, string]>(PRESETS[2][2]());
  const [departmentId, setDepartmentId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [submitted, setSubmitted] = useState<Record<string, string> | null>(null);
  const { data: catalogue, isLoading } = useQuery({ queryKey: ['reports'], queryFn: () => api.get<ReportDefinition[]>('/reports') });
  const { data: depts } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/admin/departments'), staleTime: 300_000 });
  const { data: doctors } = useQuery({ queryKey: ['doctors'], queryFn: () => api.get<Doctor[]>('/admin/doctors'), staleTime: 300_000 });
  const def = catalogue?.find((r) => r.key === key);
  const filters = useMemo(() => {
    if (!def) return {};
    const f: Record<string, string> = {};
    if (def.filters.includes('dateRange')) Object.assign(f, { from, to });
    if (def.filters.includes('department') && departmentId) f.departmentId = departmentId;
    if (def.filters.includes('doctor') && doctorId) f.doctorId = doctorId;
    return f;
  }, [def, from, to, departmentId, doctorId]);
  const { data: result, isFetching, error } = useQuery({
    queryKey: ['report', key, submitted],
    queryFn: () => api.get<ReportResult>(`/reports/${key}`, submitted ?? {}),
    enabled: !!def && !!submitted,
  });
  useEffect(() => {
    if (error) handleFormError(error);
  }, [error]);

  if (isLoading) return <PageLoader />;
  if (!catalogue?.length)
    return (
      <>
        <PageHeader title="Reports" />
        <Card><EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No reports available for your role" /></Card>
      </>
    );
  const categories = [...new Set(catalogue.map((r) => r.category))];
  const choose = (k: string) => {
    setParams({ report: k });
    setSubmitted(null);
  };
  const run = () => setSubmitted({ ...filters });
  const exportAs = async (format: 'xlsx' | 'csv' | 'pdf') => {
    const q = qs({ ...(submitted ?? filters), format });
    if (format === 'pdf') return openPdf(`/reports/${key}${q}`).catch((e) => handleFormError(e));
    try {
      const res = await fetch(`/api/reports/${key}${q}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Export failed');
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: `${key}-${todayIso()}.${format}` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      handleFormError(e);
    }
  };

  return (
    <>
      <PageHeader title="Reports" description="Operational, clinical, financial and HR reports with Excel, PDF and print export. Every run and export is recorded in the audit log." />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="h-max">
          {categories.map((c) => (
            <div key={c} className="border-b border-border p-2 last:border-0">
              <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{c}</p>
              {catalogue.filter((r) => r.category === c).map((r) => (
                <button key={r.key} type="button" onClick={() => choose(r.key)} className={cn('block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-subtle', key === r.key && 'bg-brand/10 font-medium text-brand')}>
                  {r.title}
                </button>
              ))}
            </div>
          ))}
        </Card>
        <div className="min-w-0 space-y-4">
          {!def ? (
            <Card><EmptyState icon={<BarChart3 className="h-5 w-5" />} title="Choose a report" description="Pick a report on the left, set the filters and run it." /></Card>
          ) : (
            <>
              <Card className="p-4">
                <p className="font-semibold">{def.title}</p>
                <p className="mb-3 text-xs text-muted">{def.description}</p>
                <div className="flex flex-wrap items-end gap-3">
                  {def.filters.includes('dateRange') && (
                    <>
                      <Field label="Period">
                        <Select value={preset} onChange={(e) => { setPreset(e.target.value); const p = PRESETS.find(([k]) => k === e.target.value); if (p) setRange(p[2]()); }} className="w-40">
                          {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          <option value="custom">Custom</option>
                        </Select>
                      </Field>
                      <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => { setPreset('custom'); setRange([e.target.value, to]); }} className="w-40" /></Field>
                      <Field label="To"><Input type="date" value={to} min={from} max={todayIso()} onChange={(e) => { setPreset('custom'); setRange([from, e.target.value]); }} className="w-40" /></Field>
                    </>
                  )}
                  {def.filters.includes('department') && (
                    <Field label="Department"><Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="w-48"><option value="">All departments</option>{depts?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
                  )}
                  {def.filters.includes('doctor') && (
                    <Field label="Doctor"><Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="w-52"><option value="">All doctors</option>{doctors?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
                  )}
                  <Button icon={<Play className="h-4 w-4" />} loading={isFetching} onClick={run}>Run report</Button>
                </div>
              </Card>
              {result && result.key === key && (
                <>
                  <Card>
                    <CardHeader
                      title={result.title}
                      description={`${result.subtitle} · ${result.rows.length} row(s) · generated ${formatDateTime(result.generatedAt)}`}
                      actions={
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="outline" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => exportAs('xlsx')}>Excel</Button>
                          <Button size="sm" variant="outline" icon={<FileText className="h-4 w-4" />} onClick={() => exportAs('pdf')}>PDF</Button>
                          <Button size="sm" variant="outline" icon={<Sheet className="h-4 w-4" />} onClick={() => exportAs('csv')}>CSV</Button>
                          <Button size="sm" variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => printReport(result, user?.hospital.name ?? 'Hospital', user?.hospital.currency)}>Print</Button>
                        </div>
                      }
                    />
                    {result.chart && result.rows.length > 1 && <ReportChart result={result} />}
                  </Card>
                  <Card className="overflow-x-auto">
                    <DataTable
                      rows={[...result.rows, ...(result.totals ? [{ ...result.totals, __total: 1 }] : [])].map((r, i) => ({ ...r, __i: i }))}
                      rowKey={(r) => String(r.__i)}
                      rowClassName={(r) => ((r as Record<string, unknown>).__total ? 'font-semibold bg-subtle' : undefined)}
                      empty={{ title: 'No data for these filters' }}
                      columns={result.columns.map((c) => ({ key: c.key, header: c.label, align: ['number', 'money', 'percent'].includes(c.type ?? '') ? 'right' : 'left', cell: (r: Record<string, string | number | null>) => <span className="whitespace-nowrap">{fmt(r[c.key], c, user?.hospital.currency)}</span> }))}
                    />
                  </Card>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ReportChart({ result }: { result: ReportResult }) {
  const chart = result.chart!;
  const label = (k: string) => result.columns.find((c) => c.key === k)?.label ?? k;
  const data = result.rows.slice(0, 40);
  const xFmt = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v, { day: '2-digit', month: 'short' }) : String(v).replace('Dr. ', '').split(' ').slice(0, 2).join(' '));
  return (
    <div className="p-3">
      <ResponsiveContainer width="100%" height={260}>
        {chart.type === 'line' ? (
          <LineChart data={data} margin={{ left: -10, right: 8, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
            <XAxis dataKey={chart.x} tickFormatter={xFmt} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {chart.series.map((s, i) => <Line key={s} type="monotone" dataKey={s} name={label(s)} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={false} />)}
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ left: -10, right: 8, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
            <XAxis dataKey={chart.x} tickFormatter={xFmt} interval={0} tick={{ fontSize: 10, fill: 'rgb(var(--muted))' }} />
            <YAxis tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} tickFormatter={(v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v)} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgb(var(--subtle))' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {chart.series.map((s, i) => <Bar key={s} dataKey={s} name={label(s)} fill={SERIES[i % SERIES.length]} radius={[3, 3, 0, 0]} />)}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
