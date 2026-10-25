import type { z } from 'zod';
import {
  candidateWorkflow,
  offerWorkflow,
  round2,
  type CandidateStage,
  type OfferInput,
  type OfferStatus,
  type candidateListQuery,
  type candidateSchema,
  type evaluationSchema,
  type interviewSchema,
  type jobSchema,
} from '@hms/shared';
import { can, requireCtx } from '../../core/context';
import { withTransaction } from '../../core/db';
import { BusinessRuleError, ConflictError, ForbiddenError } from '../../core/errors';
import { diff, recordAudit, snapshot } from '../../core/audit/audit';
import { dateOnly, escapeRegex, oid, orNotFound, skipOf, todayString, sortBy } from '../../core/http';
import { nextNumber } from '../../core/numbering/numbering';
import { assertTransition } from '../../core/workflow';
import { notify } from '../../core/notifications/notify';
import { storage, validateUpload } from '../../core/storage/storage';
import { Department } from '../organization/organization.models';
import { Employee } from '../staff/staff.models';
import { Contract } from '../hr/hr.models';
import { hrPolicy } from '../hr/hr.service';
import { SalaryStructure } from '../payroll/payroll.models';
import { usersWithPermission } from '../identity/recipients';
import { requireDesignation } from '../organization/catalog';
import { Candidate, Interview, JobPosting, OfferLetter, type CandidateDoc, type OfferDoc } from './recruitment.models';

// ── Jobs ────────────────────────────────────────────────────────────────────
export async function listJobs(status?: string) {
  const jobs = await JobPosting.find(status ? { status } : {}).populate('departmentId', 'name').sort({ createdAt: -1 }).lean();
  const counts = await Candidate.aggregate([{ $group: { _id: { job: '$jobId', stage: '$stage' }, n: { $sum: 1 } } }]);
  return jobs.map((j) => {
    const pipeline = Object.fromEntries(counts.filter((x) => x._id.job.equals(j._id)).map((x) => [x._id.stage, x.n]));
    return { ...j, departmentName: (j.departmentId as unknown as { name?: string })?.name, pipeline, candidates: Object.values(pipeline).reduce((s: number, n) => s + (n as number), 0) };
  });
}

export async function saveJob(input: z.infer<typeof jobSchema>, id?: string) {
  if (input.salaryMin != null && input.salaryMax != null && input.salaryMax < input.salaryMin) throw new BusinessRuleError('Maximum salary is below minimum');
  orNotFound(await Department.exists({ _id: oid(input.departmentId) }), 'Department');
  const policy = await hrPolicy();
  const job = id ? orNotFound(await JobPosting.findById(id), 'Job') : new JobPosting({ jobNo: await nextNumber('job', 'JOB-{yyyy}-{n:4}', policy.code) });
  const before = id ? (snapshot(job) as Record<string, unknown>) : undefined;
  job.set({ ...input, departmentId: oid(input.departmentId), closingDate: input.closingDate ? dateOnly(input.closingDate) : undefined });
  if (input.status === 'Open' && !job.postedAt) job.postedAt = new Date();
  await job.save();
  await recordAudit({ action: id ? 'job.updated' : 'job.created', module: 'Recruitment', entity: 'JobPosting', entityId: job._id, ...(before ? diff(before, snapshot(job) as Record<string, unknown>) : { after: job }) });
  return job.toObject();
}

// ── Candidates ──────────────────────────────────────────────────────────────
export async function addCandidate(input: z.infer<typeof candidateSchema>) {
  const c = requireCtx();
  const job = orNotFound(await JobPosting.findById(input.jobId).lean(), 'Job');
  if (job.status !== 'Open') throw new BusinessRuleError('Applications are accepted only for open positions');
  if (await Candidate.exists({ jobId: job._id, email: input.email })) throw new ConflictError('This candidate has already applied for this job', 'duplicate_application');
  const cand = await Candidate.create({ ...input, jobId: job._id, history: [{ stage: 'Applied', byName: c.userName }] });
  await recordAudit({ action: 'candidate.added', module: 'Recruitment', entity: 'Candidate', entityId: cand._id, after: cand });
  return cand.toObject();
}

