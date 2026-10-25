import type { z } from 'zod';
import type { ItemInput, itemListQuery, purchaseReturnSchema, stockAdjustmentSchema, transferSchema } from '@hms/shared';
import { withTransaction } from '../../core/db';
import { requireMedicineCategory } from '../organization/catalog';
import { diff, recordAudit, snapshot } from '../../core/audit/audit';
import { escapeRegex, oid, orNotFound, skipOf, sortBy } from '../../core/http';
import { BusinessRuleError, ConflictError } from '../../core/errors';
import { Batch, InventoryTransaction, Item, type BatchDoc } from './inventory.models';
import { Supplier } from '../purchasing/purchasing.models';
import { adjustStock, removeStock, transferStock } from './stock.service';

const DAY = 86_400_000;

export async function listItems(q: z.infer<typeof itemListQuery>) {
  const filter: Record<string, unknown> = {};
  if (q.category) filter.category = q.category;
  if (q.controlled) filter.isControlled = true;
  if (q.lowStock) filter.$expr = { $lte: ['$currentStock', '$reorderLevel'] };
  if (q.search) {
    const s = q.search.trim();
    filter.$or = [{ sku: s.toUpperCase() }, { searchName: new RegExp(escapeRegex(s.toLowerCase())) }];
  }
  const [items, total] = await Promise.all([
    Item.find(filter).sort(sortBy(q.sort, { name: 'name', sku: 'sku', stock: 'currentStock', category: 'category', reorderLevel: 'reorderLevel' }, { name: 1 })).skip(skipOf(q)).limit(q.pageSize).lean(),
    Item.countDocuments(filter),
  ]);
  const ids = items.map((i) => i._id);
  // Earliest usable expiry and expired quantity per item, for the list badges.
  const exp = await Batch.aggregate([
    { $match: { itemId: { $in: ids }, quantity: { $gt: 0 } } },
    {
      $group: {
        _id: '$itemId',
        nextExpiry: { $min: { $cond: [{ $gt: ['$expiryDate', new Date()] }, '$expiryDate', null] } },
        expiredQty: { $sum: { $cond: [{ $lte: ['$expiryDate', new Date()] }, '$quantity', 0] } },
      },
    },
  ]);
  const byId = new Map(exp.map((e) => [e._id.toString(), e]));
  return {
    items: items.map((i) => ({ ...i, nextExpiry: byId.get(i._id.toString())?.nextExpiry ?? null, expiredQty: byId.get(i._id.toString())?.expiredQty ?? 0, isLow: i.currentStock <= i.reorderLevel })),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

export async function getItem(id: string) {
  const item = orNotFound(await Item.findById(id).populate('defaultSupplierId', 'name code').lean(), 'Item');
  const [batches, transactions] = await Promise.all([
    Batch.find({ itemId: item._id, quantity: { $gt: 0 } }).sort({ expiryDate: 1 }).lean(),
    InventoryTransaction.find({ itemId: item._id }).sort({ at: -1 }).limit(100).lean(),
  ]);
  return { item, batches: batches.map((b) => ({ ...b, isExpired: b.expiryDate.getTime() <= Date.now() })), transactions };
}

async function assertSupplier(id?: string) {
  if (id && !(await Supplier.exists({ _id: oid(id) }))) throw new BusinessRuleError('Supplier not found');
}

export async function createItem(input: ItemInput) {
  await assertSupplier(input.defaultSupplierId);
  await requireMedicineCategory(input.therapeuticClass);
  const item = await Item.create({ ...input, defaultSupplierId: input.defaultSupplierId ? oid(input.defaultSupplierId) : undefined });
  await recordAudit({ action: 'item.created', module: 'Inventory', entity: 'Item', entityId: item._id, after: item });
  return item.toObject();
}

export async function updateItem(id: string, input: ItemInput) {
  await assertSupplier(input.defaultSupplierId);
  await requireMedicineCategory(input.therapeuticClass);
  const item = orNotFound(await Item.findById(id), 'Item');
  if (item.sku !== input.sku && (await Item.exists({ sku: input.sku, _id: { $ne: item._id } }))) throw new ConflictError('SKU already in use');
  const before = snapshot(item) as Record<string, unknown>;
  item.set({ ...input, defaultSupplierId: input.defaultSupplierId ? oid(input.defaultSupplierId) : undefined });
  await item.save();
  await recordAudit({ action: 'item.updated', module: 'Inventory', entity: 'Item', entityId: item._id, ...diff(before, snapshot(item) as Record<string, unknown>) });
  return item.toObject();
}

export async function adjust(input: z.infer<typeof stockAdjustmentSchema>) {
  return withTransaction(async () => {
    const batch = await adjustStock(oid(input.batchId), input.type, input.quantity, { refType: 'Manual', reason: input.reason });
    await recordAudit({
      action: `stock.${input.type.toLowerCase()}`,
      module: 'Inventory',
      entity: 'Batch',
      entityId: batch._id,
      after: { batchNo: batch.batchNo, quantity: input.quantity, reason: input.reason, remaining: batch.quantity },
    });
    return batch.toObject();
  });
}

export async function transfer(input: z.infer<typeof transferSchema>) {
  return withTransaction(async () => {
    const batch = await transferStock(oid(input.batchId), input.to, input.quantity, { refType: 'Transfer' });
    await recordAudit({ action: 'stock.transferred', module: 'Inventory', entity: 'Batch', entityId: batch._id, after: { batchNo: batch.batchNo, to: input.to, quantity: input.quantity } });
    return batch.toObject();
  });
}

export async function returnToSupplier(input: z.infer<typeof purchaseReturnSchema>) {
  return withTransaction(async () => {
    const batch = orNotFound((await Batch.findById(input.batchId)) as BatchDoc | null, 'Batch');
    if (!batch.supplierId) throw new BusinessRuleError('This batch has no supplier on record');
    const updated = await removeStock(batch._id, input.quantity, 'PurchaseReturn', { refType: 'PurchaseReturn', refId: batch.supplierId, reason: input.reason }, { allowExpired: true });
    await recordAudit({ action: 'stock.returned_to_supplier', module: 'Inventory', entity: 'Batch', entityId: batch._id, after: { batchNo: batch.batchNo, quantity: input.quantity, reason: input.reason } });
    return updated.toObject();
  });
}

export async function ledger(q: { page: number; pageSize: number; type?: string; itemId?: string }) {
  const filter: Record<string, unknown> = {};
  if (q.type) filter.type = q.type;
  if (q.itemId) filter.itemId = oid(q.itemId);
  const [items, total] = await Promise.all([
    InventoryTransaction.find(filter).populate('itemId', 'name sku unit').sort({ at: -1 }).skip(skipOf(q)).limit(q.pageSize).lean(),
    InventoryTransaction.countDocuments(filter),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

/** Low-stock items and batches expiring within `days` (plus already-expired stock still on shelves). */
export async function alerts(days = 90) {
  const now = new Date();
  const [lowStock, expiring] = await Promise.all([
    Item.find({ isActive: true, $expr: { $lte: ['$currentStock', '$reorderLevel'] } }).sort({ currentStock: 1 }).limit(200).lean(),
    Batch.find({ quantity: { $gt: 0 }, expiryDate: { $lte: new Date(now.getTime() + days * DAY) } })
      .populate('itemId', 'name sku unit')
      .sort({ expiryDate: 1 })
      .limit(300)
      .lean(),
  ]);
  return {
    lowStock,
    expiring: expiring.map((b) => ({ ...b, isExpired: b.expiryDate <= now, daysLeft: Math.ceil((b.expiryDate.getTime() - now.getTime()) / DAY) })),
  };
}

/** Stock-status summary for dashboards. */
export async function stockSummary() {
  const now = new Date();
  const [byCategory, low, expired, expiring30] = await Promise.all([
    Item.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$category', items: { $sum: 1 }, value: { $sum: { $multiply: ['$currentStock', '$purchasePrice'] } }, low: { $sum: { $cond: [{ $lte: ['$currentStock', '$reorderLevel'] }, 1, 0] } } } }]),
    Item.countDocuments({ isActive: true, category: 'Medicine', $expr: { $lte: ['$currentStock', '$reorderLevel'] } }),
    Batch.countDocuments({ quantity: { $gt: 0 }, expiryDate: { $lte: now } }),
    Batch.countDocuments({ quantity: { $gt: 0 }, expiryDate: { $gt: now, $lte: new Date(now.getTime() + 30 * DAY) } }),
  ]);
  const months = await Batch.aggregate([
    { $match: { quantity: { $gt: 0 }, expiryDate: { $gt: now, $lte: new Date(now.getTime() + 180 * DAY) } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$expiryDate' } }, batches: { $sum: 1 }, units: { $sum: '$quantity' } } },
    { $sort: { _id: 1 } },
  ]);
  return {
    lowStockMedicines: low,
    expiredBatches: expired,
    expiringIn30Days: expiring30,
    byCategory: byCategory.map((c) => ({ category: c._id, items: c.items, value: Math.round(c.value), low: c.low })),
    expiryByMonth: months.map((m) => ({ month: m._id, batches: m.batches, units: m.units })),
  };
}
