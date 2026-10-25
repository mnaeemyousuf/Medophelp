import { env } from './config/env';
import { connectDb, disconnectDb } from './core/db';
import { logger } from './core/logger';
import { createApp } from './app';
import { scheduleStockAlerts } from './core/jobs/stock-alerts';
import { scheduleMedicationJobs } from './modules/medication/medication.jobs';
import { scheduleAppointmentJobs } from './modules/appointments/appointment.jobs';
import { runMigrations } from './migrations/migrations';
import { scheduleBillingJobs } from './modules/billing/billing.jobs';

async function main() {
  await connectDb(env.MONGODB_URI);
  await runMigrations();
  const server = createApp().listen(env.PORT, () => logger.info(`HMS API listening on :${env.PORT}`));
  scheduleStockAlerts();
  scheduleMedicationJobs();
  scheduleAppointmentJobs();
  scheduleBillingJobs();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
