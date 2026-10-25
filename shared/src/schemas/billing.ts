import { z } from 'zod';
import { INVOICE_SOURCES, INVOICE_STATUSES, PAYMENT_METHODS } from '../enums';
import { isoDate, money, objectId, optionalString, paginationQuery } from './common';

export const invoiceLineSchema = z.object({
  serviceId: objectId.optional(),
  description: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().positive('Quantity must be positive').max(10000),
  unitPrice: money,
  discount: money.default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;

export const createInvoiceSchema = z.object({
  patientId: objectId,
  visitId: objectId.optional(),
  source: z.enum(INVOICE_SOURCES).default('Other'),
  items: z.array(invoiceLineSchema).min(1, 'Add at least one line').max(200),
  notes: optionalString(500),
  issue: z.boolean().default(true),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const addInvoiceLinesSchema = z.object({
  items: z.array(invoiceLineSchema).min(1).max(200),
});

export const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive('Amount must be positive').max(100_000_000),
  method: z.enum(PAYMENT_METHODS),
  reference: optionalString(100),
  notes: optionalString(300),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const refundSchema = z.object({
  paymentId: objectId,
  amount: z.coerce.number().positive().max(100_000_000),
  reason: z.string().trim().min(3).max(300),
});

export const cancelInvoiceSchema = z.object({ reason: z.string().trim().min(3).max(300) });

export const invoiceListQuery = paginationQuery.extend({
  status: z.enum(INVOICE_STATUSES).optional(),
  source: z.enum(INVOICE_SOURCES).optional(),
  patientId: objectId.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  outstandingOnly: z.coerce.boolean().optional(),
});
