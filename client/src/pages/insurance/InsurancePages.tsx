import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, Banknote, CircleDollarSign, FileCheck2, FilePlus2, Gavel, RotateCcw, Search, Send, ShieldCheck } from 'lucide-react';
import { CLAIM_STATUSES } from '@hms/shared';
import { api, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatDateTime, humanize, money } from '@/lib/utils';
import { Button, Card, CardHeader, Input, PageHeader, PageLoader, Select, Textarea } from '@/components/ui/primitives';
import { DataTable, KeyValue, Pagination, StatCard } from '@/components/ui/data';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog, Drawer } from '@/components/ui/overlay';
import { Field, handleFormError } from '@/components/form/Field';
import type { Claim, Invoice } from '@/types';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface ClaimList extends Paged<Claim> {
  summary: Array<{ _id: string; n: number; claimed: number; approved: number; paid: number }>;
  providers: string[];
}

export function ClaimsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const creating = params.get('new') === '1';
  const { data, isFetching } = useQuery({ queryKey: ['claims', status, provider, search, page], queryFn: () => api.get<ClaimList>('/insurance/claims', { status, provider, search, page, pageSize: 25 }), placeholderData: keepPreviousData });
  const sum = (st: string[], k: 'claimed' | 'approved' | 'paid') => (data?.summary ?? []).filter((r) => st.includes(r._id)).reduce((s, r) => s + r[k], 0);
  const count = (st: string[]) => (data?.summary ?? []).filter((r) => st.includes(r._id)).reduce((s, r) => s + r.n, 0);
  const cur = user?.hospital.currency;

  return (
    <>
      <PageHeader title="Insurance claims" description="Claim insurer-covered amounts on patient invoices and track them to settlement." actions={<Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setParams({ new: '1' })}>New claim</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Drafts to submit" value={count(['Draft'])} icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setStatus('Draft')} />
        <StatCard label="Awaiting insurer" value={money(sum(['Submitted', 'UnderReview'], 'claimed'), cur)} hint={plural(count(['Submitted', 'UnderReview']), 'claim')} icon={<Send className="h-4 w-4" />} tone="info" />
        <StatCard label="Approved, unpaid" value={money(sum(['Approved', 'PartiallyApproved'], 'approved'), cur)} hint={plural(count(['Approved', 'PartiallyApproved']), 'claim')} icon={<BadgeCheck className="h-4 w-4" />} tone="warn" />
        <StatCard label="Settled" value={money(sum(['Paid'], 'paid'), cur)} hint={`${count(['Paid'])} paid · ${count(['Rejected'])} rejected`} icon={<CircleDollarSign className="h-4 w-4" />} tone="ok" />
      </div>
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Claim, invoice, MRN or patient" className="pl-8" />
          </div>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44"><option value="">All statuses</option>{CLAIM_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <Select value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1); }} className="w-48"><option value="">All insurers</option>{data?.providers.map((p) => <option key={p}>{p}</option>)}</Select>
        </div>
        <DataTable
          loading={isFetching}
          rows={data?.items}
          rowKey={(c) => c._id}
          onRowClick={(c) => navigate(`/insurance/claims/${c._id}`)}
          empty={{ icon: <ShieldCheck className="h-5 w-5" />, title: 'No claims' }}
          columns={[
            { key: 'no', header: 'Claim', cell: (c) => <div><p className="font-mono text-xs font-medium">{c.claimNo}</p><p className="text-[11px] text-muted">{formatDate(c.createdAt)}</p></div> },
            { key: 'pt', header: 'Patient', cell: (c) => <div><p className="font-medium">{c.patientName}</p><p className="font-mono text-[11px] text-muted">{c.mrn} · {c.invoiceNo}</p></div> },
            { key: 'ins', header: 'Insurer / policy', cell: (c) => <div className="text-xs"><p>{c.provider}</p><p className="text-muted">{c.policyNumber}</p></div>, hideOnMobile: true },
            { key: 'amt', header: 'Claimed', align: 'right', cell: (c) => money(c.claimAmount, cur) },
            { key: 'app', header: 'Approved', align: 'right', cell: (c) => (['Approved', 'PartiallyApproved', 'Paid', 'Rejected'].includes(c.status) ? money(c.approvedAmount, cur) : '—'), hideOnMobile: true },
            { key: 'st', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
      <NewClaimDrawer open={creating} onClose={() => setParams({})} presetInvoiceId={params.get('invoiceId') ?? undefined} />
    </>
  );
}

function NewClaimDrawer({ open, onClose, presetInvoiceId }: { open: boolean; onClose: () => void; presetInvoiceId?: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [invoiceId, setInvoiceId] = useState(presetInvoiceId ?? '');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open) {
      setInvoiceId(presetInvoiceId ?? '');
      setAmount('');
      setNotes('');
    }
  }, [open, presetInvoiceId]);
  const { data: invoices } = useQuery({ queryKey: ['eligible-invoices', search], queryFn: () => api.get<Invoice[]>('/insurance/eligible-invoices', { search }), enabled: open });
  const m = useMutation({
    mutationFn: () => api.post<Claim>('/insurance/claims', { invoiceId, claimAmount: amount ? Number(amount) : undefined, notes: notes || undefined }),
    onSuccess: (c) => {
      toast.success(`Claim ${c.claimNo} drafted for ${money(c.claimAmount, user?.hospital.currency)}`);
      qc.invalidateQueries({ queryKey: ['claims'] });
      onClose();
      navigate(`/insurance/claims/${c._id}`);
    },
    onError: (e) => handleFormError(e),
  });
  const selected = invoices?.find((i) => i._id === invoiceId);
  return (
    <Drawer open={open} onClose={onClose} width="sm:max-w-2xl" title="New insurance claim" description="Only outstanding invoices of insured patients without a live claim are listed. The amount defaults to the policy's coverage, capped by the remaining limit." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!invoiceId} loading={m.isPending} onClick={() => m.mutate()}>Create draft claim</Button></>}>
      <div className="space-y-4">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice, MRN or patient" />
        <div className="max-h-72 overflow-y-auto rounded-md border border-border">
          {!invoices?.length && <p className="px-3 py-4 text-center text-sm text-muted">No eligible invoices</p>}
          {invoices?.map((i) => (
            <label key={i._id} className={cn('flex cursor-pointer items-center gap-3 border-b border-border/70 px-3 py-2 text-sm last:border-0', invoiceId === i._id && 'bg-brand/5')}>
              <input type="radio" checked={invoiceId === i._id} onChange={() => setInvoiceId(i._id)} />
              <span className="flex-1"><span className="font-medium">{i.patientName}</span> <span className="font-mono text-xs text-muted">{i.mrn} · {i.invoiceNo} · {i.source}</span></span>
              <span className="num text-xs">balance <b>{money(i.balance, user?.hospital.currency)}</b></span>
            </label>
          ))}
        </div>
        {selected && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Claim amount" hint="Leave blank to use the policy coverage"><Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`max ${selected.balance}`} /></Field>
            <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
        )}
      </div>
    </Drawer>
  );
}

