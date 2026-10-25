import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Save, ScrollText } from 'lucide-react';
import type { z } from 'zod';
import { EMPLOYMENT_TYPES, GENDERS, INVOICE_SOURCES, PAYMENT_METHODS, departmentSchema, hospitalSettingsSchema, serviceSchema, staffSchema } from '@hms/shared';
import { api, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDateTime, money, todayIso } from '@/lib/utils';
import { Button, Card, Input, PageHeader, PageLoader, Select } from '@/components/ui/primitives';
import { DataTable, Pagination, Tabs } from '@/components/ui/data';
import { Badge } from '@/components/ui/badge';
import { Dialog, Drawer } from '@/components/ui/overlay';
import { Field, FormSection, handleFormError } from '@/components/form/Field';
import type { Department, Doctor } from '@/types';

// ── Hospital settings ───────────────────────────────────────────────────────
type SettingsIn = z.input<typeof hospitalSettingsSchema>;
type SettingsOut = z.output<typeof hospitalSettingsSchema>;
const HR_DEFAULTS = { workStart: '09:00', workEnd: '17:00', graceMinutes: 10, halfDayMinutes: 240, weeklyOff: [7], holidays: [] as string[], leaveEntitlements: { Annual: 20, Sick: 10, Casual: 8, Maternity: 90, Other: 3 } };

