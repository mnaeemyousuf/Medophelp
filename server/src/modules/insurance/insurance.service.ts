import type { Types } from 'mongoose';
import type { z } from 'zod';
import { claimWorkflow, round2, type ClaimStatus, type claimDecisionSchema, type claimListQuery, type createClaimSchema } from '@hms/shared';
import { requireCtx } from '../../core/context';
import { withTransaction } from '../../core/db';
import { BusinessRuleError, ConflictError } from '../../core/errors';
import { recordAudit } from '../../core/audit/audit';
import { escapeRegex, oid, orNotFound, skipOf, sortBy } from '../../core/http';
import { nextNumber } from '../../core/numbering/numbering';
import { assertTransition } from '../../core/workflow';
import { Hospital } from '../organization/organization.models';
import { Patient } from '../patients/patient.models';
import { Invoice, Payment } from '../billing/billing.models';
import { recordPayment } from '../billing/billing.service';
import { InsuranceClaim, type InsuranceClaimDoc } from './insurance.models';

const LIVE: ClaimStatus[] = ['Draft', 'Submitted', 'UnderReview', 'Approved', 'PartiallyApproved', 'Paid'];

function move(c: InsuranceClaimDoc, to: ClaimStatus, note?: string) {
  assertTransition(claimWorkflow, c.status as ClaimStatus, to);
  c.status = to;
  c.history.push({ status: to, at: new Date(), byName: requireCtx().userName, note });
}

/** What the policy has already committed: approved/paid amounts plus claims still pending a decision. */
async function usedCoverage(patientId: Types.ObjectId, policyNumber: string, excludeClaimId?: Types.ObjectId) {
  const rows = await InsuranceClaim.find({ patientId, policyNumber, status: { $in: LIVE }, ...(excludeClaimId ? { _id: { $ne: excludeClaimId } } : {}) }).select('status claimAmount approvedAmount').lean();
  return round2(rows.reduce((s, r) => s + (['Approved', 'PartiallyApproved', 'Paid'].includes(r.status) ? r.approvedAmount : r.claimAmount), 0));
}

/** Outstanding invoices of insured patients that have no live claim yet. */
export async function eligibleInvoices(search?: string) {
  const insured = await Patient.find({ insurances: { $elemMatch: { removedAt: null } } }).select('_id').lean();
  const claimed = await InsuranceClaim.distinct('invoiceId', { status: { $in: LIVE } });
  const filter: Record<string, unknown> = { patientId: { $in: insured.map((p) => p._id) }, status: { $in: ['Issued', 'PartiallyPaid'] }, balance: { $gt: 0 }, _id: { $nin: claimed } };
  if (search) filter.$or = [{ invoiceNo: new RegExp(`^${escapeRegex(search.toUpperCase())}`) }, { mrn: search.toUpperCase() }, { patientName: new RegExp(escapeRegex(search), 'i') }];
  return Invoice.find(filter).select('-items').sort({ issuedAt: -1 }).limit(30).lean();
}