export async function listCandidates(q: z.infer<typeof candidateListQuery>) {
  const filter: Record<string, unknown> = {};
  if (q.jobId) filter.jobId = oid(q.jobId);
  if (q.stage) filter.stage = q.stage;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }, { phone: rx }];
  }
  const [items, total] = await Promise.all([
    Candidate.find(filter).select('-history').populate('jobId', 'title jobNo').sort(sortBy(q.sort, { updated: 'updatedAt', applied: 'createdAt', name: 'firstName', stage: 'stage', experience: 'experienceYears' }, { updatedAt: -1 })).skip(skipOf(q)).limit(q.pageSize).lean(),
    Candidate.countDocuments(filter),
  ]);
  return { items: items.map((x) => ({ ...x, fullName: `${x.firstName} ${x.lastName}`, jobTitle: (x.jobId as unknown as { title?: string })?.title })), total, page: q.page, pageSize: q.pageSize };
}

export async function getCandidate(id: string) {
  const cand = orNotFound(await Candidate.findById(id).populate('jobId', 'title jobNo departmentId employmentType').lean(), 'Candidate');
  const [interviews, offers] = await Promise.all([
    Interview.find({ candidateId: cand._id }).sort({ scheduledAt: -1 }).lean(),
    OfferLetter.find({ candidateId: cand._id }).sort({ createdAt: -1 }).lean(),
  ]);
  return { ...cand, fullName: `${cand.firstName} ${cand.lastName}`, interviews, offers };
}

function moveCandidate(cand: CandidateDoc, to: CandidateStage, note?: string) {
  assertTransition(candidateWorkflow, cand.stage as CandidateStage, to);
  if (to === 'Rejected') cand.rejectedFromStage = cand.stage;
  cand.stage = to;
  cand.history.push({ stage: to, at: new Date(), byName: requireCtx().userName, note });
}

/** Manual moves. Offer and Hired happen only through the offer and hire actions. */
export async function setStage(id: string, stage: CandidateStage, note?: string) {
  if (stage === 'Offer' || stage === 'Hired') throw new BusinessRuleError(`Candidates reach "${stage}" through the offer letter and hiring steps`);
  const cand = orNotFound((await Candidate.findById(id)) as CandidateDoc | null, 'Candidate');
  const from = cand.stage;
  moveCandidate(cand, stage, note);
  await cand.save();
  await recordAudit({ action: 'candidate.stage_changed', module: 'Recruitment', entity: 'Candidate', entityId: cand._id, before: { stage: from }, after: { stage, note } });
  return cand.toObject();
}

export async function uploadResume(id: string, file: Express.Multer.File) {
  const cand = orNotFound(await Candidate.findById(id), 'Candidate');
  const { key, safeName, contentType } = validateUpload(file, `recruitment/${id}`);
  await storage.put(key, file.buffer, contentType);
  cand.resume = { fileName: safeName, contentType, sizeBytes: file.size, storageKey: key } as never;
  await cand.save();
  await recordAudit({ action: 'candidate.resume_uploaded', module: 'Recruitment', entity: 'Candidate', entityId: cand._id });
  return cand.toObject();
}

export async function downloadResume(id: string) {
  const cand = orNotFound(await Candidate.findById(id).lean(), 'Candidate');
  if (!cand.resume?.storageKey) throw new BusinessRuleError('No CV uploaded');
  return { resume: cand.resume, data: await storage.get(cand.resume.storageKey) };
}

// ── Interviews ──────────────────────────────────────────────────────────────
export async function scheduleInterview(input: z.infer<typeof interviewSchema>) {
  return withTransaction(async () => {
    const cand = orNotFound((await Candidate.findById(input.candidateId)) as CandidateDoc | null, 'Candidate');
    if (!['Shortlisted', 'Interview'].includes(cand.stage)) throw new BusinessRuleError('Only shortlisted candidates can be interviewed');
    const at = new Date(input.scheduledAt);
    if (at.getTime() < Date.now() - 60 * 60_000) throw new BusinessRuleError('Interview time is in the past');
    if (cand.stage === 'Shortlisted') moveCandidate(cand, 'Interview', `Interview ${at.toLocaleString('en-GB')}`);
    await cand.save();
    const [iv] = await Interview.create([{ ...input, candidateId: cand._id, jobId: cand.jobId, scheduledAt: at }]);
    await recordAudit({ action: 'interview.scheduled', module: 'Recruitment', entity: 'Interview', entityId: iv._id, after: iv });
    return iv.toObject();
  });
}

