import type { Types } from 'mongoose';
import type { z } from 'zod';
import {
  lineTotals,
  purchaseOrderWorkflow,
  purchaseRequestWorkflow,
  round2,
  type PurchaseRequestInput,
  type PurchaseRequestStatus,
  type convertPurchaseRequestSchema,
  type purchaseRequestListQuery,
  type GoodsReceiptInput,
  type PurchaseOrderInput,
  type PurchaseOrderStatus,
  type poListQuery,
  type supplierSchema,
} from '@hms/shared';
import { can, requireCtx } from '../../core/context';
import { notify } from '../../core/notifications/notify';
import { usersWithPermission } from '../identity/recipients';
import { withTransaction } from '../../core/db';
import { BusinessRuleError, ForbiddenError } from '../../core/errors';
import { diff, recordAudit, snapshot } from '../../core/audit/audit';
import { dateOnly, escapeRegex, oid, orNotFound, skipOf, sortBy } from '../../core/http';
import { nextNumber } from '../../core/numbering/numbering';
import { assertTransition } from '../../core/workflow';
import { Hospital } from '../organization/organization.models';
import { Item } from '../inventory/inventory.models';
import { receiveStock } from '../inventory/stock.service';
import { GoodsReceipt, PurchaseOrder, PurchaseRequest, Supplier, type PurchaseOrderDoc, type PurchaseRequestDoc } from './purchasing.models';

// ── Suppliers ───────────────────────────────────────────────────────────────
export async function listSuppliers(q: { search?: string; includeInactive?: boolean }) {
  const filter: Record<string, unknown> = q.includeInactive ? {} : { isActive: true };
  if (q.search) filter.$or = [{ name: new RegExp(escapeRegex(q.search), 'i') }, { code: q.search.toUpperCase() }];
  return Supplier.find(filter).sort({ name: 1 }).lean();
}

export async function createSupplier(input: z.infer<typeof supplierSchema>) {
  const s = await Supplier.create(input);
  await recordAudit({ action: 'supplier.created', module: 'Purchasing', entity: 'Supplier', entityId: s._id, after: s });
  return s.toObject();
}

export async function updateSupplier(id: string, input: z.infer<typeof supplierSchema>) {
  const s = orNotFound(await Supplier.findById(id), 'Supplier');
  const before = snapshot(s) as Record<string, unknown>;
  s.set(input);
  await s.save();
  await recordAudit({ action: 'supplier.updated', module: 'Purchasing', entity: 'Supplier', entityId: s._id, ...diff(before, snapshot(s) as Record<string, unknown>) });
  return s.toObject();
}