export async function createClaim(input: z.infer<typeof createClaimSchema>) {
  const c = requireCtx();
  const h = orNotFound(await Hospital.findById(c.hospitalId).lean(), 'Hospital');
  return withTransaction(async () => {
    const inv = orNotFound(await Invoice.findById(input.invoiceId).lean(), 'Invoice');
    if (!['Issued', 'PartiallyPaid'].includes(inv.status) || inv.balance <= 0) throw new BusinessRuleError('Only issued invoices with a balance can be claimed');
    if (await InsuranceClaim.exists({ invoiceId: inv._id, isLive: true })) throw new ConflictError('This invoice already has an insurance claim', 'duplicate_claim');
    const patient = orNotFound(await Patient.findById(inv.patientId).lean(), 'Patient');
    const policies = patient.insurances.filter((i) => !i.removedAt);
    const policy = input.insuranceId ? policies.find((i) => i._id.equals(input.insuranceId)) : policies.find((i) => i.isPrimary) ?? policies[0];
    if (!policy) throw new BusinessRuleError('The patient has no active insurance policy');
    const serviceDate = inv.issuedAt ?? new Date();
    if (policy.expiresOn && policy.expiresOn < serviceDate) throw new BusinessRuleError(`Policy ${policy.policyNumber} expired on ${policy.expiresOn.toISOString().slice(0, 10)}`, 'policy_expired');

    const covered = round2((inv.total * (policy.coveragePercent ?? 100)) / 100);
    let amount = round2(input.claimAmount ?? Math.min(covered, inv.balance));
    if (amount > inv.balance) throw new BusinessRuleError(`Claim cannot exceed the invoice balance of ${inv.balance.toFixed(2)}`);
    if (amount > covered) throw new BusinessRuleError(`Policy covers ${policy.coveragePercent}% — at most ${covered.toFixed(2)} on this invoice`);
    if (policy.coverageLimit != null) {
      const remaining = round2(policy.coverageLimit - (await usedCoverage(patient._id, policy.policyNumber)));
      if (remaining <= 0) throw new BusinessRuleError('The policy coverage limit is exhausted', 'limit_exhausted');
      if (!input.claimAmount) amount = Math.min(amount, remaining);
      else if (amount > remaining) throw new BusinessRuleError(`Only ${remaining.toFixed(2)} of the coverage limit remains`, 'limit_exceeded');
    }

    const claimNo = await nextNumber('claim', h.numbering?.claim ?? 'CLM-{yyyy}-{n:5}', h.code);
    const [claim] = (await InsuranceClaim.create([
      {
        claimNo,
        patientId: patient._id,
        patientName: `${patient.firstName} ${patient.lastName}`.trim(),
        mrn: patient.mrn,
        invoiceId: inv._id,
        invoiceNo: inv.invoiceNo,
        invoiceTotal: inv.total,
        insuranceId: policy._id,
        provider: policy.provider,
        policyNumber: policy.policyNumber,
        coveragePercent: policy.coveragePercent,
        coverageLimit: policy.coverageLimit,
        policyExpiresOn: policy.expiresOn,
        claimAmount: amount,
        notes: input.notes,
        history: [{ status: 'Draft', byName: c.userName }],
      },
    ])) as InsuranceClaimDoc[];
    await recordAudit({ action: 'claim.created', module: 'Insurance', entity: 'InsuranceClaim', entityId: claim._id, after: claim });
    return claim.toObject();
  });
}

async function load(id: string) {
  return orNotFound((await InsuranceClaim.findById(id)) as InsuranceClaimDoc | null, 'Claim');
}

export async function updateDraft(id: string, input: { claimAmount?: number; notes?: string }) {
  return withTransaction(async () => {
    const claim = await load(id);
    if (claim.status !== 'Draft') throw new BusinessRuleError('Only draft claims can be edited');
    const inv = orNotFound(await Invoice.findById(claim.invoiceId).lean(), 'Invoice');
    if (input.claimAmount !== undefined) {
      if (input.claimAmount > inv.balance) throw new BusinessRuleError(`Claim cannot exceed the invoice balance of ${inv.balance.toFixed(2)}`);
      if (claim.coverageLimit != null && input.claimAmount > round2(claim.coverageLimit - (await usedCoverage(claim.patientId, claim.policyNumber, claim._id)))) {
        throw new BusinessRuleError('Amount exceeds the remaining coverage limit', 'limit_exceeded');
      }
      claim.claimAmount = round2(input.claimAmount);
    }
    if (input.notes !== undefined) claim.notes = input.notes;
    await claim.save();
    await recordAudit({ action: 'claim.updated', module: 'Insurance', entity: 'InsuranceClaim', entityId: claim._id, after: { claimAmount: claim.claimAmount } });
    return claim.toObject();
  });
}

export async function act(id: string, action: 'submit' | 'review' | 'reopen', note?: string) {
  return withTransaction(async () => {
    const claim = await load(id);
    if (action === 'submit') {
      move(claim, 'Submitted', note);
      claim.submittedAt = new Date();
    } else if (action === 'review') move(claim, 'UnderReview', note);
    else {
      move(claim, 'Draft', note ?? 'Reopened for correction');
      claim.approvedAmount = 0;
      claim.rejectedAmount = 0;
    }
    await claim.save();
    await recordAudit({ action: `claim.${action}`, module: 'Insurance', entity: 'InsuranceClaim', entityId: claim._id, after: { status: claim.status } });
    return claim.toObject();
  });
}

