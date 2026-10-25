import { env } from '../../config/env';
import { requireCtx, runWithContext } from '../../core/context';
import { logger } from '../../core/logger';
import { notify } from '../../core/notifications/notify';
import { Hospital } from '../organization/organization.models';
import { Invoice } from './billing.models';

const DAY = 86_400_000;
export const MAX_PAYMENT_REMINDERS = 3;

/**
 * Overdue-balance follow-up: patients with an issued invoice still unpaid `PAYMENT_REMINDER_DAYS`
 * after issue get a polite reminder (in-app, SMS/email where enabled and not opted out), at most
 * three times, a week apart. Amounts only — no clinical detail in the message.
 */
export async function runPaymentReminders(now = new Date(), afterDays = env.PAYMENT_REMINDER_DAYS) {
  if (afterDays <= 0) return { sent: 0 };
  const due = await Invoice.find({
    status: { $in: ['Issued', 'PartiallyPaid'] },
    balance: { $gt: 0 },
    issuedAt: { $lte: new Date(now.getTime() - afterDays * DAY) },
    paymentReminders: { $lt: MAX_PAYMENT_REMINDERS },
    $or: [{ lastPaymentReminderAt: null }, { lastPaymentReminderAt: { $lte: new Date(now.getTime() - 7 * DAY) } }],
  })
    .select('invoiceNo patientId balance issuedAt paymentReminders')
    .limit(500)
    .lean();
  const h = await Hospital.findById(requireCtx().hospitalId).select('currency').lean();
  for (const inv of due) {
    await notify({
      type: 'PaymentDue',
      title: 'Payment reminder',
      message: `Invoice ${inv.invoiceNo} has an outstanding balance of ${h?.currency ?? 'PKR'} ${inv.balance.toLocaleString('en-US')}. Please pay at the hospital counter or contact the accounts office.`,
      patientId: inv.patientId,
      link: '/portal/bills',
      external: ['Sms', 'Email'],
    });
    await Invoice.updateOne({ _id: inv._id }, { $inc: { paymentReminders: 1 }, lastPaymentReminderAt: now });
  }
  return { sent: due.length };
}

export async function runBillingJobs() {
  const hospitals = await runWithContext({ roles: [], permissions: new Set(), system: true }, () => Hospital.find({ isActive: true }).select('_id').lean());
  for (const h of hospitals) {
    await runWithContext({ roles: [], permissions: new Set(), hospitalId: h._id, userName: 'System' }, () => runPaymentReminders()).catch((err) =>
      logger.error({ err, hospitalId: h._id.toString() }, 'Payment reminder job failed'),
    );
  }
}

export function scheduleBillingJobs(everyMs = 60 * 60_000) {
  const tick = () => void runBillingJobs().catch((err) => logger.error({ err }, 'Payment reminder job failed'));
  setTimeout(tick, 40_000);
  return setInterval(tick, everyMs);
}
