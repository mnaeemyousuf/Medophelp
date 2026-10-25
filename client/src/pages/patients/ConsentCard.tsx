import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';
import { CONSENT_METHODS, SELF_SERVICE_CONSENTS } from '@hms/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';
import { Button, Card, CardHeader, Input, Select } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';

interface ConsentState {
  current: Array<{ type: string; granted: boolean | null; at: string | null; method: string | null; recordedByName: string | null }>;
  history: Array<{ _id: string; type: string; granted: boolean; method: string; note?: string; recordedByName?: string; recordedByPatient?: boolean; at: string }>;
}

const LABEL: Record<string, string> = {
  Treatment: 'Consent to treatment',
  DataSharing: 'Data sharing (insurer / referral)',
  SmsMessages: 'SMS messages',
  EmailMessages: 'Email messages',
  PushNotifications: 'App notifications',
};

/**
 * Consent & communication preferences. Staff record any consent with the method used; patients can
 * change their own message preferences. Every change is kept as a dated history entry.
 */
export function ConsentCard({ patientId, portal }: { patientId: string; portal?: boolean }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ type: string; granted: boolean } | null>(null);
  const [method, setMethod] = useState('Verbal');
  const [note, setNote] = useState('');
  const { data } = useQuery({ queryKey: ['consents', patientId], queryFn: () => api.get<ConsentState>(`/patients/${patientId}/consents`) });
  const m = useMutation({
    mutationFn: (v: { type: string; granted: boolean }) => api.post(`/patients/${patientId}/consents`, { ...v, method, note: note || undefined }),
    onSuccess: (_d, v) => { toast.success(`${LABEL[v.type]}: ${v.granted ? 'granted' : 'withdrawn'}`); setEditing(null); setNote(''); qc.invalidateQueries({ queryKey: ['consents', patientId] }); },
    onError: (e) => handleFormError(e),
  });
  const canEdit = portal || can('patients.update');
  const rows = (data?.current ?? []).filter((c) => !portal || (SELF_SERVICE_CONSENTS as readonly string[]).includes(c.type));
  return (
    <Card>
      <CardHeader title={portal ? 'Message preferences' : 'Consent & communication'} description={portal ? 'Choose how the hospital may contact you about appointments, medicines and bills. In-app notifications always stay on.' : 'Latest decision per consent; full history is kept. No record = care-related messages are allowed.'} />
      <ul className="divide-y divide-border">
        {rows.map((c) => {
          const self = (SELF_SERVICE_CONSENTS as readonly string[]).includes(c.type);
          return (
            <li key={c.type} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
              <ShieldCheck className="h-4 w-4 text-muted" />
              <span className="min-w-[180px] flex-1 font-medium">{LABEL[c.type]}</span>
              {c.granted === null ? <Badge>{self ? 'Allowed (default)' : 'Not recorded'}</Badge> : c.granted ? <Badge tone="ok">Granted</Badge> : <Badge tone="danger">{self ? 'Opted out' : 'Declined / withdrawn'}</Badge>}
              {c.at && <span className="text-[11px] text-muted">{formatDateTime(c.at)}{c.method ? ` · ${c.method}` : ''}{c.recordedByName ? ` · ${c.recordedByName}` : ''}</span>}
              {canEdit && (portal ? self : true) && (
                <span className="ml-auto flex gap-1">
                  {(c.granted === false || c.granted === null) && <Button size="sm" variant="outline" onClick={() => (portal ? m.mutate({ type: c.type, granted: true }) : setEditing({ type: c.type, granted: true }))}>{self ? 'Allow' : 'Record consent'}</Button>}
                  {c.granted !== false && <Button size="sm" variant="ghost" onClick={() => (portal ? m.mutate({ type: c.type, granted: false }) : setEditing({ type: c.type, granted: false }))}>{self ? 'Opt out' : 'Record refusal'}</Button>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {portal && <p className="px-4 pb-3 text-[11px] text-muted">SMS and email are not fully secure channels, so messages contain only short reminders — never detailed results.</p>}
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing ? `${LABEL[editing.type]} — ${editing.granted ? 'record consent' : 'record refusal / withdrawal'}` : ''} footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate(editing!)}>Save</Button></>}>
        <div className="grid gap-3">
          <Field label="How was it given?"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{CONSENT_METHODS.filter((x) => x !== 'Portal').map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Signed form scanned to documents" /></Field>
        </div>
      </Dialog>
    </Card>
  );
}

interface PortalStatus { enabled: boolean; email: string | null; lastLoginAt?: string | null; mustChangePassword?: boolean }

/** Front desk gives a registered patient a portal login; the temporary password is shown once. */
export function PortalAccessCard({ patientId, defaultEmail }: { patientId: string; defaultEmail?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [issued, setIssued] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const { data } = useQuery({ queryKey: ['portal-account', patientId], queryFn: () => api.get<PortalStatus>(`/patients/${patientId}/portal-account`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['portal-account', patientId] });
  const enable = useMutation({ mutationFn: () => api.post<{ email: string; temporaryPassword: string }>(`/patients/${patientId}/portal-account`, { email }), onSuccess: (r) => { setIssued(r); setOpen(false); refresh(); }, onError: (e) => handleFormError(e) });
  const disable = useMutation({ mutationFn: () => api.post(`/patients/${patientId}/portal-account/disable`), onSuccess: () => { toast.success('Portal access disabled'); refresh(); }, onError: (e) => handleFormError(e) });
  return (
    <Card>
      <CardHeader title="Patient portal access" description="Lets the patient see their own appointments, prescriptions, verified lab results, bills and medicine reminders." />
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
        {data?.enabled ? (
          <>
            <Badge tone="ok" dot>Enabled</Badge>
            <span className="text-muted">{data.email}{data.lastLoginAt ? ` · last login ${formatDateTime(data.lastLoginAt)}` : ' · never logged in'}</span>
            <Button size="sm" variant="ghost" className="ml-auto" loading={disable.isPending} onClick={() => disable.mutate()}>Disable</Button>
          </>
        ) : (
          <>
            <Badge>Not enabled</Badge>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setOpen(true)}>Enable portal access</Button>
          </>
        )}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="Enable portal access" description="A temporary password is generated and shown once. The patient must change it at first login." footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!/^\S+@\S+\.\S+$/.test(email)} loading={enable.isPending} onClick={() => enable.mutate()}>Create login</Button></>}>
        <Field label="Patient's email (login name)" required><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      </Dialog>
      <Dialog open={!!issued} onClose={() => setIssued(null)} title="Portal login created" description="Give these details to the patient privately. The password will not be shown again." footer={<Button onClick={() => setIssued(null)}>Done</Button>}>
        <div className="space-y-2 rounded-md border border-border bg-subtle p-3 text-sm">
          <p><span className="text-muted">Login:</span> <b>{issued?.email}</b></p>
          <p><span className="text-muted">Temporary password:</span> <b className="font-mono">{issued?.temporaryPassword}</b></p>
        </div>
      </Dialog>
    </Card>
  );
}
