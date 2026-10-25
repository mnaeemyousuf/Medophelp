import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { KeyRound, LockOpen, Plus, Save, Search, ShieldCheck, UserPlus } from 'lucide-react';
import type { z } from 'zod';
import { createUserSchema } from '@hms/shared';
import { api, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDateTime } from '@/lib/utils';
import { Button, Card, CardHeader, Input, PageHeader, PageLoader, Textarea } from '@/components/ui/primitives';
import { DataTable, Pagination } from '@/components/ui/data';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog, Dialog, Drawer } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';

interface UserRow {
  _id: string;
  fullName: string;
  email: string;
  phone?: string;
  isActive: boolean;
  isLocked: boolean;
  lastLoginAt?: string;
  roles: Array<{ id: string; name: string }>;
}
interface Role {
  _id: string;
  name: string;
  description?: string;
  permissions: string[];
  isSystem: boolean;
}
interface PermissionDef {
  code: string;
  module: string;
  description: string;
}

export function UsersPage() {
  const { can, user: me } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [toggling, setToggling] = useState<UserRow | null>(null);
  const { data, isFetching } = useQuery({ queryKey: ['users', search, page], queryFn: () => api.get<Paged<UserRow>>('/admin/users', { search, page, pageSize: 20 }), placeholderData: keepPreviousData });
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/admin/roles') });
  const manage = can('users.manage');

  const unlock = useMutation({ mutationFn: (id: string) => api.post(`/admin/users/${id}/unlock`), onSuccess: () => { toast.success('Account unlocked'); qc.invalidateQueries({ queryKey: ['users'] }); }, onError: (e) => handleFormError(e) });
  const toggle = useMutation({
    mutationFn: (u: UserRow) => api.patch(`/admin/users/${u._id}`, { isActive: !u.isActive }),
    onSuccess: () => { toast.success('Account updated'); setToggling(null); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => handleFormError(e),
  });

  return (
    <>
      <PageHeader title="Users" description="Accounts, role assignment and access." actions={manage && <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>New user</Button>} />
      <Card>
        <div className="border-b border-border p-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name or email" className="pl-8" />
          </div>
        </div>
        <DataTable
          loading={isFetching}
          rows={data?.items}
          rowKey={(u) => u._id}
          columns={[
            { key: 'name', header: 'User', cell: (u) => <div><p className="font-medium">{u.fullName}</p><p className="text-xs text-muted">{u.email}</p></div> },
            { key: 'roles', header: 'Roles', cell: (u) => <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.id} tone="brand">{r.name}</Badge>)}</div> },
            { key: 'status', header: 'Status', cell: (u) => (!u.isActive ? <Badge tone="neutral">Deactivated</Badge> : u.isLocked ? <Badge tone="danger">Locked</Badge> : <Badge tone="ok" dot>Active</Badge>) },
            { key: 'last', header: 'Last sign-in', cell: (u) => <span className="text-muted">{formatDateTime(u.lastLoginAt)}</span>, hideOnMobile: true },
            {
              key: 'act',
              header: '',
              align: 'right',
              cell: (u) =>
                manage && (
                  <div className="flex justify-end gap-1">
                    {u.isLocked && <Button size="sm" variant="ghost" icon={<LockOpen className="h-3.5 w-3.5" />} onClick={() => unlock.mutate(u._id)}>Unlock</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>Roles</Button>
                    <Button size="sm" variant="ghost" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setResetting(u)}>Reset</Button>
                    {u._id !== me?.id && <Button size="sm" variant="ghost" className={u.isActive ? 'text-danger' : ''} onClick={() => setToggling(u)}>{u.isActive ? 'Deactivate' : 'Activate'}</Button>}
                  </div>
                ),
            },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
      <CreateUserDrawer open={creating} onClose={() => setCreating(false)} roles={roles ?? []} />
      <EditRolesDialog user={editing} onClose={() => setEditing(null)} roles={roles ?? []} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
      <ConfirmDialog
        open={!!toggling}
        onClose={() => setToggling(null)}
        onConfirm={() => toggle.mutate(toggling!)}
        loading={toggle.isPending}
        danger={toggling?.isActive}
        title={toggling?.isActive ? 'Deactivate account?' : 'Reactivate account?'}
        confirmLabel={toggling?.isActive ? 'Deactivate' : 'Activate'}
        message={toggling?.isActive ? <><b>{toggling.fullName}</b> will be signed out within a minute and cannot sign in. Their records and audit history are kept.</> : <>Allow <b>{toggling?.fullName}</b> to sign in again?</>}
      />
    </>
  );
}