export function HospitalSettingsPage() {
  const qc = useQueryClient();
  const { refetch } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['hospital'], queryFn: () => api.get<SettingsOut & { _id: string }>('/admin/hospital') });
  const form = useForm<SettingsIn, unknown, SettingsOut>({ resolver: zodResolver(hospitalSettingsSchema), values: data ? { ...data, hr: { ...HR_DEFAULTS, ...data.hr, leaveEntitlements: { ...HR_DEFAULTS.leaveEntitlements, ...data.hr?.leaveEntitlements } } } : undefined });
  const { register, formState: { errors, isSubmitting, isDirty } } = form;
  const weeklyOff = (form.watch('hr.weeklyOff') ?? []).map(Number);
  const holidays = (form.watch('hr.holidays') ?? []) as string[];
  const [holiday, setHoliday] = useState('');
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.put('/admin/hospital', v);
      toast.success('Settings saved');
      qc.invalidateQueries({ queryKey: ['hospital'] });
      qc.invalidateQueries({ queryKey: ['catalog'] });
      refetch();
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  if (isLoading) return <PageLoader />;
  return (
    <form onSubmit={submit} noValidate>
      <PageHeader title="Hospital settings" description="Branding, numbering formats, tax and notification channels. Nothing here is hard-coded." actions={<Button type="submit" icon={<Save className="h-4 w-4" />} disabled={!isDirty} loading={isSubmitting}>Save settings</Button>} />
      <Card className="p-5">
        <FormSection title="Hospital information">
          <Field label="Name" required error={errors.name}><Input {...register('name')} /></Field>
          <Field label="Short code" required error={errors.code} hint="Used in MRNs via {code}"><Input {...register('code')} /></Field>
          <Field label="Logo URL" error={errors.logoUrl}><Input placeholder="https://…" {...register('logoUrl')} /></Field>
          <Field label="Address" error={errors.address}><Input {...register('address')} /></Field>
          <Field label="City" error={errors.city}><Input {...register('city')} /></Field>
          <Field label="Phone" error={errors.phone}><Input {...register('phone')} /></Field>
          <Field label="Email" error={errors.email}><Input {...register('email')} /></Field>
          <Field label="Website" error={errors.website}><Input {...register('website')} /></Field>
        </FormSection>
        <FormSection title="Finance">
          <Field label="Currency (ISO)" required error={errors.currency}><Input maxLength={3} {...register('currency')} /></Field>
          <Field label="Default tax rate %" required error={errors.defaultTaxRate}><Input type="number" step="0.01" {...register('defaultTaxRate')} /></Field>
        </FormSection>
        <FormSection title="Numbering formats" description="Tokens: {code} hospital code, {yyyy} year, {yy}, {n:6} zero-padded sequence (resets yearly).">
          {(['mrn', 'invoice', 'receipt', 'prescription', 'emergency', 'labOrder', 'visit', 'appointment', 'purchaseOrder', 'goodsReceipt', 'dispense', 'admission', 'claim'] as const).map((k) => (
            <Field key={k} label={({ mrn: 'MRN', labOrder: 'Lab order', purchaseOrder: 'Purchase order', goodsReceipt: 'Goods receipt' } as Record<string, string>)[k] ?? k[0].toUpperCase() + k.slice(1)} error={errors.numbering?.[k]}>
              <Input className="font-mono" {...register(`numbering.${k}`)} />
            </Field>
          ))}
        </FormSection>
        <FormSection title="Working hours & leave policy" description="Used for attendance (late, half day, overtime), leave day counts and payroll. Individual employees can have their own shift.">
          <Field label="Shift start" error={errors.hr?.workStart}><Input type="time" {...register('hr.workStart')} /></Field>
          <Field label="Shift end" error={errors.hr?.workEnd}><Input type="time" {...register('hr.workEnd')} /></Field>
          <Field label="Grace minutes" hint="Arrivals within this are on time" error={errors.hr?.graceMinutes}><Input type="number" {...register('hr.graceMinutes')} /></Field>
          <Field label="Half-day below (minutes worked)" error={errors.hr?.halfDayMinutes}><Input type="number" {...register('hr.halfDayMinutes')} /></Field>
          <Field label="Weekly off days" className="sm:col-span-2">
            <div className="flex flex-wrap gap-3 pt-1">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
                <label key={d} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={weeklyOff.includes(i + 1)} onChange={(e) => form.setValue('hr.weeklyOff', e.target.checked ? [...weeklyOff, i + 1].sort() : weeklyOff.filter((x) => x !== i + 1), { shouldDirty: true })} /> {d}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Public holidays" className="sm:col-span-2" error={errors.hr?.holidays as never}>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input type="date" value={holiday} onChange={(e) => setHoliday(e.target.value)} className="w-44" />
                <Button type="button" variant="outline" size="sm" disabled={!holiday || holidays.includes(holiday)} onClick={() => { form.setValue('hr.holidays', [...holidays, holiday].sort(), { shouldDirty: true }); setHoliday(''); }}>Add</Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {holidays.map((h) => (
                  <button key={h} type="button" title="Remove" onClick={() => form.setValue('hr.holidays', holidays.filter((x) => x !== h), { shouldDirty: true })}>
                    <Badge>{h} ✕</Badge>
                  </button>
                ))}
                {!holidays.length && <span className="text-xs text-muted">None configured</span>}
              </div>
            </div>
          </Field>
          {(['Annual', 'Sick', 'Casual', 'Maternity', 'Other'] as const).map((t) => (
            <Field key={t} label={`${t} leave (days / year)`} error={errors.hr?.leaveEntitlements?.[t]}><Input type="number" {...register(`hr.leaveEntitlements.${t}`)} /></Field>
          ))}
        </FormSection>
        <CatalogSection form={form} />
        <IntegrationStatus />
        <FormSection title="Notification channels" description="In-app notifications are always on. External channels need provider credentials in the server environment.">
          {(['email', 'sms', 'push'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...register(`notifications.${k}`)} /> {k === 'sms' ? 'SMS' : k[0].toUpperCase() + k.slice(1)}
            </label>
          ))}
        </FormSection>
      </Card>
    </form>
  );
}

/** Shows whether each external channel has a provider configured on the server (no secrets shown). */
function IntegrationStatus() {
  const { data } = useQuery({ queryKey: ['integrations'], queryFn: () => api.get<Array<{ channel: string; configured: boolean; provider: string }>>('/admin/integrations') });
  return (
    <FormSection title="Message delivery providers" description="Providers are configured in the server environment (see docs/deployment_and_demo_setup.md). Without one, the channel runs in demo mode: messages appear in notification history as “demo – not sent”.">
      <div className="space-y-1.5 sm:col-span-2">
        {data?.map((i) => (
          <div key={i.channel} className="flex items-center gap-2 text-sm">
            <span className="w-16 font-medium">{i.channel === 'Sms' ? 'SMS' : i.channel}</span>
            {i.configured ? <Badge tone="ok" dot>Connected · {i.provider}</Badge> : <Badge tone="warn" dot>Not configured — demo mode</Badge>}
          </div>
        ))}
      </div>
    </FormSection>
  );
}

