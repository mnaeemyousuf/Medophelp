import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { INVOICE_SOURCES } from '@hms/shared';
import { basePlugin } from '../../core/plugins/base.plugin';

/** Tenant root. Branding, numbering formats, tax and notification switches are data, not code. */
const hospitalSchema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  logoUrl: String,
  address: String,
  city: String,
  phone: String,
  email: String,
  website: String,
  currency: { type: String, default: 'PKR' },
  timeZone: { type: String, default: 'Asia/Karachi' },
  defaultTaxRate: { type: Number, default: 0, min: 0, max: 100 },
  isActive: { type: Boolean, default: true },
  numbering: {
    mrn: { type: String, default: '{code}-{yyyy}-{n:6}' },
    invoice: { type: String, default: 'INV-{yyyy}-{n:6}' },
    receipt: { type: String, default: 'RCT-{yyyy}-{n:6}' },
    prescription: { type: String, default: 'RX-{yyyy}-{n:6}' },
    emergency: { type: String, default: 'ER-{yyyy}-{n:6}' },
    labOrder: { type: String, default: 'LAB-{yyyy}-{n:6}' },
    visit: { type: String, default: 'V-{yyyy}-{n:6}' },
    appointment: { type: String, default: 'APT-{yyyy}-{n:6}' },
    purchaseOrder: { type: String, default: 'PO-{yyyy}-{n:5}' },
    goodsReceipt: { type: String, default: 'GRN-{yyyy}-{n:5}' },
    dispense: { type: String, default: 'DSP-{yyyy}-{n:6}' },
    admission: { type: String, default: 'ADM-{yyyy}-{n:6}' },
    claim: { type: String, default: 'CLM-{yyyy}-{n:5}' },
  },
  /** HR policy: shift, grace period, weekly off, holidays and annual leave entitlements. */
  hr: {
    workStart: { type: String, default: '09:00' },
    workEnd: { type: String, default: '17:00' },
    graceMinutes: { type: Number, default: 10 },
    halfDayMinutes: { type: Number, default: 240 },
    weeklyOff: { type: [Number], default: [7] },
    holidays: { type: [String], default: [] },
    leaveEntitlements: {
      Annual: { type: Number, default: 20 },
      Sick: { type: Number, default: 10 },
      Casual: { type: Number, default: 8 },
      Maternity: { type: Number, default: 90 },
      Other: { type: Number, default: 3 },
    },
  },
  notifications: {
    email: { type: Boolean, default: true },
    sms: { type: Boolean, default: false },
    push: { type: Boolean, default: false },
  },
  /** Configurable lists; see `catalogSchema` in shared. Missing values fall back to DEFAULT_CATALOG. */
  catalog: {
    appointmentTypes: [new Schema({ code: String, label: String, feeBasis: { type: String, enum: ['Consultation', 'FollowUp'] }, isActive: { type: Boolean, default: true } }, { _id: false })],
    paymentMethods: [String],
    medicineCategories: [String],
    designations: [String],
    medicationScheduleFrom: { type: String, enum: ['Prescribed', 'Dispensed'] },
  },
});
hospitalSchema.plugin(basePlugin, { tenant: false });
export const Hospital = model('Hospital', hospitalSchema);
export type HospitalDoc = HydratedDocument<InferSchemaType<typeof hospitalSchema>>;

const departmentSchema = new Schema({
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: String,
  isClinical: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
});
departmentSchema.plugin(basePlugin, { softDelete: true });
departmentSchema.index({ hospitalId: 1, code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
export const Department = model('Department', departmentSchema);

/** Billable service catalogue: consultations, procedures, room charges... */
const serviceSchema = new Schema({
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
  category: { type: String, enum: INVOICE_SOURCES, required: true },
  price: { type: Number, required: true, min: 0 },
  taxable: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
});
serviceSchema.plugin(basePlugin, { softDelete: true });
serviceSchema.index({ hospitalId: 1, code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
export const Service = model('Service', serviceSchema);