/** Records the payer's decision. Approved = full amount; partial must be less; rejected = nothing. */
export async function decide(id: string, input: z.infer<typeof claimDecisionSchema>) {
  return withTransaction(async () => {
    const claim = await load(id);
    const approved = input.decision === 'Rejected' ? 0 : input.decision === 'Approved' ? claim.claimAmount : round2(input.approvedAmount);
    if (approved > claim.claimAmount) throw new BusinessRuleError('Approved amount cannot exceed the claim amount');
    if (input.decision === 'PartiallyApproved' && approved >= claim.claimAmount) throw new BusinessRuleError('A partial approval must be less than the claimed amount; use Approved instead');
    if (input.decision === 'Approved' && input.approvedAmount && round2(input.approvedAmount) !== claim.claimAmount) throw new BusinessRuleError('For a reduced amount, record a partial approval');
    move(claim, input.decision, input.notes);
    claim.approvedAmount = approved;
    claim.rejectedAmount = round2(claim.claimAmount - approved);
    claim.decidedAt = new Date();
    if (input.payerReference) claim.payerReference = input.payerReference;
    await claim.save();
    await recordAudit({ action: `claim.${input.decision === 'Rejected' ? 'rejected' : 'approved'}`, module: 'Insurance', entity: 'InsuranceClaim', entityId: claim._id, after: { status: claim.status, approved, rejected: claim.rejectedAmount, notes: input.notes } });
    return claim.toObject();
  });
}

/**
 * Settlement: posts an Insurance payment on the invoice and closes the claim in one transaction.
 * The patient remains responsible for any balance the insurer did not cover.
 */
export async function markPaid(id: string, input: { amount: number; payerReference: string }) {
  return withTransaction(async () => {
    const claim = await load(id);
    assertTransition(claimWorkflow, claim.status as ClaimStatus, 'Paid'); // status first: clearer than an amount error
    const amount = round2(input.amount);
    if (amount > claim.approvedAmount) throw new BusinessRuleError(`Payment cannot exceed the approved amount of ${claim.approvedAmount.toFixed(2)}`);
    if (await Payment.exists({ invoiceId: claim.invoiceId, method: 'Insurance', reference: claim.claimNo })) throw new ConflictError('Settlement for this claim is already posted', 'duplicate_settlement');
    move(claim, 'Paid', `Remittance ${input.payerReference}`);
    const { payment } = await recordPayment(claim.invoiceId.toString(), { amount, method: 'Insurance', reference: claim.claimNo, notes: `${claim.provider} remittance ${input.payerReference}` });
    claim.paidAmount = amount;
    claim.paidAt = new Date();
    claim.payerReference = input.payerReference;
    claim.paymentId = payment._id;
    await claim.save();
    await recordAudit({ action: 'claim.paid', module: 'Insurance', entity: 'InsuranceClaim', entityId: claim._id, after: { amount, payerReference: input.payerReference, receiptNo: payment.receiptNo } });
    return claim.toObject();
  });
}

export async function listClaims(q: z.infer<typeof claimListQuery>) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.provider) filter.provider = q.provider;
  if (q.patientId) filter.patientId = oid(q.patientId);
  if (q.search) filter.$or = [{ claimNo: new RegExp(`^${escapeRegex(q.search.toUpperCase())}`) }, { invoiceNo: new RegExp(`^${escapeRegex(q.search.toUpperCase())}`) }, { mrn: q.search.toUpperCase() }, { patientName: new RegExp(escapeRegex(q.search), 'i') }];
  const [items, total, summary] = await Promise.all([
    InsuranceClaim.find(filter).select('-history').sort(sortBy(q.sort, { created: 'createdAt', claimNo: 'claimNo', amount: 'claimAmount', status: 'status', provider: 'provider' }, { createdAt: -1 })).skip(skipOf(q)).limit(q.pageSize).lean(),
    InsuranceClaim.countDocuments(filter),
    InsuranceClaim.aggregate([{ $group: { _id: '$status', n: { $sum: 1 }, claimed: { $sum: '$claimAmount' }, approved: { $sum: '$approvedAmount' }, paid: { $sum: '$paidAmount' } } }]),
  ]);
  const providers = await InsuranceClaim.distinct('provider');
  return { items, total, page: q.page, pageSize: q.pageSize, summary, providers };
}

export async function getClaim(id: string) {
  const claim = orNotFound(await InsuranceClaim.findById(id).lean(), 'Claim');
  const invoice = await Invoice.findById(claim.invoiceId).lean();
  const used = claim.coverageLimit != null ? await usedCoverage(claim.patientId, claim.policyNumber, claim._id) : null;
  return { ...claim, invoice, remainingLimit: used != null && claim.coverageLimit != null ? round2(claim.coverageLimit - used) : null };
}
