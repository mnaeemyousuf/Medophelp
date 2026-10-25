import { Types } from 'mongoose';
import {
  invoiceWorkflow,
  lineTotals,
  round2,
  type InvoiceLineInput,
  type InvoiceSource,
  type InvoiceStatus,
  type PaymentMethod,
} from '@hms/shared';
import { requireCtx } from '../../core/context';
import { BusinessRuleError, ForbiddenError } from '../../core/errors';
import { recordAudit } from '../../core/audit/audit';
import { dateOnly, escapeRegex, oid, orNotFound, skipOf, sortBy } from '../../core/http';
import { withTransaction } from '../../core/db';
import { nextNumber } from '../../core/numbering/numbering';
import { assertTransition } from '../../core/workflow';
import { notify } from '../../core/notifications/notify';
import { requirePaymentMethod } from '../organization/catalog';
import { Hospital } from '../organization/organization.models';
import { Patient } from '../patients/patient.models';
import { Invoice, Payment, Refund, type InvoiceDoc } from './billing.models';

async function hospital() {
  return orNotFound(await Hospital.findById(requireCtx().hospitalId).lean(), 'Hospital');
}

function buildLines(items: Array<InvoiceLineInput & { sourceRef?: string }>) {
  return items.map((i) => {
    const t = lineTotals(i);
    return { ...i, serviceId: i.serviceId ? oid(i.serviceId) : undefined, discount: t.discount, tax: t.tax, total: t.total };
  });
}

/** Recomputes all money fields from the lines and payments. Never trust client-sent totals. */
function recalc(inv: InvoiceDoc) {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  for (const l of inv.items) {
    subtotal += round2(l.quantity * l.unitPrice);
    discountTotal += l.discount ?? 0;
    taxTotal += l.tax ?? 0;
  }
  inv.subtotal = round2(subtotal);
  inv.discountTotal = round2(discountTotal);
  inv.taxTotal = round2(taxTotal);
  inv.total = round2(subtotal - discountTotal + taxTotal);
  inv.balance = round2(inv.total - inv.paid + inv.refunded);
}

function setStatus(inv: InvoiceDoc, to: InvoiceStatus) {
  if (inv.status === to) return;
  assertTransition(invoiceWorkflow, inv.status as InvoiceStatus, to);
  inv.status = to;
}

/** Payment status follows the money, within the workflow rules. */
function settleStatus(inv: InvoiceDoc) {
  const net = round2(inv.paid - inv.refunded);
  if (inv.refunded > 0 && net <= 0) return setStatus(inv, 'Refunded');
  if (net >= inv.total && inv.total > 0) return setStatus(inv, 'Paid');
  if (net > 0) return setStatus(inv, 'PartiallyPaid');
}

export interface CreateInvoiceArgs {
  patientId: string | Types.ObjectId;
  visitId?: string | Types.ObjectId;
  departmentId?: Types.ObjectId;
  source: InvoiceSource;
  items: Array<InvoiceLineInput & { sourceRef?: string }>;
  notes?: string;
  issue: boolean;
}

/** Creates an invoice. Callers decide whether to wrap in a transaction (addCharges does). */
export async function createInvoice(args: CreateInvoiceArgs) {
  const h = await hospital();
  const patient = orNotFound(await Patient.findById(args.patientId).select('mrn firstName lastName').lean(), 'Patient');
  const invoiceNo = await nextNumber('invoice', h.numbering!.invoice!, h.code);
  const inv = new Invoice({
    invoiceNo,
    patientId: patient._id,
    mrn: patient.mrn,
    patientName: `${patient.firstName} ${patient.lastName}`,
    visitId: args.visitId ? oid(args.visitId) : undefined,
    departmentId: args.departmentId,
    source: args.source,
    items: buildLines(args.items),
    notes: args.notes,
  }) as InvoiceDoc;
  recalc(inv);
  if (args.issue) {
    setStatus(inv, 'Issued');
    inv.issuedAt = new Date();
  }
  await inv.save();
  await recordAudit({ action: 'invoice.created', module: 'Billing', entity: 'Invoice', entityId: inv._id, after: inv });
  if (args.issue && inv.balance > 0) {
    await notify({
      type: 'PaymentDue',
      title: 'Invoice issued',
      message: `Invoice ${inv.invoiceNo} for ${h.currency} ${inv.total.toFixed(2)} has been issued.`,
      patientId: patient._id,
    });
  }
  return inv;
}

/**
 * Entry point for other modules (OPD, pharmacy, lab, emergency): posts charges as an issued invoice.
 * Idempotent per sourceRef so a retried request cannot bill twice.
 */
