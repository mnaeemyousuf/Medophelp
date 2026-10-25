import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { DOSAGE_FORMS, INVENTORY_TX_TYPES, ITEM_CATEGORIES, STOCK_LOCATIONS } from '@hms/shared';
import { basePlugin, softDeleteFields, tenantField } from '../../core/plugins/base.plugin';

/**
 * Item master for everything the hospital stocks. Medicines are items with category "Medicine"
 * plus pharmaceutical fields (the Medicines + InventoryItems tables as one collection).
 * `currentStock` is a denormalised total of usable batch quantities, maintained inside the same
 * transaction as every stock movement.
 */
const itemSchema = new Schema({
  ...tenantField,
  ...softDeleteFields,
  sku: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  searchName: { type: String, index: true },
  category: { type: String, enum: ITEM_CATEGORIES, required: true, index: true },
  genericName: String,
  therapeuticClass: { type: String, index: true },
  form: { type: String, enum: DOSAGE_FORMS },
  strength: String,
  unit: { type: String, required: true },
  defaultSupplierId: { type: Schema.Types.ObjectId, ref: 'Supplier' },
  purchasePrice: { type: Number, required: true, min: 0 },
  sellingPrice: { type: Number, required: true, min: 0 },
  reorderLevel: { type: Number, default: 0, min: 0 },
  isControlled: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  currentStock: { type: Number, default: 0, min: 0 },
  stockByLocation: {
    'Main Store': { type: Number, default: 0, min: 0 },
    Pharmacy: { type: Number, default: 0, min: 0 },
  },
});
itemSchema.plugin(basePlugin, { softDelete: true });
itemSchema.index({ hospitalId: 1, sku: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
itemSchema.pre('validate', function (next) {
  this.searchName = [this.name, this.genericName].filter(Boolean).join(' ').toLowerCase();
  next();
});
export const Item = model('Item', itemSchema);
export type ItemDoc = HydratedDocument<InferSchemaType<typeof itemSchema>>;

/** Stock of one batch at one location (the MedicineBatches table, generalised to all items). */
const batchSchema = new Schema({
  ...tenantField,
  itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  batchNo: { type: String, required: true, trim: true },
  location: { type: String, enum: STOCK_LOCATIONS, required: true },
  expiryDate: { type: Date, required: true },
  mfgDate: Date,
  quantity: { type: Number, required: true, min: 0 },
  unitCost: { type: Number, default: 0, min: 0 },
  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier' },
  receivedAt: { type: Date, default: () => new Date() },
});
batchSchema.plugin(basePlugin);
batchSchema.index({ hospitalId: 1, itemId: 1, batchNo: 1, location: 1 }, { unique: true });
batchSchema.index({ hospitalId: 1, itemId: 1, location: 1, expiryDate: 1 }); // FEFO lookups
batchSchema.index({ hospitalId: 1, expiryDate: 1, quantity: 1 }); // expiry alerts
export const Batch = model('Batch', batchSchema);
export type BatchDoc = HydratedDocument<InferSchemaType<typeof batchSchema>>;

/** Append-only stock ledger. Every quantity change on a batch writes exactly one row. */
const txSchema = new Schema({
  ...tenantField,
  itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
  batchNo: String,
  location: { type: String, enum: STOCK_LOCATIONS },
  type: { type: String, enum: INVENTORY_TX_TYPES, required: true },
  quantity: { type: Number, required: true }, // signed: + in, - out
  balanceAfter: { type: Number, required: true }, // item total after this movement
  unitCost: Number,
  refType: String, // 'GoodsReceipt' | 'Dispense' | 'PurchaseReturn' | 'Transfer' | 'Manual'
  refId: { type: Schema.Types.ObjectId },
  refNo: String,
  reason: String,
  byName: String,
  at: { type: Date, default: () => new Date() },
});
txSchema.plugin(basePlugin);
txSchema.index({ hospitalId: 1, itemId: 1, at: -1 });
txSchema.index({ hospitalId: 1, type: 1, at: -1 });
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  txSchema.pre(op as never, function (next: (e?: Error) => void) {
    next(new Error('Stock ledger entries are immutable'));
  });
}
export const InventoryTransaction = model('InventoryTransaction', txSchema);
