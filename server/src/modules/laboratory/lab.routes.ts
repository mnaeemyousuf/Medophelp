import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { assignTechnicianSchema, collectSampleSchema, createLabOrderSchema, enterResultsSchema, labOrderListQuery, labTestSchema, objectId, rejectResultsSchema } from '@hms/shared';
import { env } from '../../config/env';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import { BusinessRuleError } from '../../core/errors';
import { labReportPdf } from '../../core/pdf/documents';
import * as svc from './lab.service';

export const labRouter = Router();
const idParam = validate(z.object({ id: objectId }), 'params');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });

// Test master (orderable list is needed by doctors too)
labRouter.get(
  '/tests',
  requirePermission('lab.order', 'lab.manage', 'lab.process'),
  validate(z.object({ includeInactive: z.coerce.boolean().optional() }), 'query'),
  ah(async (req, res) => res.json(await svc.listTests((req.query as { includeInactive?: boolean }).includeInactive))),
);
labRouter.post('/tests', requirePermission('lab.manage'), validate(labTestSchema), ah(async (req, res) => res.status(201).json(await svc.createTest(req.body))));
labRouter.put('/tests/:id', requirePermission('lab.manage'), idParam, validate(labTestSchema), ah(async (req, res) => res.json(await svc.updateTest(req.params.id, req.body))));

// Ordering from a consultation
labRouter.post(
  '/visits/:visitId/orders',
  requirePermission('lab.order'),
  validate(z.object({ visitId: objectId }), 'params'),
  validate(createLabOrderSchema),
  ah(async (req, res) => res.status(201).json(await svc.createOrder(req.params.visitId, req.body))),
);

labRouter.get('/stats', requirePermission('lab.process', 'lab.verify', 'dashboard.executive'), ah(async (_req, res) => res.json(await svc.labStats())));
labRouter.get('/orders', requirePermission('lab.process', 'lab.verify', 'lab.results.view', 'portal.self'), validate(labOrderListQuery, 'query'), ah(async (req, res) => res.json(await svc.listOrders(req.query as never))));
labRouter.get('/orders/:id', requirePermission('lab.process', 'lab.verify', 'lab.results.view', 'portal.self'), idParam, ah(async (req, res) => res.json(await svc.getOrder(req.params.id))));
labRouter.get(
  '/orders/:id/report',
  requirePermission('lab.process', 'lab.verify', 'lab.results.view', 'portal.self'),
  idParam,
  ah(async (req, res) => {
    const order = await svc.getOrder(req.params.id);
    if (order.status !== 'Verified') throw new BusinessRuleError('The report is available once results are verified');
    const pdf = await labReportPdf(order as never);
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="lab-report-${order.orderNo}.pdf"`);
    res.send(pdf);
  }),
);

// Technician assignment (lab supervisors)
labRouter.get('/technicians', requirePermission('lab.verify', 'lab.manage'), ah(async (_req, res) => res.json(await svc.listTechnicians())));
labRouter.post('/orders/:id/assign', requirePermission('lab.verify', 'lab.manage'), idParam, validate(assignTechnicianSchema), ah(async (req, res) => res.json(await svc.assignTechnician(req.params.id, req.body.userId))));

// Uploaded reports (instrument printouts, external lab reports)
labRouter.post('/orders/:id/attachments', requirePermission('lab.process'), idParam, upload.single('file'), validate(z.object({ description: z.string().trim().max(200).optional() })), ah(async (req, res) => {
  if (!req.file) throw new BusinessRuleError('Attach the report as a PDF or image');
  res.status(201).json(await svc.addAttachment(req.params.id, req.file, req.body.description));
}));
labRouter.get('/orders/:id/attachments/:attachmentId', requirePermission('lab.process', 'lab.verify', 'lab.results.view', 'portal.self'), validate(z.object({ id: objectId, attachmentId: objectId }), 'params'), ah(async (req, res) => {
  const { attachment, data } = await svc.getAttachment(req.params.id, req.params.attachmentId);
  res.type(attachment.contentType ?? 'application/pdf').setHeader('Content-Disposition', `inline; filename="${attachment.fileName}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(data);
}));

// Lab workflow
labRouter.post('/orders/:id/receive', requirePermission('lab.process'), idParam, ah(async (req, res) => res.json(await svc.receive(req.params.id))));
labRouter.post('/orders/:id/collect', requirePermission('lab.process'), idParam, validate(collectSampleSchema), ah(async (req, res) => res.json(await svc.collectSample(req.params.id, req.body))));
labRouter.post('/orders/:id/start', requirePermission('lab.process'), idParam, ah(async (req, res) => res.json(await svc.startProcessing(req.params.id))));
labRouter.put('/orders/:id/results', requirePermission('lab.process'), idParam, validate(enterResultsSchema), ah(async (req, res) => res.json(await svc.enterResults(req.params.id, req.body))));
labRouter.post('/orders/:id/verify', requirePermission('lab.verify'), idParam, ah(async (req, res) => res.json(await svc.verify(req.params.id))));
labRouter.post('/orders/:id/reject', requirePermission('lab.verify'), idParam, validate(rejectResultsSchema), ah(async (req, res) => res.json(await svc.rejectResults(req.params.id, req.body.reason))));
labRouter.post('/orders/:id/cancel', requirePermission('lab.process', 'lab.order'), idParam, validate(rejectResultsSchema), ah(async (req, res) => res.json(await svc.cancelOrder(req.params.id, req.body.reason))));
labRouter.post('/orders/:id/review', requirePermission('lab.results.view'), idParam, ah(async (req, res) => res.json(await svc.review(req.params.id))));
