import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { JOB_STATUSES, candidateListQuery, candidateSchema, candidateStageSchema, evaluationSchema, interviewSchema, jobSchema, objectId, offerSchema } from '@hms/shared';
import { env } from '../../config/env';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import { BusinessRuleError } from '../../core/errors';
import { offerLetterPdf } from '../../core/pdf/documents';
import * as svc from './recruitment.service';

export const recruitmentRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });
const idParam = validate(z.object({ id: objectId }), 'params');
const manage = requirePermission('recruitment.manage');
const read = requirePermission('recruitment.manage', 'recruitment.approve');

recruitmentRouter.get('/stats', read, ah(async (_req, res) => res.json(await svc.recruitmentStats())));
recruitmentRouter.get('/jobs', read, validate(z.object({ status: z.enum(JOB_STATUSES).optional() }), 'query'), ah(async (req, res) => res.json(await svc.listJobs((req.query as { status?: string }).status))));
recruitmentRouter.post('/jobs', manage, validate(jobSchema), ah(async (req, res) => res.status(201).json(await svc.saveJob(req.body))));
recruitmentRouter.put('/jobs/:id', manage, idParam, validate(jobSchema), ah(async (req, res) => res.json(await svc.saveJob(req.body, req.params.id))));

recruitmentRouter.get('/candidates', read, validate(candidateListQuery, 'query'), ah(async (req, res) => res.json(await svc.listCandidates(req.query as never))));
recruitmentRouter.post('/candidates', manage, validate(candidateSchema), ah(async (req, res) => res.status(201).json(await svc.addCandidate(req.body))));
recruitmentRouter.get('/candidates/:id', read, idParam, ah(async (req, res) => res.json(await svc.getCandidate(req.params.id))));
recruitmentRouter.post('/candidates/:id/stage', manage, idParam, validate(candidateStageSchema), ah(async (req, res) => res.json(await svc.setStage(req.params.id, req.body.stage, req.body.note))));
recruitmentRouter.post('/candidates/:id/resume', manage, idParam, upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw new BusinessRuleError('Attach the CV as a PDF');
  res.json(await svc.uploadResume(req.params.id, req.file));
}));
recruitmentRouter.get('/candidates/:id/resume', read, idParam, ah(async (req, res) => {
  const { resume, data } = await svc.downloadResume(req.params.id);
  res.type(resume.contentType ?? 'application/pdf').setHeader('Content-Disposition', `attachment; filename="${resume.fileName}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(data);
}));
recruitmentRouter.post('/candidates/:id/hire', requirePermission('recruitment.approve'), idParam, ah(async (req, res) => res.status(201).json(await svc.hire(req.params.id))));

recruitmentRouter.get('/interviews/upcoming', read, ah(async (_req, res) => res.json(await svc.upcomingInterviews())));
recruitmentRouter.post('/interviews', manage, validate(interviewSchema), ah(async (req, res) => res.status(201).json(await svc.scheduleInterview(req.body))));
recruitmentRouter.post('/interviews/:id/evaluation', read, idParam, validate(evaluationSchema), ah(async (req, res) => res.json(await svc.evaluateInterview(req.params.id, req.body))));
recruitmentRouter.post('/interviews/:id/status', manage, idParam, validate(z.object({ status: z.enum(['Cancelled', 'NoShow']) })), ah(async (req, res) => res.json(await svc.setInterviewStatus(req.params.id, req.body.status))));

recruitmentRouter.post('/offers', manage, validate(offerSchema), ah(async (req, res) => res.status(201).json(await svc.createOffer(req.body))));
recruitmentRouter.get('/offers/:id/pdf', read, idParam, ah(async (req, res) => {
  const offer = await svc.getOffer(req.params.id);
  const pdf = await offerLetterPdf(offer as never);
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="offer-${offer.offerNo}.pdf"`);
  res.send(pdf);
}));
for (const action of ['submit', 'approve', 'reject', 'send', 'accept', 'decline', 'withdraw'] as const) {
  recruitmentRouter.post(
    `/offers/:id/${action}`,
    action === 'approve' || action === 'reject' ? requirePermission('recruitment.approve') : manage,
    idParam,
    validate(z.object({ note: z.string().trim().max(300).optional() })),
    ah(async (req, res) => res.json(await svc.actOnOffer(req.params.id, action, req.body.note))),
  );
}