/** Appointment types, payment methods, medicine categories and the medication-reminder start point. */
function CatalogSection({ form }: { form: UseFormReturn<SettingsIn, unknown, SettingsOut> }) {
  const { register, formState: { errors } } = form;
  const types = useFieldArray({ control: form.control, name: 'catalog.appointmentTypes' });
  const methods = (form.watch('catalog.paymentMethods') ?? []) as string[];
  const cats = (form.watch('catalog.medicineCategories') ?? []) as string[];
  const desigs = (form.watch('catalog.designations') ?? []) as string[];
  const [cat, setCat] = useState('');
  const [desig, setDesig] = useState('');
  const setList = (name: 'catalog.paymentMethods' | 'catalog.medicineCategories' | 'catalog.designations', v: string[]) => form.setValue(name, v as never, { shouldDirty: true, shouldValidate: true });
  return (
    <>
      <FormSection title="Appointment types" description="Codes are stored on appointments; deactivate a type instead of removing it once it has been used. The fee basis decides which doctor fee is billed.">
        <div className="space-y-2 sm:col-span-2">
          {types.fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-[1fr_1.4fr_1fr_auto] items-center gap-2">
              <Input placeholder="Code" className="font-mono" {...register(`catalog.appointmentTypes.${i}.code`)} />
              <Input placeholder="Label" {...register(`catalog.appointmentTypes.${i}.label`)} />
              <Select {...register(`catalog.appointmentTypes.${i}.feeBasis`)}><option value="Consultation">Consultation fee</option><option value="FollowUp">Follow-up fee</option></Select>
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" {...register(`catalog.appointmentTypes.${i}.isActive`)} /> Active</label>
            </div>
          ))}
          {errors.catalog?.appointmentTypes && <p className="text-xs text-danger">{(errors.catalog.appointmentTypes as { message?: string }).message ?? 'Check the appointment types'}</p>}
          <Button type="button" size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => types.append({ code: '', label: '', feeBasis: 'Consultation', isActive: true })}>Add type</Button>
        </div>
      </FormSection>
      <FormSection title="Payments & medicines">
        <Field label="Accepted payment methods" className="sm:col-span-2" error={errors.catalog?.paymentMethods as never}>
          <div className="flex flex-wrap gap-3 pt-1">
            {PAYMENT_METHODS.map((m) => (
              <label key={m} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={methods.includes(m)} onChange={(e) => setList('catalog.paymentMethods', e.target.checked ? [...methods, m] : methods.filter((x) => x !== m))} /> {m}</label>
            ))}
          </div>
        </Field>
        <Field label="Medicine categories (therapeutic classes)" className="sm:col-span-2" error={errors.catalog?.medicineCategories as never}>
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input value={cat} onChange={(e) => setCat(e.target.value)} placeholder="e.g. Anticoagulant" className="w-60" />
              <Button type="button" size="sm" variant="outline" disabled={cat.trim().length < 2 || cats.some((c) => c.toLowerCase() === cat.trim().toLowerCase())} onClick={() => { setList('catalog.medicineCategories', [...cats, cat.trim()]); setCat(''); }}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cats.map((c) => <button key={c} type="button" title="Remove" onClick={() => setList('catalog.medicineCategories', cats.filter((x) => x !== c))}><Badge>{c} ✕</Badge></button>)}
            </div>
          </div>
        </Field>
        <Field label="Designations (job titles)" className="sm:col-span-2" hint={desigs.length ? 'Only these titles can be used for employees and offer letters' : 'No list yet — designations are free text. Add titles to enforce a list.'} error={errors.catalog?.designations as never}>
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input value={desig} onChange={(e) => setDesig(e.target.value)} placeholder="e.g. Staff Nurse" className="w-60" />
              <Button type="button" size="sm" variant="outline" disabled={desig.trim().length < 2 || desigs.some((d) => d.toLowerCase() === desig.trim().toLowerCase())} onClick={() => { setList('catalog.designations', [...desigs, desig.trim()].sort()); setDesig(''); }}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-1.5">{desigs.map((d) => <button key={d} type="button" title="Remove" onClick={() => setList('catalog.designations', desigs.filter((x) => x !== d))}><Badge>{d} ✕</Badge></button>)}</div>
          </div>
        </Field>
        <Field label="Medication reminders start" hint="When dose schedules and reminders are created">
          <Select {...register('catalog.medicationScheduleFrom')}><option value="Prescribed">When the doctor prescribes</option><option value="Dispensed">When the pharmacy dispenses</option></Select>
        </Field>
      </FormSection>
    </>
  );
}