// ── Purchase orders ─────────────────────────────────────────────────────────
async function buildLines(lines: PurchaseOrderInput['items']) {
  const items = await Item.find({ _id: { $in: lines.map((l) => oid(l.itemId)) } }).lean();
  const byId = new Map(items.map((i) => [i._id.toString(), i]));
  const built = lines.map((l) => {
    const item = byId.get(l.itemId);
    if (!item) throw new BusinessRuleError('One or more items do not exist');
    const t = lineTotals(l);
    return { itemId: item._id, sku: item.sku, itemName: item.name, unit: item.unit, quantity: l.quantity, unitPrice: l.unitPrice, discount: t.discount, taxRate: l.taxRate, tax: t.tax, total: t.total };
  });
  const subtotal = round2(built.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const discountTotal = round2(built.reduce((s, l) => s + l.discount, 0));
  const taxTotal = round2(built.reduce((s, l) => s + l.tax, 0));
  return { items: built, subtotal, discountTotal, taxTotal, total: round2(subtotal - discountTotal + taxTotal) };
}

export async function listPurchaseOrders(q: z.infer<typeof poListQuery>) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.supplierId) filter.supplierId = oid(q.supplierId);
  if (q.search) filter.$or = [{ poNo: new RegExp(`^${escapeRegex(q.search.toUpperCase())}`) }, { supplierName: new RegExp(escapeRegex(q.search), 'i') }];
  const [items, total] = await Promise.all([
    PurchaseOrder.find(filter).select('-history').sort(sortBy(q.sort, { created: 'createdAt', poNo: 'poNo', total: 'total', status: 'status', expectedDelivery: 'expectedDelivery', supplier: 'supplierName' }, { createdAt: -1 })).skip(skipOf(q)).limit(q.pageSize).lean(),
    PurchaseOrder.countDocuments(filter),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

export async function getPurchaseOrder(id: string) {
  const po = orNotFound(await PurchaseOrder.findById(id).lean(), 'Purchase order');
  const receipts = await GoodsReceipt.find({ poId: po._id }).sort({ receivedAt: 1 }).lean();
  return { ...po, receipts };
}

export async function createPurchaseOrder(input: PurchaseOrderInput) {
  const c = requireCtx();
  const supplier = orNotFound(await Supplier.findOne({ _id: oid(input.supplierId), isActive: true }).lean(), 'Supplier');
  const h = orNotFound(await Hospital.findById(c.hospitalId).lean(), 'Hospital');
  return withTransaction(async () => {
    const poNo = await nextNumber('purchaseOrder', h.numbering?.purchaseOrder ?? 'PO-{yyyy}-{n:5}', h.code);
    const [po] = await PurchaseOrder.create([
      {
        poNo,
        supplierId: supplier._id,
        supplierName: supplier.name,
        ...(await buildLines(input.items)),
        expectedDelivery: input.expectedDelivery ? dateOnly(input.expectedDelivery) : undefined,
        notes: input.notes,
        requestedByName: c.userName,
        history: [{ status: 'Draft', byName: c.userName }],
      },
    ]);
    await recordAudit({ action: 'purchase_order.created', module: 'Purchasing', entity: 'PurchaseOrder', entityId: po._id, after: po });
    return po.toObject();
  });
}

export async function updatePurchaseOrder(id: string, input: PurchaseOrderInput) {
  return withTransaction(async () => {
    const po = orNotFound((await PurchaseOrder.findById(id)) as PurchaseOrderDoc | null, 'Purchase order');
    if (po.status !== 'Draft') throw new BusinessRuleError('Only draft purchase orders can be edited');
    const supplier = orNotFound(await Supplier.findById(input.supplierId).lean(), 'Supplier');
    const before = snapshot(po) as Record<string, unknown>;
    po.set({
      supplierId: supplier._id,
      supplierName: supplier.name,
      ...(await buildLines(input.items)),
      expectedDelivery: input.expectedDelivery ? dateOnly(input.expectedDelivery) : undefined,
      notes: input.notes,
    });
    await po.save();
    await recordAudit({ action: 'purchase_order.updated', module: 'Purchasing', entity: 'PurchaseOrder', entityId: po._id, ...diff(before, snapshot(po) as Record<string, unknown>) });
    return po.toObject();
  });
}

async function move(po: PurchaseOrderDoc, to: PurchaseOrderStatus, note?: string) {
  const c = requireCtx();
  assertTransition(purchaseOrderWorkflow, po.status as PurchaseOrderStatus, to);
  const from = po.status;
  po.status = to;
  po.history.push({ status: to, byName: c.userName, at: new Date(), note });
  await po.save();
  await recordAudit({ action: 'purchase_order.status_changed', module: 'Purchasing', entity: 'PurchaseOrder', entityId: po._id, before: { status: from }, after: { status: to }, meta: note ? { note } : undefined });
}

export type PoAction = 'submit' | 'approve' | 'reject' | 'order' | 'cancel';

/**
 * Approval is segregated: the person who raised the PO cannot approve it, and approving needs
 * purchasing.approve (checked at the route and again here).
 */
export async function actOnPurchaseOrder(id: string, action: PoAction, note?: string) {
  const c = requireCtx();
  return withTransaction(async () => {
    const po = orNotFound((await PurchaseOrder.findById(id)) as PurchaseOrderDoc | null, 'Purchase order');
    switch (action) {
      case 'submit':
        await move(po, 'PendingApproval', note);
        break;
      case 'approve':
      case 'reject':
        if (!c.permissions.has('purchasing.approve')) throw new ForbiddenError();
        if (po.createdBy && c.userId && po.createdBy.equals(c.userId)) throw new ForbiddenError('You cannot approve a purchase order you raised');
        if (action === 'approve') {
          po.approvedBy = c.userId;
          po.approvedByName = c.userName;
          po.approvedAt = new Date();
          await move(po, 'Approved', note);
        } else {
          if (!note) throw new BusinessRuleError('Give a reason for rejecting');
          await move(po, 'Draft', `Rejected: ${note}`);
        }
        break;
      case 'order':
        po.orderedAt = new Date();
        await move(po, 'Ordered', note);
        break;
      case 'cancel':
        if (po.items.some((l) => l.receivedQuantity > 0)) throw new BusinessRuleError('Goods have been received against this order; it cannot be cancelled');
        if (!note) throw new BusinessRuleError('Give a reason for cancelling');
        po.cancelReason = note;
        await move(po, 'Cancelled', note);
        break;
    }
    return po.toObject();
  });
}

/** Goods receipt: creates/tops up batches at the chosen location and advances the PO status. */
export async function receiveGoods(id: string, input: GoodsReceiptInput) {
  const c = requireCtx();
  const h = orNotFound(await Hospital.findById(c.hospitalId).lean(), 'Hospital');
  return withTransaction(async () => {
    const po = orNotFound((await PurchaseOrder.findById(id)) as PurchaseOrderDoc | null, 'Purchase order');
    if (!['Ordered', 'PartiallyReceived'].includes(po.status)) throw new BusinessRuleError(`Goods cannot be received on a ${po.status} purchase order`);
    const grnNo = await nextNumber('goodsReceipt', h.numbering?.goodsReceipt ?? 'GRN-{yyyy}-{n:5}', h.code);
    const grnLines = [];
    for (const l of input.lines) {
      const line = po.items.id(l.lineId);
      if (!line) throw new BusinessRuleError('Receipt line does not belong to this purchase order');
      const remaining = line.quantity - line.receivedQuantity;
      if (l.quantity > remaining) throw new BusinessRuleError(`${line.itemName}: only ${remaining} outstanding on this order`);
      const unitCost = round2(line.total / line.quantity); // landed cost incl. tax and discount
      const batch = await receiveStock(
        { itemId: line.itemId, batchNo: l.batchNo, location: input.location, expiryDate: dateOnly(l.expiryDate), mfgDate: l.mfgDate ? dateOnly(l.mfgDate) : undefined, quantity: l.quantity, unitCost, supplierId: po.supplierId, type: 'Purchase' },
        { refType: 'GoodsReceipt', refId: po._id, refNo: grnNo },
      );
      line.receivedQuantity += l.quantity;
      grnLines.push({ poLineId: line._id, itemId: line.itemId, itemName: line.itemName, batchId: batch._id, batchNo: l.batchNo, expiryDate: dateOnly(l.expiryDate), mfgDate: l.mfgDate ? dateOnly(l.mfgDate) : undefined, quantity: l.quantity, unitCost });
    }
    const [grn] = await GoodsReceipt.create([{ grnNo, poId: po._id, poNo: po.poNo, supplierId: po.supplierId, location: input.location, invoiceRef: input.invoiceRef, lines: grnLines, receivedByName: c.userName }]);
    const complete = po.items.every((l) => l.receivedQuantity >= l.quantity);
    await move(po, complete ? 'Received' : 'PartiallyReceived', `GRN ${grnNo}`);
    await recordAudit({ action: 'goods.received', module: 'Purchasing', entity: 'GoodsReceipt', entityId: grn._id, after: grn });
    return { grn: grn.toObject(), purchaseOrder: po.toObject() };
  });
}

// ── Purchase requests ───────────────────────────────────────────────────────
export type PrAction = 'submit' | 'approve' | 'reject' | 'cancel' | 'reopen';

export async function listPurchaseRequests(q: z.infer<typeof purchaseRequestListQuery>) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.search) filter.requestNo = new RegExp(`^${escapeRegex(q.search.toUpperCase())}`);
  const [items, total] = await Promise.all([
    PurchaseRequest.find(filter).select('-history').sort(sortBy(q.sort, { created: 'createdAt', requestNo: 'requestNo', status: 'status', neededBy: 'neededBy' }, { createdAt: -1 })).skip(skipOf(q)).limit(q.pageSize).lean(),
    PurchaseRequest.countDocuments(filter),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

export async function getPurchaseRequest(id: string) {
  return orNotFound(await PurchaseRequest.findById(id).lean(), 'Purchase request');
}

async function requestLines(lines: PurchaseRequestInput['items']) {
  const items = await Item.find({ _id: { $in: lines.map((l) => oid(l.itemId)) }, isActive: true }).lean();
  return lines.map((l) => {
    const item = items.find((i) => i._id.equals(l.itemId));
    if (!item) throw new BusinessRuleError('One or more items do not exist or are inactive');
    return { itemId: item._id, sku: item.sku, itemName: item.name, unit: item.unit, quantity: l.quantity, stockAtRequest: item.currentStock, note: l.note };
  });
}

export async function createPurchaseRequest(input: PurchaseRequestInput) {
  const c = requireCtx();
  const h = orNotFound(await Hospital.findById(c.hospitalId).lean(), 'Hospital');
  const items = await requestLines(input.items);
  return withTransaction(async () => {
    const requestNo = await nextNumber('purchaseRequest', 'PR-{yyyy}-{n:5}', h.code);
    const [pr] = await PurchaseRequest.create([{ requestNo, requestedByName: c.userName, neededBy: input.neededBy ? dateOnly(input.neededBy) : undefined, justification: input.justification, items, history: [{ status: 'Draft', byName: c.userName }] }]);
    await recordAudit({ action: 'purchase_request.created', module: 'Purchasing', entity: 'PurchaseRequest', entityId: pr._id, after: pr });
    return pr.toObject();
  });
}

export async function updatePurchaseRequest(id: string, input: PurchaseRequestInput) {
  const pr = orNotFound((await PurchaseRequest.findById(id)) as PurchaseRequestDoc | null, 'Purchase request');
  if (pr.status !== 'Draft') throw new BusinessRuleError('Only draft requests can be edited');
  const before = snapshot(pr) as Record<string, unknown>;
  pr.set({ justification: input.justification, neededBy: input.neededBy ? dateOnly(input.neededBy) : undefined, items: await requestLines(input.items) });
  await pr.save();
  await recordAudit({ action: 'purchase_request.updated', module: 'Purchasing', entity: 'PurchaseRequest', entityId: pr._id, ...diff(before, snapshot(pr) as Record<string, unknown>) });
  return pr.toObject();
}

export async function actOnPurchaseRequest(id: string, action: PrAction, note?: string) {
  const c = requireCtx();
  const target: Record<PrAction, PurchaseRequestStatus> = { submit: 'Submitted', approve: 'Approved', reject: 'Rejected', cancel: 'Cancelled', reopen: 'Draft' };
  const pr = await withTransaction(async () => {
    const pr = orNotFound((await PurchaseRequest.findById(id)) as PurchaseRequestDoc | null, 'Purchase request');
    if (action === 'approve' || action === 'reject') {
      if (!can('purchasing.approve')) throw new ForbiddenError();
      if (pr.createdBy && c.userId?.equals(pr.createdBy)) throw new ForbiddenError('A request must be approved by someone other than the requester');
      if (action === 'reject' && !note) throw new BusinessRuleError('Give a reason for rejecting');
      pr.set({ decisionByName: c.userName, decisionNote: note, decidedAt: new Date() });
    }
    assertTransition(purchaseRequestWorkflow, pr.status as PurchaseRequestStatus, target[action]);
    pr.status = target[action];
    pr.history.push({ status: pr.status, at: new Date(), byName: c.userName, note });
    await pr.save();
    await recordAudit({ action: `purchase_request.${pr.status.toLowerCase()}`, module: 'Purchasing', entity: 'PurchaseRequest', entityId: pr._id, after: { status: pr.status, note } });
    return pr;
  });
  if (action === 'submit') {
    const approvers = await usersWithPermission('purchasing.approve');
    if (approvers.length) await notify({ type: 'General', title: 'Purchase request to approve', message: `${pr.requestNo}: ${pr.items.length} item(s) requested by ${pr.requestedByName}`, userIds: approvers, link: `/purchasing?tab=requests` });
  }
  return pr.toObject();
}

/** Turns an approved request into a draft PO (prices default to each item's purchase price). */
export async function convertPurchaseRequest(id: string, input: z.infer<typeof convertPurchaseRequestSchema>) {
  const c = requireCtx();
  return withTransaction(async () => {
    const pr = orNotFound((await PurchaseRequest.findById(id)) as PurchaseRequestDoc | null, 'Purchase request');
    assertTransition(purchaseRequestWorkflow, pr.status as PurchaseRequestStatus, 'Converted');
    const items = await Item.find({ _id: { $in: pr.items.map((i) => i.itemId) } }).select('purchasePrice').lean();
    const price = (itemId: Types.ObjectId) => input.prices.find((p) => itemId.equals(p.itemId))?.unitPrice ?? items.find((i) => i._id.equals(itemId))?.purchasePrice ?? 0;
    const po = await createPurchaseOrder({
      supplierId: input.supplierId,
      expectedDelivery: input.expectedDelivery,
      notes: `From purchase request ${pr.requestNo}: ${pr.justification}`.slice(0, 500),
      items: pr.items.map((i) => ({ itemId: i.itemId.toString(), quantity: i.quantity, unitPrice: price(i.itemId), discount: 0, taxRate: 0 })),
    });
    pr.set({ status: 'Converted', poId: po._id, poNo: po.poNo });
    pr.history.push({ status: 'Converted', at: new Date(), byName: c.userName, note: po.poNo });
    await pr.save();
    await recordAudit({ action: 'purchase_request.converted', module: 'Purchasing', entity: 'PurchaseRequest', entityId: pr._id, after: { poNo: po.poNo } });
    return { request: pr.toObject(), purchaseOrder: po };
  });
}