export async function addCharges(args: Omit<CreateInvoiceArgs, 'issue'> & { sourceRef: string }) {
  const existing = await Invoice.findOne({ 'items.sourceRef': args.sourceRef, status: { $ne: 'Cancelled' } });
  if (existing) return existing;
  return createInvoice({ ...args, issue: true, items: args.items.map((i) => ({ ...i, sourceRef: args.sourceRef })) });
}

export function createManualInvoice(input: CreateInvoiceArgs) {
  return withTransaction(() => createInvoice(input));
}

export async function addLines(id: string, items: InvoiceLineInput[]) {
  return withTransaction(async () => {
    const inv = orNotFound((await Invoice.findById(id)) as InvoiceDoc | null, 'Invoice');
    if (inv.status !== 'Draft') throw new BusinessRuleError('Lines can only be added to draft invoices');
    for (const l of buildLines(items)) inv.items.push(l);
    recalc(inv);
    await inv.save();
    await recordAudit({ action: 'invoice.lines_added', module: 'Billing', entity: 'Invoice', entityId: inv._id, after: { items } });
    return inv.toObject();
  });
}

export async function issueInvoice(id: string) {
  return withTransaction(async () => {
    const inv = orNotFound((await Invoice.findById(id)) as InvoiceDoc | null, 'Invoice');
    if (!inv.items.length) throw new BusinessRuleError('Cannot issue an empty invoice');
    setStatus(inv, 'Issued');
    inv.issuedAt = new Date();
    await inv.save();
    await recordAudit({ action: 'invoice.issued', module: 'Billing', entity: 'Invoice', entityId: inv._id, before: { status: 'Draft' }, after: { status: 'Issued' } });
    return inv.toObject();
  });
}

export async function cancelInvoice(id: string, reason: string) {
  return withTransaction(async () => {
    const inv = orNotFound((await Invoice.findById(id)) as InvoiceDoc | null, 'Invoice');
    if (inv.paid > 0) throw new BusinessRuleError('An invoice with payments cannot be cancelled; refund the payments first');
    const from = inv.status;
    setStatus(inv, 'Cancelled');
    inv.cancelReason = reason;
    inv.balance = 0;
    await inv.save();
    await recordAudit({ action: 'invoice.cancelled', module: 'Billing', entity: 'Invoice', entityId: inv._id, before: { status: from }, after: { status: 'Cancelled', reason } });
    return inv.toObject();
  });
}

export async function recordPayment(invoiceId: string, input: { amount: number; method: PaymentMethod; reference?: string; notes?: string }) {
  const c = requireCtx();
  const h = await hospital();
  await requirePaymentMethod(input.method);
  const result = await withTransaction(async () => {
    const inv = orNotFound((await Invoice.findById(invoiceId)) as InvoiceDoc | null, 'Invoice');
    if (!['Issued', 'PartiallyPaid'].includes(inv.status)) throw new BusinessRuleError(`Cannot take payment on a ${inv.status} invoice`);
    const amount = round2(input.amount);
    if (amount > inv.balance) throw new BusinessRuleError(`Amount exceeds the outstanding balance of ${inv.balance.toFixed(2)}`);
    if (input.method !== 'Cash' && !input.reference) throw new BusinessRuleError('A transaction reference is required for non-cash payments');

    const receiptNo = await nextNumber('receipt', h.numbering!.receipt!, h.code);
    const [payment] = await Payment.create([
      {
        receiptNo,
        invoiceId: inv._id,
        patientId: inv.patientId,
        amount,
        method: input.method,
        reference: input.reference,
        notes: input.notes,
        receivedBy: c.userId,
        receivedByName: c.userName,
      },
    ]);
    const before = { paid: inv.paid, balance: inv.balance, status: inv.status };
    inv.paid = round2(inv.paid + amount);
    recalc(inv);
    settleStatus(inv);
    await inv.save();
    await recordAudit({ action: 'payment.received', module: 'Billing', entity: 'Payment', entityId: payment._id, after: payment, meta: { invoiceNo: inv.invoiceNo } });
    await recordAudit({ action: 'invoice.payment_applied', module: 'Billing', entity: 'Invoice', entityId: inv._id, before, after: { paid: inv.paid, balance: inv.balance, status: inv.status } });
    return { payment: payment.toObject(), invoice: inv.toObject() };
  });
  await notify({
    type: 'PaymentReceived',
    title: 'Payment received',
    message: `Received ${h.currency} ${result.payment.amount.toFixed(2)} (receipt ${result.payment.receiptNo}).`,
    patientId: result.invoice.patientId,
  });
  return result;
}