// ── Departments & services ──────────────────────────────────────────────────
interface ServiceRow {
  _id: string;
  code: string;
  name: string;
  category: string;
  price: number;
  taxable: boolean;
  isActive: boolean;
  departmentId?: string;
}

export function DepartmentsServicesPage() {
  const { can, user } = useAuth();
  const [tab, setTab] = useState<'departments' | 'services'>(can('departments.manage') ? 'departments' : 'services');
  const [editingDept, setEditingDept] = useState<Department | 'new' | null>(null);
  const [editingSvc, setEditingSvc] = useState<ServiceRow | 'new' | null>(null);
  const { data: depts } = useQuery({ queryKey: ['departments', 'all'], queryFn: () => api.get<Department[]>('/admin/departments', { includeInactive: true }) });
  const { data: services } = useQuery({ queryKey: ['services'], queryFn: () => api.get<ServiceRow[]>('/admin/services'), enabled: can('services.manage') });
  return (
    <>
      <PageHeader
        title="Departments & services"
        actions={tab === 'departments' ? can('departments.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditingDept('new')}>New department</Button> : can('services.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditingSvc('new')}>New service</Button>}
      />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ key: 'departments', label: 'Departments', count: depts?.length }, ...(can('services.manage') ? [{ key: 'services' as const, label: 'Services & prices', count: services?.length }] : [])]} />
      <Card>
        {tab === 'departments' ? (
          <DataTable
            rows={depts}
            rowKey={(d) => d._id}
            onRowClick={can('departments.manage') ? (d) => setEditingDept(d) : undefined}
            columns={[
              { key: 'code', header: 'Code', cell: (d) => <span className="font-mono text-xs">{d.code}</span> },
              { key: 'name', header: 'Name', cell: (d) => <span className="font-medium">{d.name}</span> },
              { key: 'type', header: 'Type', cell: (d) => (d.isClinical ? <Badge tone="brand">Clinical</Badge> : <Badge>Support</Badge>) },
              { key: 'st', header: 'Status', cell: (d) => (d.isActive ? <Badge tone="ok" dot>Active</Badge> : <Badge>Inactive</Badge>) },
            ]}
          />
        ) : (
          <DataTable
            rows={services}
            rowKey={(s) => s._id}
            onRowClick={(s) => setEditingSvc(s)}
            columns={[
              { key: 'code', header: 'Code', cell: (s) => <span className="font-mono text-xs">{s.code}</span> },
              { key: 'name', header: 'Service', cell: (s) => <span className="font-medium">{s.name}</span> },
              { key: 'cat', header: 'Category', cell: (s) => s.category },
              { key: 'price', header: 'Price', align: 'right', cell: (s) => money(s.price, user?.hospital.currency) },
              { key: 'tax', header: 'Taxable', cell: (s) => (s.taxable ? 'Yes' : 'No'), hideOnMobile: true },
            ]}
          />
        )}
      </Card>
      <DepartmentDialog dept={editingDept} onClose={() => setEditingDept(null)} />
      <ServiceDialog svc={editingSvc} depts={depts ?? []} onClose={() => setEditingSvc(null)} />
    </>
  );
}

