import { Types } from 'mongoose';
import { allocateFefo, type InventoryTxType, type StockLocation } from '@hms/shared';
import { requireCtx } from '../../core/context';
import { BusinessRuleError, NotFoundError } from '../../core/errors';
import { Batch, InventoryTransaction, Item, type BatchDoc } from './inventory.models';

/**
 * The only code allowed to change stock. Callers must run inside withTransaction(): the batch,
 * the item totals and the ledger row commit together or not at all. Decrements use a conditional
 * update (`quantity >= n`) so concurrent dispenses can never drive a batch negative.
 */

export interface StockRef {
  refType: string;
  refId?: Types.ObjectId;
  refNo?: string;
  reason?: string;
}

async function bumpItem(itemId: Types.ObjectId, location: StockLocation, delta: number) {
  const item = await Item.findOneAndUpdate(
    { _id: itemId },
    { $inc: { currentStock: delta, [`stockByLocation.${location}`]: delta } },
    { new: true },
  );
  if (!item) throw new NotFoundError('Item');
  if (item.currentStock < 0) throw new BusinessRuleError('Stock would become negative');
  return item;
}

async function ledger(batch: BatchDoc, type: InventoryTxType, quantity: number, balanceAfter: number, ref: StockRef) {
  await InventoryTransaction.create([
    {
      itemId: batch.itemId,
      batchId: batch._id,
      batchNo: batch.batchNo,
      location: batch.location,
      type,
      quantity,
      balanceAfter,
      unitCost: batch.unitCost,
      refType: ref.refType,
      refId: ref.refId,
      refNo: ref.refNo,
      reason: ref.reason,
      byName: requireCtx().userName,
    },
  ]);
}

export interface ReceiveArgs {
  itemId: Types.ObjectId;
  batchNo: string;
  location: StockLocation;
  expiryDate: Date;
  mfgDate?: Date;
  quantity: number;
  unitCost: number;
  supplierId?: Types.ObjectId;
  type?: Extract<InventoryTxType, 'Purchase' | 'TransferIn' | 'Adjustment'>;
}

/** Adds stock to a batch at a location, creating the batch on first receipt. */
export async function receiveStock(args: ReceiveArgs, ref: StockRef) {
  if (args.quantity <= 0) throw new BusinessRuleError('Quantity must be positive');
  if (args.expiryDate.getTime() <= Date.now()) throw new BusinessRuleError(`Batch ${args.batchNo} is already expired`);
  let batch = (await Batch.findOne({ itemId: args.itemId, batchNo: args.batchNo, location: args.location })) as BatchDoc | null;
  if (batch) {
    if (batch.expiryDate.toISOString().slice(0, 10) !== args.expiryDate.toISOString().slice(0, 10)) {
      throw new BusinessRuleError(`Batch ${args.batchNo} already exists with a different expiry date`);
    }
    batch = (await Batch.findOneAndUpdate({ _id: batch._id }, { $inc: { quantity: args.quantity } }, { new: true })) as BatchDoc;
  } else {
    [batch] = (await Batch.create([
      {
        itemId: args.itemId,
        batchNo: args.batchNo,
        location: args.location,
        expiryDate: args.expiryDate,
        mfgDate: args.mfgDate,
        quantity: args.quantity,
        unitCost: args.unitCost,
        supplierId: args.supplierId,
      },
    ])) as BatchDoc[];
  }
  const item = await bumpItem(args.itemId, args.location, args.quantity);
  await ledger(batch, args.type ?? 'Purchase', args.quantity, item.currentStock, ref);
  return batch;
}

