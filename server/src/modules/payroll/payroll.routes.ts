import { Router } from 'express';
import { z } from 'zod';
import { createPayrollRunSchema, objectId, payrollAdjustSchema, salaryStructureSchema } from '@hms/shared';
import { ah } from '../../core/http';
import { requirePermission } from '../../core/middleware/auth';
import { validate } from '../../core/middleware/validate';
import { payslipPdf } from '../../core/pdf/documents';
import * as svc from './payroll.service';

export const payrollRouter = Router();
const idParam = validate(z.object({ id: objectId }), 'params');
const staff = requirePermission('payroll.manage', 'payroll.approve');

payrollRouter.get('/salary/:id', staff, idParam, ah(async (req, res) => res.json(await svc.salaryHistory(req.params.id))));
payrollRouter.post('/salary/:id', requirePermission('payroll.manage'), idParam, validate(salaryStructureSchema), ah(async (req, res) => res.status(201).json(await svc.setSalary(req.params.id, req.body))));

payrollRouter.get('/runs', staff, ah(async (_req, res) => res.json(await svc.listRuns())));
payrollRouter.post('/runs', requirePermission('payroll.manage'), validate(createPayrollRunSchema), ah(async (req, res) => res.status(201).json(await svc.createRun(req.body.period))));
payrollRouter.get('/runs/:id', staff, idParam, ah(async (req, res) => res.json(await svc.getRun(req.params.id))));
payrollRouter.post('/runs/:id/regenerate', requirePermission('payroll.manage'), idParam, ah(async (req, res) => res.json(await svc.regenerate(req.params.id))));
for (const action of ['submit', 'approve', 'reject', 'process', 'cancel'] as const) {
  payrollRouter.post(
    `/runs/:id/${action}`,
    action === 'approve' || action === 'reject' ? requirePermission('payroll.approve') : requirePermission('payroll.manage'),
    idParam,
    validate(z.object({ note: z.string().trim().max(300).optional() })),
    ah(async (req, res) => res.json(await svc.actOnRun(req.params.id, action, req.body.note))),
  );
}
payrollRouter.patch('/items/:id', requirePermission('payroll.manage'), idParam, validate(payrollAdjustSchema), ah(async (req, res) => res.json(await svc.adjustItem(req.params.id, req.body))));

payrollRouter.get('/payslips/:id/pdf', requirePermission('payroll.manage', 'payroll.approve', 'self.service'), idParam, ah(async (req, res) => {
  const data = await svc.payslipData(req.params.id);
  const pdf = await payslipPdf(data as never);
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="payslip-${data.payslip.period}.pdf"`);
  res.send(pdf);
}));