function DepartmentDialog({ dept, onClose }: { dept: Department | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = dept === 'new';
  const form = useForm<z.input<typeof departmentSchema>, unknown, z.output<typeof departmentSchema>>({
    resolver: zodResolver(departmentSchema),
    values: dept && dept !== 'new' ? { code: dept.code, name: dept.name, description: dept.description ?? '', isClinical: dept.isClinical, isActive: dept.isActive } : { code: '', name: '', isClinical: true, isActive: true },
  });
  const submit = form.handleSubmit(async (v) => {
    try {
      if (isNew) await api.post('/admin/departments', v);
      else await api.put(`/admin/departments/${(dept as Department)._id}`, v);
      toast.success('Department saved');
      qc.invalidateQueries({ queryKey: ['departments'] });
      onClose();
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <Dialog open={!!dept} onClose={onClose} title={isNew ? 'New department' : 'Edit department'} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3" noValidate>
        <Field label="Code" required error={form.formState.errors.code}><Input {...form.register('code')} /></Field>
        <Field label="Name" required error={form.formState.errors.name}><Input {...form.register('name')} /></Field>
        <Field label="Description" className="col-span-2"><Input {...form.register('description')} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register('isClinical')} /> Clinical department</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register('isActive')} /> Active</label>
      </form>
    </Dialog>
  );
}

function ServiceDialog({ svc, depts, onClose }: { svc: ServiceRow | 'new' | null; depts: Department[]; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = svc === 'new';
  const form = useForm<z.input<typeof serviceSchema>, unknown, z.output<typeof serviceSchema>>({
    resolver: zodResolver(serviceSchema),
    values: svc && svc !== 'new' ? { code: svc.code, name: svc.name, category: svc.category as never, price: svc.price, taxable: svc.taxable, isActive: svc.isActive, departmentId: svc.departmentId } : { code: '', name: '', category: 'Procedure', price: 0, taxable: false, isActive: true },
  });
  const submit = form.handleSubmit(async (v) => {
    try {
      if (isNew) await api.post('/admin/services', v);
      else await api.put(`/admin/services/${(svc as ServiceRow)._id}`, v);
      toast.success('Service saved (price change is audited)');
      qc.invalidateQueries({ queryKey: ['services'] });
      onClose();
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <Dialog open={!!svc} onClose={onClose} title={isNew ? 'New service' : 'Edit service'} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Save</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3" noValidate>
        <Field label="Code" required error={form.formState.errors.code}><Input {...form.register('code')} /></Field>
        <Field label="Name" required error={form.formState.errors.name}><Input {...form.register('name')} /></Field>
        <Field label="Category"><Select {...form.register('category')}>{INVOICE_SOURCES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Department"><Select {...form.register('departmentId', { setValueAs: (v) => v || undefined })}><option value="">—</option>{depts.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
        <Field label="Price" required error={form.formState.errors.price}><Input type="number" min={0} {...form.register('price')} /></Field>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" {...form.register('taxable')} /> Taxable</label>
      </form>
    </Dialog>
  );
}

// ── Doctors & nurses ────────────────────────────────────────────────────────
interface NurseRow {
  _id: string;
  name: string;
  licenseNumber: string;
  qualification?: string;
  departmentId: { name: string };
}
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function StaffPage() {
  const { can, user } = useAuth();
  const [tab, setTab] = useState<'doctors' | 'nurses'>('doctors');
  const [creating, setCreating] = useState(false);
  const { data: doctors } = useQuery({ queryKey: ['doctors'], queryFn: () => api.get<Doctor[]>('/admin/doctors') });
  const { data: nurses } = useQuery({ queryKey: ['nurses'], queryFn: () => api.get<NurseRow[]>('/admin/nurses') });
  return (
    <>
      <PageHeader title="Doctors & nurses" description="Clinical staff profiles, schedules and consultation fees." actions={can('staff.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add staff member</Button>} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ key: 'doctors', label: 'Doctors', count: doctors?.length }, { key: 'nurses', label: 'Nurses', count: nurses?.length }]} />
      <Card>
        {tab === 'doctors' ? (
          <DataTable
            rows={doctors}
            rowKey={(d) => d._id}
            columns={[
              { key: 'name', header: 'Doctor', cell: (d) => <div><p className="font-medium">{d.name}</p><p className="text-xs text-muted">{d.specialization}</p></div> },
              { key: 'dept', header: 'Department', cell: (d) => (typeof d.departmentId === 'object' ? d.departmentId.name : '—') },
              { key: 'hours', header: 'Duty', cell: (d) => <span className="num text-xs">{d.dutyStart}–{d.dutyEnd} · {d.slotMinutes}m slots</span>, hideOnMobile: true },
              { key: 'days', header: 'Days', cell: (d) => <span className="text-xs">{d.workingDays.map((n) => DAYS[n - 1]).join(' ')}</span>, hideOnMobile: true },
              { key: 'fee', header: 'Fee', align: 'right', cell: (d) => money(d.consultationFee, user?.hospital.currency) },
              { key: 'lic', header: 'License', cell: (d) => <span className="font-mono text-xs">{d.licenseNumber}</span>, hideOnMobile: true },
              { key: 'av', header: '', cell: (d) => (d.isAvailable ? <Badge tone="ok" dot>Available</Badge> : <Badge>Unavailable</Badge>) },
            ]}
          />
        ) : (
          <DataTable
            rows={nurses}
            rowKey={(n) => n._id}
            columns={[
              { key: 'name', header: 'Nurse', cell: (n) => <span className="font-medium">{n.name}</span> },
              { key: 'dept', header: 'Department', cell: (n) => n.departmentId?.name },
              { key: 'q', header: 'Qualification', cell: (n) => n.qualification ?? '—' },
              { key: 'lic', header: 'License', cell: (n) => <span className="font-mono text-xs">{n.licenseNumber}</span> },
            ]}
          />
        )}
      </Card>
      <StaffDrawer open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function StaffDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: depts } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/admin/departments'), enabled: open });
  const form = useForm<z.input<typeof staffSchema>, unknown, z.output<typeof staffSchema>>({
    resolver: zodResolver(staffSchema),
    defaultValues: { kind: 'Doctor', gender: 'Female', employmentType: 'FullTime', joiningDate: todayIso(), dutyStart: '09:00', dutyEnd: '17:00', slotMinutes: 15, workingDays: [1, 2, 3, 4, 5, 6] },
  });
  const kind = form.watch('kind');
  const { register, formState: { errors, isSubmitting } } = form;
  const submit = form.handleSubmit(async (v) => {
    try {
      const r = await api.post<{ employeeNo: string }>('/admin/staff', v);
      toast.success(`${v.kind} added — employee ${r.employeeNo}`);
      qc.invalidateQueries({ queryKey: ['doctors'] });
      qc.invalidateQueries({ queryKey: ['nurses'] });
      onClose();
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <Drawer open={open} onClose={onClose} title="Add clinical staff" description="Link a user account later from Users to give them sign-in access." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={isSubmitting}>Save</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3" noValidate>
        <Field label="Type" className="col-span-2"><Select {...register('kind')}><option>Doctor</option><option>Nurse</option></Select></Field>
        <Field label="First name" required error={errors.firstName}><Input {...register('firstName')} /></Field>
        <Field label="Last name" required error={errors.lastName}><Input {...register('lastName')} /></Field>
        <Field label="Gender"><Select {...register('gender')}>{GENDERS.map((g) => <option key={g}>{g}</option>)}</Select></Field>
        <Field label="Department" required error={errors.departmentId}><Select {...register('departmentId')}><option value="">Select…</option>{depts?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
        <Field label="Designation" required error={errors.designation}><Input placeholder={kind === 'Doctor' ? 'Consultant' : 'Staff Nurse'} {...register('designation')} /></Field>
        <Field label="License no." required error={errors.licenseNumber}><Input {...register('licenseNumber')} /></Field>
        <Field label="Qualification"><Input {...register('qualification')} /></Field>
        <Field label="Joining date" required error={errors.joiningDate}><Input type="date" {...register('joiningDate')} /></Field>
        <Field label="Employment type"><Select {...register('employmentType')}>{EMPLOYMENT_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <Field label="Phone" error={errors.phone}><Input {...register('phone', { setValueAs: (v) => v || undefined })} /></Field>
        {kind === 'Doctor' && (
          <>
            <Field label="Specialization" required error={errors.specialization}><Input {...register('specialization')} /></Field>
            <Field label="Consultation fee" error={errors.consultationFee}><Input type="number" min={0} {...register('consultationFee')} /></Field>
            <Field label="Follow-up fee" error={errors.followUpFee}><Input type="number" min={0} {...register('followUpFee')} /></Field>
            <Field label="Slot (minutes)" error={errors.slotMinutes}><Input type="number" min={5} {...register('slotMinutes')} /></Field>
            <Field label="Duty start"><Input type="time" {...register('dutyStart')} /></Field>
            <Field label="Duty end"><Input type="time" {...register('dutyEnd')} /></Field>
          </>
        )}
      </form>
    </Drawer>
  );
}

// ── Audit log ───────────────────────────────────────────────────────────────
interface AuditRow {
  _id: string;
  at: string;
  userName?: string;
  roles?: string[];
  action: string;
  module: string;
  entity: string;
  entityId?: string;
  ip?: string;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
}

export function AuditLogPage() {
  const [module, setModule] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditRow | null>(null);
  const { data, isFetching } = useQuery({
    queryKey: ['audit', module, search, from, to, page],
    queryFn: () => api.get<Paged<AuditRow> & { modules: string[] }>('/audit', { module, search, from, to, page, pageSize: 30 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Audit log" description="Immutable record of sensitive actions. Entries cannot be edited or deleted." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="User or action" className="w-56" />
          <Select value={module} onChange={(e) => { setModule(e.target.value); setPage(1); }} className="w-44"><option value="">All modules</option>{data?.modules.map((m) => <option key={m}>{m}</option>)}</Select>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-40" />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-40" />
        </div>
        <DataTable
          loading={isFetching}
          rows={data?.items}
          rowKey={(r) => r._id}
          onRowClick={setOpen}
          empty={{ icon: <ScrollText className="h-5 w-5" />, title: 'No entries' }}
          columns={[
            { key: 'at', header: 'When', cell: (r) => <span className="num whitespace-nowrap text-xs">{formatDateTime(r.at)}</span> },
            { key: 'user', header: 'User', cell: (r) => <div><p className="text-sm">{r.userName ?? 'System / anonymous'}</p><p className="text-[11px] text-muted">{r.roles?.join(', ')}</p></div> },
            { key: 'action', header: 'Action', cell: (r) => <span className={cn('font-mono text-xs', /failed|blocked|reuse/.test(r.action) && 'text-danger')}>{r.action}</span> },
            { key: 'module', header: 'Module', cell: (r) => <Badge>{r.module}</Badge>, hideOnMobile: true },
            { key: 'entity', header: 'Entity', cell: (r) => <span className="text-xs text-muted">{r.entity} {r.entityId?.slice(-6)}</span>, hideOnMobile: true },
            { key: 'ip', header: 'IP', cell: (r) => <span className="font-mono text-[11px] text-muted">{r.ip}</span>, hideOnMobile: true },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.action ?? ''} description={open ? `${formatDateTime(open.at)} · ${open.userName ?? 'System'} · ${open.ip ?? ''}` : ''}>
        {open && (
          <div className="space-y-4 text-xs">
            {(['before', 'after', 'meta'] as const).map((k) =>
              open[k] ? (
                <div key={k}>
                  <p className="mb-1 font-semibold uppercase tracking-wide text-muted">{k === 'before' ? 'Old value' : k === 'after' ? 'New value' : 'Details'}</p>
                  <pre className="max-h-80 overflow-auto rounded-md bg-subtle p-3 font-mono text-[11px] leading-relaxed">{JSON.stringify(open[k], null, 2)}</pre>
                </div>
              ) : null,
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
