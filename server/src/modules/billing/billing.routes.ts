import { Router } from 'express';
import { z } from 'zod';
import {
  addInvoiceLinesSchema,
  cancelInvoiceSchema,
  createInvoiceSchema,
  invoiceListQuery,
  objectId,
  recordPaymentSchema,
  refundSchema,
} from '@hms/shared';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import { idempotent } from '../../core/middleware/idempotency';
import { invoicePdf, receiptPdf } from '../../core/pdf/documents';
import * as svc from './billing.service';

export const billingRouter = Router();
const idParam = validate(z.object({ id: objectId }), 'params');

const sendPdf = (res: import('express').Response, pdf: Buffer, name: string) => {
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
  res.send(pdf);
};

billingRouter.get('/invoices', requirePermission('billing.view', 'portal.self'), validate(invoiceListQuery, 'query'), ah(async (req, res) => res.json(await svc.listInvoices(req.query as never))));
billingRouter.post('/invoices', requirePermission('billing.manage'), validate(createInvoiceSchema), ah(async (req, res) => res.status(201).json(await svc.createManualInvoice(req.body))));
billingRouter.get('/invoices/:id', requirePermission('billing.view', 'portal.self'), idParam, ah(async (req, res) => res.json(await svc.getInvoice(req.params.id))));
billingRouter.get('/invoices/:id/pdf', requirePermission('billing.view', 'portal.self'), idParam, ah(async (req, res) => sendPdf(res, await invoicePdf(req.params.id), `invoice-${req.params.id}`)));
billingRouter.post('/invoices/:id/lines', requirePermission('billing.manage'), idParam, validate(addInvoiceLinesSchema), ah(async (req, res) => res.json(await svc.addLines(req.params.id, req.body.items))));
billingRouter.post('/invoices/:id/issue', requirePermission('billing.manage'), idParam, ah(async (req, res) => res.json(await svc.issueInvoice(req.params.id))));
billingRouter.post('/invoices/:id/cancel', requirePermission('billing.manage'), idParam, validate(cancelInvoiceSchema), ah(async (req, res) => res.json(await svc.cancelInvoice(req.params.id, req.body.reason))));
billingRouter.post('/invoices/:id/payments', requirePermission('payments.receive'), idParam, idempotent(), validate(recordPaymentSchema), ah(async (req, res) => res.status(201).json(await svc.recordPayment(req.params.id, req.body))));
billingRouter.post('/invoices/:id/refunds', requirePermission('refunds.process'), idParam, idempotent(), validate(refundSchema), ah(async (req, res) => res.status(201).json(await svc.refundPayment(req.params.id, req.body))));
billingRouter.get('/payments/:id/receipt', requirePermission('billing.view', 'payments.receive', 'portal.self'), idParam, ah(async (req, res) => sendPdf(res, await receiptPdf(req.params.id), `receipt-${req.params.id}`)));
