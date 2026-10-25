import { z } from 'zod';
import { DOSAGE_FORMS, ITEM_CATEGORIES, PO_STATUSES, PURCHASE_REQUEST_STATUSES, STOCK_LOCATIONS } from '../enums';
import { email, isoDate, money, objectId, optionalString, paginationQuery, phone } from './common';

const qty = z.coerce.number().int('Whole units only').positive('Quantity must be positive').max(1_000_000);

export const itemSchema = z
  .object({
    sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, '2–20 letters/digits'),
    name: z.string().trim().min(2).max(120),
    category: z.enum(ITEM_CATEGORIES),
    genericName: optionalString(120),
    /** Therapeutic class from the hospital's configured medicine categories (medicines only). */
    therapeuticClass: optionalString(60),
    form: z.enum(DOSAGE_FORMS).optional(),
    strength: optionalString(40),
    unit: z.string().trim().min(1).max(20),
    defaultSupplierId: objectId.optional(),
    purchasePrice: money,
    sellingPrice: money,
    reorderLevel: z.coerce.number().int().min(0).max(1_000_000),
    isControlled: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .refine((i) => i.sellingPrice >= i.purchasePrice, { path: ['sellingPrice'], message: 'Selling price is below purchase price' });
export type ItemInput = z.infer<typeof itemSchema>;

export const itemListQuery = paginationQuery.extend({
  category: z.enum(ITEM_CATEGORIES).optional(),
  lowStock: z.coerce.boolean().optional(),
  controlled: z.coerce.boolean().optional(),
});

export const supplierSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,15}$/),
  name: z.string().trim().min(2).max(150),
  contactPerson: optionalString(100),
  phone: phone.optional(),
  email: email.optional().or(z.literal('').transform(() => undefined)),
  address: optionalString(300),
  taxNumber: optionalString(40),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  isActive: z.boolean().default(true),
});

export const stockAdjustmentSchema = z.object({
  batchId: objectId,
  type: z.enum(['Adjustment', 'Damage', 'Expiry', 'Consumption']),
  /** Signed for Adjustment (count corrections up or down); positive quantity removed for the others. */
  quantity: z.coerce.number().int().refine((n) => n !== 0, 'Quantity cannot be zero').refine((n) => Math.abs(n) <= 1_000_000, 'Too large'),
  reason: z.string().trim().min(3, 'Give a reason').max(300),
});

export const transferSchema = z.object({
  batchId: objectId,
  to: z.enum(STOCK_LOCATIONS),
  quantity: qty,
});

export const purchaseReturnSchema = z.object({
  batchId: objectId,
  quantity: qty,
  reason: z.string().trim().min(3).max(300),
});

export const poLineSchema = z.object({
  itemId: objectId,
  quantity: qty,
  unitPrice: money,
  discount: money.default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
});

export const purchaseOrderSchema = z.object({
  supplierId: objectId,
  expectedDelivery: isoDate.optional(),
  notes: optionalString(500),
  items: z.array(poLineSchema).min(1, 'Add at least one item').max(200),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;

// ── Purchase requests (requisitions before a PO) ───────────────────────────
export const purchaseRequestSchema = z.object({
  neededBy: isoDate.optional(),
  justification: z.string().trim().min(3, 'Explain why the stock is needed').max(500),
  items: z
    .array(z.object({ itemId: objectId, quantity: qty, note: optionalString(200) }))
    .min(1, 'Add at least one item')
    .max(100)
    .refine((l) => new Set(l.map((x) => x.itemId)).size === l.length, 'Each item only once'),
});
export type PurchaseRequestInput = z.infer<typeof purchaseRequestSchema>;

export const purchaseRequestListQuery = paginationQuery.extend({ status: z.enum(PURCHASE_REQUEST_STATUSES).optional() });

/** Converting an approved request: choose the supplier and confirm prices (default: item purchase price). */
export const convertPurchaseRequestSchema = z.object({
  supplierId: objectId,
  expectedDelivery: isoDate.optional(),
  prices: z.array(z.object({ itemId: objectId, unitPrice: money })).max(100).default([]),
});

export const goodsReceiptSchema = z.object({
  location: z.enum(STOCK_LOCATIONS).default('Main Store'),
  invoiceRef: optionalString(60),
  lines: z
    .array(
      z.object({
        lineId: objectId,
        quantity: qty,
        batchNo: z.string().trim().min(1, 'Batch number is required').max(40),
        expiryDate: isoDate,
        mfgDate: isoDate.optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type GoodsReceiptInput = z.infer<typeof goodsReceiptSchema>;

export const poListQuery = paginationQuery.extend({
  status: z.enum(PO_STATUSES).optional(),
  supplierId: objectId.optional(),
});

export const dispenseSchema = z.object({
  lines: z
    .array(
      z.object({
        prescriptionItemId: objectId,
        itemId: objectId,
        quantity: qty,
      }),
    )
    .min(1, 'Nothing to dispense')
    .max(50),
  /** Second person present for controlled medicines (required if any line is controlled). */
  witnessName: optionalString(100),
  notes: optionalString(300),
});
export type DispenseInput = z.infer<typeof dispenseSchema>;