/** Removes stock from one batch. Throws if the batch does not hold enough. */
export async function removeStock(batchId: Types.ObjectId, quantity: number, type: InventoryTxType, ref: StockRef, opts: { allowExpired?: boolean } = {}) {
  if (quantity <= 0) throw new BusinessRuleError('Quantity must be positive');
  const existing = (await Batch.findById(batchId)) as BatchDoc | null;
  if (!existing) throw new NotFoundError('Batch');
  if (!opts.allowExpired && existing.expiryDate.getTime() <= Date.now()) {
    throw new BusinessRuleError(`Batch ${existing.batchNo} has expired and cannot be issued`);
  }
  const batch = (await Batch.findOneAndUpdate({ _id: batchId, quantity: { $gte: quantity } }, { $inc: { quantity: -quantity } }, { new: true })) as BatchDoc | null;
  if (!batch) throw new BusinessRuleError(`Only ${existing.quantity} left in batch ${existing.batchNo}`, 'insufficient_stock');
  const item = await bumpItem(batch.itemId, batch.location as StockLocation, -quantity);
  await ledger(batch, type, -quantity, item.currentStock, ref);
  return batch;
}

/** FEFO allocation across a location's batches, then removal. Rejects partial fulfilment. */
export async function issueFefo(itemId: Types.ObjectId, location: StockLocation, quantity: number, type: InventoryTxType, ref: StockRef) {
  const batches = await Batch.find({ itemId, location, quantity: { $gt: 0 } }).lean();
  const plan = allocateFefo(
    batches.map((b) => ({ id: b._id.toString(), batchNo: b.batchNo, expiryDate: b.expiryDate, quantity: b.quantity })),
    quantity,
  );
  if (plan.shortfall > 0) {
    const item = await Item.findById(itemId).select('name').lean();
    throw new BusinessRuleError(`Insufficient stock for ${item?.name ?? 'item'}: ${plan.available} available in ${location}, ${quantity} requested`, 'insufficient_stock');
  }
  for (const a of plan.allocations) await removeStock(new Types.ObjectId(a.batchId), a.quantity, type, ref);
  return plan.allocations;
}

/** Moves quantity of a batch between locations (store → pharmacy). */
export async function transferStock(batchId: Types.ObjectId, to: StockLocation, quantity: number, ref: StockRef) {
  const source = (await Batch.findById(batchId)) as BatchDoc | null;
  if (!source) throw new NotFoundError('Batch');
  if (source.location === to) throw new BusinessRuleError('Source and destination are the same');
  await removeStock(batchId, quantity, 'TransferOut', { ...ref, reason: `To ${to}` });
  return receiveStock(
    { itemId: source.itemId, batchNo: source.batchNo, location: to, expiryDate: source.expiryDate, mfgDate: source.mfgDate ?? undefined, quantity, unitCost: source.unitCost, supplierId: source.supplierId ?? undefined, type: 'TransferIn' },
    { ...ref, reason: `From ${source.location}` },
  );
}

/** Count correction (+/-), or write-off of damaged/expired/consumed stock. */
export async function adjustStock(batchId: Types.ObjectId, type: 'Adjustment' | 'Damage' | 'Expiry' | 'Consumption', quantity: number, ref: StockRef) {
  if (type === 'Adjustment' && quantity > 0) {
    const batch = (await Batch.findById(batchId)) as BatchDoc | null;
    if (!batch) throw new NotFoundError('Batch');
    const updated = (await Batch.findOneAndUpdate({ _id: batchId }, { $inc: { quantity } }, { new: true })) as BatchDoc;
    const item = await bumpItem(updated.itemId, updated.location as StockLocation, quantity);
    await ledger(updated, 'Adjustment', quantity, item.currentStock, ref);
    return updated;
  }
  // Removals: expired stock may only leave through Expiry/Damage write-offs.
  return removeStock(batchId, Math.abs(quantity), type, ref, { allowExpired: type === 'Expiry' || type === 'Damage' || type === 'Adjustment' });
}

/** Usable (non-expired) quantity of an item at a location. */
export async function usableStock(itemId: Types.ObjectId, location: StockLocation) {
  const rows = await Batch.aggregate([
    { $match: { itemId, location, quantity: { $gt: 0 }, expiryDate: { $gt: new Date() } } },
    { $group: { _id: null, qty: { $sum: '$quantity' } } },
  ]);
  return (rows[0]?.qty as number) ?? 0;
}
