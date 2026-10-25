import { Types } from 'mongoose';
import { runWithContext } from '../context';
import { logger } from '../logger';
import { notify } from '../notifications/notify';
import { Hospital } from '../../modules/organization/organization.models';
import { Notification } from '../../modules/notifications/notification.model';
import { Batch, Item } from '../../modules/inventory/inventory.models';
import { usersWithPermission } from '../../modules/identity/recipients';

const DAY = 86_400_000;

/**
 * Runs per hospital: raises one LowStock and one MedicineExpiry notification per stock user per day
 * (deduplicated), so alerts arrive even when nobody opens the inventory screen.
 */
export async function runStockAlerts() {
  const hospitals = await runWithContext({ roles: [], permissions: new Set(), system: true }, () => Hospital.find({ isActive: true }).select('_id').lean());
  for (const h of hospitals) {
    await runWithContext({ roles: [], permissions: new Set(), hospitalId: h._id }, async () => {
      const now = new Date();
      const [low, expiring, expired] = await Promise.all([
        Item.countDocuments({ isActive: true, $expr: { $lte: ['$currentStock', '$reorderLevel'] } }),
        Batch.countDocuments({ quantity: { $gt: 0 }, expiryDate: { $gt: now, $lte: new Date(now.getTime() + 30 * DAY) } }),
        Batch.countDocuments({ quantity: { $gt: 0 }, expiryDate: { $lte: now } }),
      ]);
      const recipients = [...new Set([...(await usersWithPermission('inventory.manage')), ...(await usersWithPermission('pharmacy.dispense'))].map(String))];
      if (!recipients.length) return;
      const since = new Date(now.getTime() - DAY);
      const fresh = async (type: 'LowStock' | 'MedicineExpiry') => {
        const already = await Notification.distinct('userId', { type, createdAt: { $gte: since } });
        const sent = new Set(already.map(String));
        return recipients.filter((r) => !sent.has(r)).map((r) => new Types.ObjectId(r));
      };
      if (low > 0) {
        const userIds = await fresh('LowStock');
        if (userIds.length) await notify({ type: 'LowStock', title: 'Low stock', message: `${low} item(s) are at or below their reorder level.`, userIds, link: '/inventory?tab=alerts', priority: 'High' });
      }
      if (expiring + expired > 0) {
        const userIds = await fresh('MedicineExpiry');
        if (userIds.length) {
          await notify({
            type: 'MedicineExpiry',
            title: expired ? 'Expired stock on shelves' : 'Stock expiring soon',
            message: `${expired} expired batch(es) to write off, ${expiring} expiring within 30 days.`,
            userIds,
            link: '/inventory?tab=alerts',
            priority: expired ? 'High' : 'Normal',
          });
        }
      }
    }).catch((err) => logger.error({ err, hospitalId: h._id.toString() }, 'Stock alert job failed'));
  }
}

export function scheduleStockAlerts(everyMs = 6 * 60 * 60 * 1000) {
  const tick = () => void runStockAlerts().catch((err) => logger.error({ err }, 'Stock alert job failed'));
  setTimeout(tick, 30_000);
  return setInterval(tick, everyMs);
}