function RolePicker({ roles, value, onChange }: { roles: Role[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {roles.map((r) => (
        <label key={r._id} className={cn('flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm', value.includes(r._id) ? 'border-brand/50 bg-brand/5' : 'border-border')}>
          <input type="checkbox" className="mt-0.5" checked={value.includes(r._id)} onChange={(e) => onChange(e.target.checked ? [...value, r._id] : value.filter((x) => x !== r._id))} />
          <span>
            <span className="font-medium">{r.name}</span>
            <span className="block text-[11px] text-muted">{r.permissions.length} permissions</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function CreateUserDrawer({ open, onClose, roles }: { open: boolean; onClose: () => void; roles: Role[] }) {
  const qc = useQueryClient();
  const form = useForm<z.input<typeof createUserSchema>, unknown, z.output<typeof createUserSchema>>({ resolver: zodResolver(createUserSchema), defaultValues: { roleIds: [], mustChangePassword: true } });
  const roleIds = form.watch('roleIds') ?? [];
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post('/admin/users', v);
      toast.success('User created');
      qc.invalidateQueries({ queryKey: ['users'] });
      form.reset({ roleIds: [], mustChangePassword: true });
      onClose();
    } catch (e) {
      handleFormError(e, form.setError);
    }
  });
  return (
    <Drawer open={open} onClose={onClose} title="New user" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={form.formState.isSubmitting}>Create user</Button></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" required error={form.formState.errors.fullName}><Input {...form.register('fullName')} /></Field>
        <Field label="Email" required error={form.formState.errors.email}><Input type="email" {...form.register('email')} /></Field>
        <Field label="Phone" error={form.formState.errors.phone}><Input {...form.register('phone', { setValueAs: (v) => v || undefined })} /></Field>
        <Field label="Temporary password" required error={form.formState.errors.password} hint="Shared with the user out-of-band; they must change it on first sign-in."><Input type="password" autoComplete="new-password" {...form.register('password')} /></Field>
        <div>
          <p className="mb-2 text-xs font-medium text-muted">Roles <span className="text-danger">*</span></p>
          <RolePicker roles={roles} value={roleIds} onChange={(ids) => form.setValue('roleIds', ids, { shouldValidate: true })} />
          {form.formState.errors.roleIds && <p className="mt-1 text-xs text-danger">{form.formState.errors.roleIds.message}</p>}
        </div>
      </form>
    </Drawer>
  );
}

function EditRolesDialog({ user, onClose, roles }: { user: UserRow | null; onClose: () => void; roles: Role[] }) {
  const qc = useQueryClient();
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => setIds(user?.roles.map((r) => r.id) ?? []), [user]);
  const m = useMutation({
    mutationFn: () => api.patch(`/admin/users/${user!._id}`, { roleIds: ids }),
    onSuccess: () => { toast.success('Roles updated — applies within a minute'); qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
    onError: (e) => handleFormError(e),
  });
  return (
    <Dialog open={!!user} onClose={onClose} title={`Roles for ${user?.fullName ?? ''}`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!ids.length} loading={m.isPending} onClick={() => m.mutate()}>Save roles</Button></>}>
      <RolePicker roles={roles} value={ids} onChange={setIds} />
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/admin/users/${user!._id}/reset-password`, { password }),
    onSuccess: () => { toast.success('Password reset. The user must change it at next sign-in.'); setPassword(''); onClose(); },
    onError: (e) => handleFormError(e),
  });
  return (
    <Dialog open={!!user} onClose={onClose} title="Reset password" description={`${user?.email ?? ''} · all their sessions will be signed out`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={password.length < 10} loading={m.isPending} onClick={() => m.mutate()}>Reset password</Button></>}>
      <Field label="New temporary password" hint="10+ chars with upper, lower, digit and symbol"><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
    </Dialog>
  );
}

export function RolesPage() {
  const qc = useQueryClient();
  const { data: roles, isLoading } = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/admin/roles') });
  const { data: catalogue } = useQuery({ queryKey: ['permissions'], queryFn: () => api.get<PermissionDef[]>('/admin/permissions') });
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const role = roles?.find((r) => r._id === selected) ?? roles?.[0];
  useEffect(() => setDraft(new Set(role?.permissions ?? [])), [role]);
  const grouped = useMemo(() => {
    const m = new Map<string, PermissionDef[]>();
    for (const p of catalogue ?? []) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    return [...m.entries()];
  }, [catalogue]);
  const dirty = role && (draft.size !== role.permissions.length || role.permissions.some((p) => !draft.has(p)));

  const save = useMutation({
    mutationFn: () => api.put(`/admin/roles/${role!._id}`, { name: role!.name, description: role!.description, permissions: [...draft] }),
    onSuccess: () => { toast.success('Permissions saved — users pick them up within a minute. Change is audited.'); qc.invalidateQueries({ queryKey: ['roles'] }); },
    onError: (e) => handleFormError(e),
  });

  if (isLoading) return <PageLoader />;
  return (
    <>
      <PageHeader title="Roles & permissions" description="Every permission is enforced by the API; the menu only reflects it." actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New role</Button>} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit">
          <ul className="p-1.5">
            {roles?.map((r) => (
              <li key={r._id}>
                <button onClick={() => setSelected(r._id)} className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm', role?._id === r._id ? 'bg-brand/10 font-medium text-brand' : 'hover:bg-subtle')}>
                  <span>{r.name}</span>
                  <span className="num text-[11px] text-muted">{r.permissions.length}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        {role && (
          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand" />{role.name}{role.isSystem && <Badge>System</Badge>}</span>}
              description={role.description}
              actions={<Button size="sm" icon={<Save className="h-3.5 w-3.5" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>}
            />
            <div className="divide-y divide-border">
              {grouped.map(([module, perms]) => {
                const all = perms.every((p) => draft.has(p.code));
                return (
                  <div key={module} className="px-4 py-3">
                    <label className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      <input type="checkbox" checked={all} onChange={(e) => { const n = new Set(draft); perms.forEach((p) => (e.target.checked ? n.add(p.code) : n.delete(p.code))); setDraft(n); }} />
                      {module}
                    </label>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {perms.map((p) => (
                        <label key={p.code} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-sm hover:bg-subtle">
                          <input type="checkbox" className="mt-0.5" checked={draft.has(p.code)} onChange={(e) => { const n = new Set(draft); if (e.target.checked) n.add(p.code); else n.delete(p.code); setDraft(n); }} />
                          <span>
                            <span className="font-mono text-[11px] text-muted">{p.code}</span>
                            <span className="block text-xs">{p.description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
      <NewRoleDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => setSelected(id)} />
    </>
  );
}

function NewRoleDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<Role>('/admin/roles', { name, description, permissions: [] }),
    onSuccess: (r) => { toast.success('Role created — now choose its permissions'); qc.invalidateQueries({ queryKey: ['roles'] }); onCreated(r._id); setName(''); setDescription(''); onClose(); },
    onError: (e) => handleFormError(e),
  });
  return (
    <Dialog open={open} onClose={onClose} title="New role" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={name.trim().length < 2} loading={m.isPending} onClick={() => m.mutate()}>Create</Button></>}>
      <div className="space-y-3">
        <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