export async function refundPayment(invoiceId: string, input: { paymentId: string; amount: number; reason: string }) {
  const c = requireCtx();
  const h = await hospital();
  return withTransaction(async () => {
    const inv = orNotFound((await Invoice.findById(invoiceId)) as InvoiceDoc | null, 'Invoice');
    const payment = orNotFound(await Payment.findOne({ _id: oid(input.paymentId), invoiceId: inv._id }), 'Payment');
    const amount = round2(input.amount);
    const refundable = round2(payment.amount - payment.refunded);
    if (amount > refundable) throw new BusinessRuleError(`At most ${refundable.toFixed(2)} can be refunded from this payment`);
    const refundNo = await nextNumber('refund', 'RF-{yyyy}-{n:6}', h.code);
    const [refund] = await Refund.create([{ refundNo, paymentId: payment._id, invoiceId: inv._id, patientId: inv.patientId, amount, reason: input.reason, processedBy: c.userId }]);
    payment.refunded = round2(payment.refunded + amount);
    await payment.save();
    const before = { refunded: inv.refunded, balance: inv.balance, status: inv.status };
    inv.refunded = round2(inv.refunded + amount);
    recalc(inv);
    // A full refund closes the invoice as Refunded; a partial one re-opens the balance.
    if (round2(inv.paid - inv.refunded) <= 0) setStatus(inv, 'Refunded');
    else if (inv.status === 'Paid') setStatus(inv, 'PartiallyPaid');
    await inv.save();
    await recordAudit({ action: 'refund.processed', module: 'Billing', entity: 'Refund', entityId: refund._id, after: refund, meta: { invoiceNo: inv.invoiceNo } });
    await recordAudit({ action: 'invoice.refund_applied', module: 'Billing', entity: 'Invoice', entityId: inv._id, before, after: { refunded: inv.refunded, balance: inv.balance, status: inv.status } });
    return { refund: refund.toObject(), invoice: inv.toObject() };
  });
}

export async function listInvoices(q: {
  page: number;
  pageSize: number;
  status?: InvoiceStatus;
  source?: InvoiceSource;
  patientId?: string;
  from?: string;
  to?: string;
  outstandingOnly?: boolean;
  search?: string;
  sort?: string;
}) {
  const c = requireCtx();
  const filter: Record<string, unknown> = {};
  if (c.patientId) filter.patientId = c.patientId;
  else if (q.patientId) filter.patientId = oid(q.patientId);
  if (q.status) filter.status = q.status;
  if (q.source) filter.source = q.source;
  if (q.outstandingOnly) filter.balance = { $gt: 0 };
  if (q.from || q.to) {
    const to = q.to ? dateOnly(q.to) : undefined;
    if (to) to.setUTCDate(to.getUTCDate() + 1);
    filter.createdAt = { ...(q.from ? { $gte: dateOnly(q.from) } : {}), ...(to ? { $lt: to } : {}) };
  }
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ invoiceNo: rx }, { mrn: rx }, { patientName: rx }];
  }
  const [items, total, sums] = await Promise.all([
    Invoice.find(filter).select('-items').sort(sortBy(q.sort, { created: 'createdAt', issued: 'issuedAt', invoiceNo: 'invoiceNo', total: 'total', balance: 'balance', status: 'status' }, { createdAt: -1 })).skip(skipOf(q)).limit(q.pageSize).lean(),
    Invoice.countDocuments(filter),
    Invoice.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: '$total' }, paid: { $sum: '$paid' }, balance: { $sum: '$balance' } } }]),
  ]);
  return { items, page: q.page, pageSize: q.pageSize, total, totals: sums[0] ?? { total: 0, paid: 0, balance: 0 } };
}

export async function getInvoice(id: string) {
  const c = requireCtx();
  const inv = orNotFound(await Invoice.findById(id).lean(), 'Invoice');
  if (c.patientId && !c.patientId.equals(inv.patientId)) throw new ForbiddenError();
  const [payments, refunds] = await Promise.all([
    Payment.find({ invoiceId: inv._id }).sort({ receivedAt: 1 }).lean(),
    Refund.find({ invoiceId: inv._id }).sort({ processedAt: 1 }).lean(),
  ]);
  return { ...inv, payments, refunds };
}

export async function getPayment(id: string) {
  const c = requireCtx();
  const p = orNotFound(await Payment.findById(id).lean(), 'Payment');
  if (c.patientId && !c.patientId.equals(p.patientId)) throw new ForbiddenError();
  return p;
}
