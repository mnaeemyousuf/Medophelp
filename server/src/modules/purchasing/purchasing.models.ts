import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { PO_STATUSES, PURCHASE_REQUEST_STATUSES, STOCK_LOCATIONS } from '@hms/shared';
import { actorFields, basePlugin, softDeleteFields } from '../../core/plugins/base.plugin';

const supplierSchema = new Schema({
  ...softDeleteFields,
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  contactPerson: String,
  phone: String,
  email: String,
  address: String,
  taxNumber: String,
  paymentTermsDays: { type: Number, default: 30 },
  isActive: { type: Boolean, default: true },
});
supplierSchema.plugin(basePlugin, { softDelete: true });
supplierSchema.index({ hospitalId: 1, code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
export const Supplier = model('Supplier', supplierSchema);

const poLineSchema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  sku: String,
  itemName: { type: String, required: true },
  unit: String,
  quantity: { type: Number, required: true, min: 1 },
  receivedQuantity: { type: Number, default: 0, min: 0 },
  unitPrice: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0 },
  taxRate: { type: Number, default: 0, min: 0 },
  tax: { type: Number, default: 0 },
  total: { type: Number, required: true },
});

const poHistorySchema = new Schema(
  { status: { type: String, enum: PO_STATUSES }, at: { type: Date, default: () => new Date() }, byName: String, note: String },
  { _id: false },
);

const purchaseOrderSchema = new Schema({
  ...actorFields,
  poNo: { type: String, required: true },
  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
  supplierName: String,
  status: { type: String, enum: PO_STATUSES, default: 'Draft', index: true },
  items: { type: [poLineSchema], validate: (v: unknown[]) => v.length > 0 },
  subtotal: { type: Number, default: 0 },
  discountTotal: { type: Number, default: 0 },
  taxTotal: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  expectedDelivery: Date,
  notes: String,
  requestedByName: String,
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  approvedByName: String,
  approvedAt: Date,
  orderedAt: Date,
  cancelReason: String,
  history: [poHistorySchema],
});
purchaseOrderSchema.plugin(basePlugin);
purchaseOrderSchema.index({ hospitalId: 1, poNo: 1 }, { unique: true });
export const PurchaseOrder = model('PurchaseOrder', purchaseOrderSchema);
export type PurchaseOrderDoc = HydratedDocument<InferSchemaType<typeof purchaseOrderSchema>>;

const grnLineSchema = new Schema(
  {
    poLineId: { type: Schema.Types.ObjectId, required: true },
    itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
    itemName: String,
    batchId: { type: Schema.Types.ObjectId, ref: 'Batch' },
    batchNo: { type: String, required: true },
    expiryDate: { type: Date, required: true },
    mfgDate: Date,
    quantity: { type: Number, required: true, min: 1 },
    unitCost: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

/** Goods received against a purchase order; each line becomes (or tops up) a batch. */
const goodsReceiptSchema = new Schema({
  grnNo: { type: String, required: true },
  poId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true, index: true },
  poNo: String,
  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
  location: { type: String, enum: STOCK_LOCATIONS, required: true },
  invoiceRef: String,
  lines: [grnLineSchema],
  receivedByName: String,
  receivedAt: { type: Date, default: () => new Date() },
});
goodsReceiptSchema.plugin(basePlugin);
goodsReceiptSchema.index({ hospitalId: 1, grnNo: 1 }, { unique: true });
export const GoodsReceipt = model('GoodsReceipt', goodsReceiptSchema);

/** Requisition from pharmacy / stores; approved by purchasing and converted into a draft PO. */
const purchaseRequestSchema = new Schema({
  ...actorFields,
  requestNo: { type: String, required: true },
  status: { type: String, enum: PURCHASE_REQUEST_STATUSES, default: 'Draft', index: true },
  requestedByName: String,
  neededBy: Date,
  justification: { type: String, required: true },
  items: [
    new Schema({
      itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
      sku: String,
      itemName: { type: String, required: true },
      unit: String,
      quantity: { type: Number, required: true, min: 1 },
      stockAtRequest: Number,
      note: String,
    }),
  ],
  decisionByName: String,
  decisionNote: String,
  decidedAt: Date,
  poId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder' },
  poNo: String,
  history: [new Schema({ status: String, at: { type: Date, default: () => new Date() }, byName: String, note: String }, { _id: false })],
});
purchaseRequestSchema.plugin(basePlugin);
purchaseRequestSchema.index({ hospitalId: 1, requestNo: 1 }, { unique: true });
export const PurchaseRequest = model('PurchaseRequest', purchaseRequestSchema);
export type PurchaseRequestDoc = HydratedDocument<InferSchemaType<typeof purchaseRequestSchema>>;