export function ClaimPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const [deciding, setDeciding] = useState(false);
  const [paying, setPaying] = useState(false);
  const { data: c, isLoading } = useQuery({ queryKey: ['claim', id], queryFn: () => api.get<Claim>(`/insurance/claims/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['claim', id] });
    qc.invalidateQueries({ queryKey: ['claims'] });
  };
  const act = useMutation({ mutationFn: (op: string) => api.post(`/insurance/claims/${id}/${op}`), onSuccess: (_d, op) => { toast.success({ submit: 'Submitted to insurer', review: 'Marked under review', reopen: 'Reopened as draft' }[op] ?? 'Done'); refresh(); }, onError: (e) => handleFormError(e) });
  if (isLoading || !c) return <PageLoader />;
  const cur = user?.hospital.currency;
  return (
    <div className="space-y-4">
      <PageHeader
        title={`Claim ${c.claimNo}`}
        description={<span className="flex items-center gap-2">{c.patientName} · {c.provider} · <StatusBadge status={c.status} /></span>}
        actions={
          <>
            {c.status === 'Draft' && <Button icon={<Send className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate('submit')}>Submit to insurer</Button>}
            {c.status === 'Submitted' && <Button variant="outline" icon={<FileCheck2 className="h-4 w-4" />} onClick={() => act.mutate('review')}>Mark under review</Button>}
            {['Submitted', 'UnderReview'].includes(c.status) && <Button icon={<Gavel className="h-4 w-4" />} onClick={() => setDeciding(true)}>Record decision</Button>}
            {['Approved', 'PartiallyApproved'].includes(c.status) && can('payments.receive') && <Button icon={<Banknote className="h-4 w-4" />} onClick={() => setPaying(true)}>Record settlement</Button>}
            {c.status === 'Rejected' && <Button variant="outline" icon={<RotateCcw className="h-4 w-4" />} onClick={() => act.mutate('reopen')}>Reopen & correct</Button>}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Claimed" value={money(c.claimAmount, cur)} />
        <StatCard label="Approved" value={money(c.approvedAmount, cur)} tone="ok" />
        <StatCard label="Rejected" value={money(c.rejectedAmount, cur)} tone="danger" />
        <StatCard label="Paid by insurer" value={money(c.paidAmount, cur)} tone="info" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Policy" />
          <div className="p-4">
            <KeyValue items={[['Insurer', c.provider], ['Policy no.', c.policyNumber], ['Coverage', c.coveragePercent != null ? `${c.coveragePercent}%` : '—'], ['Limit', c.coverageLimit != null ? money(c.coverageLimit, cur) : 'No limit'], ['Remaining limit', c.remainingLimit != null ? money(c.remainingLimit, cur) : '—'], ['Expires', formatDate(c.policyExpiresOn)]]} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Invoice" actions={<Link to={`/billing/invoices/${c.invoiceId}`} className="text-xs text-brand hover:underline">Open invoice</Link>} />
          <div className="p-4">
            <KeyValue items={[['Invoice', c.invoiceNo], ['MRN', c.mrn], ['Invoice total', money(c.invoiceTotal, cur)], ['Current balance', money(c.invoice?.balance, cur)], ['Payer reference', c.payerReference], ['Notes', c.notes]]} />
          </div>
        </Card>
      </div>
      {c.history && (
        <Card>
          <CardHeader title="History" />
          <ol className="space-y-2 p-4 text-sm">
            {c.history.map((h, i) => <li key={i}><span className="font-medium">{humanize(h.status)}</span> · {formatDateTime(h.at)} · {h.byName}{h.note && <span className="text-muted"> — {h.note}</span>}</li>)}
          </ol>
        </Card>
      )}
      <DecisionDialog open={deciding} claim={c} onClose={() => setDeciding(false)} onDone={refresh} />
      <SettlementDialog open={paying} claim={c} onClose={() => setPaying(false)} onDone={refresh} />
    </div>
  );
}

function DecisionDialog({ open, claim, onClose, onDone }: { open: boolean; claim: Claim; onClose: () => void; onDone: () => void }) {
  const [decision, setDecision] = useState<'Approved' | 'PartiallyApproved' | 'Rejected'>('Approved');
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => { if (open) { setDecision('Approved'); setAmount(String(claim.claimAmount)); setRef(''); setNotes(''); } }, [open, claim.claimAmount]);
  const m = useMutation({
    mutationFn: () => api.post(`/insurance/claims/${claim._id}/decision`, { decision, approvedAmount: decision === 'Rejected' ? 0 : Number(amount), payerReference: ref || undefined, notes: notes || undefined }),
    onSuccess: () => { toast.success(`Decision recorded: ${humanize(decision)}`); onClose(); onDone(); },
    onError: (e) => handleFormError(e),
  });
  const valid = decision === 'Rejected' ? notes.trim().length >= 3 : Number(amount) > 0 && Number(amount) <= claim.claimAmount && (decision === 'Approved' || Number(amount) < claim.claimAmount);
  return (
    <Dialog open={open} onClose={onClose} title="Insurer decision" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={m.isPending} variant={decision === 'Rejected' ? 'danger' : 'primary'} onClick={() => m.mutate()}>Save decision</Button></>}>
      <div className="space-y-3">
        <Field label="Decision"><Select value={decision} onChange={(e) => { const d = e.target.value as typeof decision; setDecision(d); if (d === 'Approved') setAmount(String(claim.claimAmount)); }}><option value="Approved">Approved in full</option><option value="PartiallyApproved">Partially approved</option><option value="Rejected">Rejected</option></Select></Field>
        {decision !== 'Rejected' && <Field label="Approved amount" hint={`Claimed ${claim.claimAmount}`}><Input type="number" min={0} max={claim.claimAmount} disabled={decision === 'Approved'} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
        <Field label="Insurer reference"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        <Field label={decision === 'Rejected' ? 'Rejection reason' : 'Notes'} required={decision === 'Rejected'}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function SettlementDialog({ open, claim, onClose, onDone }: { open: boolean; claim: Claim; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  useEffect(() => { if (open) { setAmount(String(claim.approvedAmount)); setRef(''); } }, [open, claim.approvedAmount]);
  const m = useMutation({
    mutationFn: () => api.post(`/insurance/claims/${claim._id}/paid`, { amount: Number(amount), payerReference: ref }),
    onSuccess: () => { toast.success('Settlement posted to the invoice as an insurance payment'); onClose(); onDone(); },
    onError: (e) => handleFormError(e),
  });
  return (
    <Dialog open={open} onClose={onClose} title="Record insurer settlement" description="Posts an Insurance payment on the invoice; any remaining balance is the patient's share." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!(Number(amount) > 0 && Number(amount) <= claim.approvedAmount) || ref.trim().length < 2} loading={m.isPending} onClick={() => m.mutate()}>Post settlement</Button></>}>
      <div className="space-y-3">
        <Field label="Amount received" hint={`Approved ${claim.approvedAmount}`}><Input type="number" min={0} max={claim.approvedAmount} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Remittance reference" required><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
