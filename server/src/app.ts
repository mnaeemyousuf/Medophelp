import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './core/logger';
import { authenticate, requestContext } from './core/middleware/auth';
import { csrfGuard } from './core/middleware/csrf';
import { errorHandler, notFoundHandler } from './core/middleware/error-handler';
import { authRouter } from './modules/identity/auth.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { patientRouter } from './modules/patients/patient.routes';
import { appointmentRouter } from './modules/appointments/appointment.routes';
import { clinicalRouter } from './modules/clinical/clinical.routes';
import { billingRouter } from './modules/billing/billing.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { auditRouter } from './modules/audit/audit.routes';
import { searchRouter } from './modules/search/search.routes';
import { notificationRouter } from './modules/notifications/notification.routes';
import { labRouter } from './modules/laboratory/lab.routes';
import { pharmacyRouter } from './modules/pharmacy/pharmacy.routes';
import { inventoryRouter } from './modules/inventory/inventory.routes';
import { purchasingRouter } from './modules/purchasing/purchasing.routes';
import { emergencyRouter } from './modules/emergency/emergency.routes';
import { ipdRouter } from './modules/ipd/ipd.routes';
import { insuranceRouter } from './modules/insurance/insurance.routes';
import { hrRouter } from './modules/hr/hr.routes';
import { meRouter } from './modules/hr/me.routes';
import { payrollRouter } from './modules/payroll/payroll.routes';
import { recruitmentRouter } from './modules/recruitment/recruitment.routes';
import { medicationRouter } from './modules/medication/medication.routes';
import { reportsRouter } from './modules/reports/reports.routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') {
    // Request lines only: no bodies, cookies or query strings with identifiers.
    app.use(pinoHttp({ logger, serializers: { req: (r) => ({ method: r.method, url: r.url?.split('?')[0] }), res: (r) => ({ statusCode: r.statusCode }) } }));
  }
  app.use(requestContext);

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api', csrfGuard);
  app.use('/api/auth', authRouter);

  // Everything below requires a signed-in user.
  const api = express.Router();
  api.use(authenticate);
  api.use(
    rateLimit({
      windowMs: 60_000,
      limit: env.NODE_ENV === 'test' ? 10_000 : 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: (req) => req.cookies?.hms_at?.slice(-24) ?? req.ip ?? 'anon',
    }),
  );
  api.use('/admin', adminRouter);
  api.use('/patients', patientRouter);
  api.use('/appointments', appointmentRouter);
  api.use('/clinical', clinicalRouter);
  api.use('/billing', billingRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/audit', auditRouter);
  api.use('/search', searchRouter);
  api.use('/notifications', notificationRouter);
  api.use('/laboratory', labRouter);
  api.use('/pharmacy', pharmacyRouter);
  api.use('/inventory', inventoryRouter);
  api.use('/purchasing', purchasingRouter);
  api.use('/emergency', emergencyRouter);
  api.use('/ipd', ipdRouter);
  api.use('/insurance', insuranceRouter);
  api.use('/hr', hrRouter);
  api.use('/payroll', payrollRouter);
  api.use('/recruitment', recruitmentRouter);
  api.use('/me', meRouter);
  api.use('/medications', medicationRouter);
  api.use('/reports', reportsRouter);
  app.use('/api', api);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