export async function evaluateInterview(id: string, input: z.infer<typeof evaluationSchema>) {
  const c = requireCtx();
  const iv = orNotFound(await Interview.findById(id), 'Interview');
  if (iv.status === 'Cancelled') throw new BusinessRuleError('Interview was cancelled');
  if (iv.evaluation?.at) throw new BusinessRuleError('This interview has already been evaluated');
  const overall = round2((input.technical + input.communication + input.experience + input.attitude) / 4);
  iv.status = 'Completed';
  iv.evaluation = { ...input, overall, byName: c.userName, at: new Date() } as never;
  await iv.save();
  await recordAudit({ action: 'interview.evaluated', module: 'Recruitment', entity: 'Interview', entityId: iv._id, after: iv.evaluation });
  return iv.toObject();
}

export async function setInterviewStatus(id: string, status: 'Cancelled' | 'NoShow') {
  const iv = orNotFound(await Interview.findById(id), 'Interview');
  if (iv.status !== 'Scheduled') throw new BusinessRuleError(`Interview is ${iv.status}`);
  iv.status = status;
  await iv.save();
  await recordAudit({ action: `interview.${status === 'Cancelled' ? 'cancelled' : 'no_show'}`, module: 'Recruitment', entity: 'Interview', entityId: iv._id });
  return iv.toObject();
}

export async function upcomingInterviews() {
  const since = new Date(Date.now() - 12 * 3_600_000);
  const rows = await Interview.find({ scheduledAt: { $gte: since }, status: 'Scheduled' }).populate('candidateId', 'firstName lastName').populate('jobId', 'title').sort({ scheduledAt: 1 }).limit(30).lean();
  return rows.map((r) => ({ ...r, candidateName: `${(r.candidateId as unknown as { firstName: string }).firstName} ${(r.candidateId as unknown as { lastName: string }).lastName}`, jobTitle: (r.jobId as unknown as { title?: string })?.title }));
}

// ── Offers & hiring ─────────────────────────────────────────────────────────
export async function createOffer(input: OfferInput) {
  const c = requireCtx();
  await requireDesignation(input.designation);
  const policy = await hrPolicy();
  return withTransaction(async () => {
    const cand = orNotFound(await Candidate.findById(input.candidateId).lean(), 'Candidate');
    if (cand.stage !== 'Selected') throw new BusinessRuleError('Offers can be made only to selected candidates');
    if (await OfferLetter.exists({ candidateId: cand._id, status: { $in: ['Draft', 'PendingApproval', 'Approved', 'Sent'] } })) throw new ConflictError('This candidate already has an open offer', 'duplicate_offer');
    if (input.expiresOn < todayString() || input.joiningDate < todayString()) throw new BusinessRuleError('Offer and joining dates must be in the future');
    const offerNo = await nextNumber('offer', 'OFR-{yyyy}-{n:4}', policy.code);
    const [offer] = (await OfferLetter.create([
      { ...input, offerNo, candidateId: cand._id, jobId: cand.jobId, candidateName: `${cand.firstName} ${cand.lastName}`, departmentId: oid(input.departmentId), joiningDate: dateOnly(input.joiningDate), expiresOn: dateOnly(input.expiresOn), history: [{ status: 'Draft', byName: c.userName }] },
    ])) as OfferDoc[];
    await recordAudit({ action: 'offer.created', module: 'Recruitment', entity: 'OfferLetter', entityId: offer._id, after: offer });
    return offer.toObject();
  });
}

export type OfferAction = 'submit' | 'approve' | 'reject' | 'send' | 'accept' | 'decline' | 'withdraw';

