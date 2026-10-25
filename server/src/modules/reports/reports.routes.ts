import { Router } from 'express';
import { z } from 'zod';
import { REPORT_KEYS, reportQuerySchema, type ReportQuery } from '@hms/shared';
import { ah } from '../../core/http';
import { validate } from '../../core/middleware/validate';
import * as svc from './reports.service';
import { toCsv, toPdf, toXlsx } from './reports.export';

/** Report catalogue and runner. Per-report permissions are checked in the service. */
export const reportsRouter = Router();

reportsRouter.get('/', ah(async (_req, res) => res.json(svc.availableReports())));

reportsRouter.get('/:key', validate(z.object({ key: z.enum(REPORT_KEYS) }), 'params'), validate(reportQuerySchema, 'query'), ah(async (req, res) => {
  const q = req.query as unknown as ReportQuery;
  const result = await svc.runReport(req.params.key, q);
  const file = `${result.key}-${new Date().toISOString().slice(0, 10)}`;
  if (q.format === 'xlsx') {
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').setHeader('Content-Disposition', `attachment; filename="${file}.xlsx"`);
    return res.send(await toXlsx(result));
  }
  if (q.format === 'csv') {
    res.type('text/csv; charset=utf-8').setHeader('Content-Disposition', `attachment; filename="${file}.csv"`);
    return res.send(toCsv(result));
  }
  if (q.format === 'pdf') {
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${file}.pdf"`);
    return res.send(await toPdf(result));
  }
  res.json(result);
}));