export async function actOnOffer(id: string, action: OfferAction, note?: string) {
  const c = requireCtx();
  const result = await withTransaction(async () => {
    const offer = orNotFound((await OfferLetter.findById(id)) as OfferDoc | null, 'Offer');
    const target: Record<OfferAction, OfferStatus> = { submit: 'PendingApproval', approve: 'Approved', reject: 'Draft', send: 'Sent', accept: 'Accepted', decline: 'Declined', withdraw: 'Withdrawn' };
    if (action === 'approve' || action === 'reject') {
      if (!can('recruitment.approve')) throw new ForbiddenError();
      if (offer.createdBy && c.userId?.equals(offer.createdBy)) throw new ForbiddenError('Offers must be approved by someone other than the person who drafted them');
    }
    assertTransition(offerWorkflow, offer.status as OfferStatus, target[action]);
    offer.status = target[action];
    offer.history.push({ status: offer.status, at: new Date(), byName: c.userName, note });
    if (action === 'approve') {
      offer.approvedByName = c.userName;
      offer.approvedAt = new Date();
    }
    if (action === 'send') offer.sentAt = new Date();
    if (action === 'accept' || action === 'decline') offer.respondedAt = new Date();
    await offer.save();

    const cand = orNotFound((await Candidate.findById(offer.candidateId)) as CandidateDoc | null, 'Candidate');
    if (action === 'send') moveCandidate(cand, 'Offer', offer.offerNo);
    if (action === 'decline') moveCandidate(cand, 'Rejected', `Declined offer ${offer.offerNo}${note ? `: ${note}` : ''}`);
    if (cand.isModified()) await cand.save();
    await recordAudit({ action: `offer.${offer.status.toLowerCase()}`, module: 'Recruitment', entity: 'OfferLetter', entityId: offer._id, after: { status: offer.status, note } });
    return offer;
  });
  if (action === 'accept') {
    const hr = await usersWithPermission('recruitment.approve');
    if (hr.length) await notify({ type: 'RecruitmentUpdate', title: 'Offer accepted', message: `${result.candidateName} accepted ${result.offerNo} (${result.designation}). Ready to hire.`, userIds: hr, link: `/recruitment/candidates/${result.candidateId}` });
  }
  return result.toObject();
}

/**
 * Converts an accepted offer into an employee in one transaction: employee record, contract and
 * salary structure from the offer terms; candidate → Hired; job opening filled.
 */
export async function hire(candidateId: string) {
  const policy = await hrPolicy();
  return withTransaction(async () => {
    const cand = orNotFound((await Candidate.findById(candidateId)) as CandidateDoc | null, 'Candidate');
    const offer = await OfferLetter.findOne({ candidateId: cand._id, status: 'Accepted' }).lean();
    if (!offer) throw new BusinessRuleError('The candidate has not accepted an offer');
    if (cand.employeeId) throw new ConflictError('Candidate is already hired', 'already_hired');
    const job = orNotFound(await JobPosting.findById(cand.jobId), 'Job');
    const employeeNo = await nextNumber('employee', 'EMP-{n:5}', policy.code);
    const [emp] = await Employee.create([
      {
        employeeNo,
        firstName: cand.firstName,
        lastName: cand.lastName,
        cnic: cand.cnic,
        gender: cand.gender,
        departmentId: offer.departmentId,
        designation: offer.designation,
        joiningDate: offer.joiningDate,
        employmentType: offer.employmentType,
        phone: cand.phone,
        email: cand.email,
        hiredFromCandidateId: cand._id,
      },
    ]);
    const contractNo = await nextNumber('contract', 'CON-{yyyy}-{n:5}', policy.code);
    await Contract.create([{ employeeId: emp._id, contractNo, type: offer.employmentType, startDate: offer.joiningDate, basicSalary: offer.basicSalary, terms: offer.terms }]);
    await SalaryStructure.create([{ employeeId: emp._id, effectiveFrom: offer.joiningDate, basic: offer.basicSalary, allowances: offer.allowances, deductions: [], taxPercent: 0 }]);
    moveCandidate(cand, 'Hired', `Employee ${employeeNo}`);
    cand.employeeId = emp._id;
    await cand.save();
    job.filled = (job.filled ?? 0) + 1;
    if (job.filled >= job.openings) job.status = 'Closed';
    await job.save();
    await recordAudit({ action: 'candidate.hired', module: 'Recruitment', entity: 'Candidate', entityId: cand._id, after: { employeeNo, offerNo: offer.offerNo } });
    return { employee: emp.toObject(), candidate: cand.toObject() };
  });
}

export async function getOffer(id: string) {
  return orNotFound(await OfferLetter.findById(id).populate('departmentId', 'name').lean(), 'Offer');
}

export async function recruitmentStats() {
  const [openJobs, byStage, interviews, offersOut] = await Promise.all([
    JobPosting.countDocuments({ status: 'Open' }),
    Candidate.aggregate([{ $group: { _id: '$stage', n: { $sum: 1 } } }]),
    Interview.countDocuments({ status: 'Scheduled', scheduledAt: { $gte: new Date(), $lte: new Date(Date.now() + 7 * 86_400_000) } }),
    OfferLetter.countDocuments({ status: { $in: ['PendingApproval', 'Approved', 'Sent'] } }),
  ]);
  return { openJobs, pipeline: Object.fromEntries(byStage.map((s) => [s._id, s.n])), interviewsThisWeek: interviews, offersOutstanding: offersOut };
}
