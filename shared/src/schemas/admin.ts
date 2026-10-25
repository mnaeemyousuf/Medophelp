import { z } from 'zod';
import { EMPLOYMENT_TYPES, GENDERS, INVOICE_SOURCES, PAYMENT_METHODS } from '../enums';
import { email, isoDate, money, objectId, optionalString, passwordPolicy, phone, time24 } from './common';

/**
 * Hospital-configurable lists (Admin → Hospital settings). Codes are stored on records; labels can
 * change freely. Deactivate instead of deleting so historical records keep a valid code.
 */
export const appointmentTypeSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9]{1,23}$/, 'Letters/digits, no spaces'),
  label: z.string().trim().min(2).max(40),
  /** Which doctor fee the consultation is billed at. */
  feeBasis: z.enum(['Consultation', 'FollowUp']),
  isActive: z.boolean().default(true),
});
export const catalogSchema = z
  .object({
    appointmentTypes: z.array(appointmentTypeSchema).min(1).max(20),
    paymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1, 'Enable at least one payment method'),
    medicineCategories: z.array(z.string().trim().min(2).max(60)).max(60),
    /** Job titles for employees and offers. Empty = free text; once defined, only these are accepted. */
    designations: z.array(z.string().trim().min(2).max(80)).max(200).default([]),
    /** When reminder schedules start: when the doctor prescribes, or when the pharmacy dispenses. */
    medicationScheduleFrom: z.enum(['Prescribed', 'Dispensed']),
  })
  .refine((c) => new Set(c.appointmentTypes.map((t) => t.code.toLowerCase())).size === c.appointmentTypes.length, { path: ['appointmentTypes'], message: 'Appointment type codes must be unique' })
  .refine((c) => c.appointmentTypes.some((t) => t.isActive), { path: ['appointmentTypes'], message: 'Keep at least one appointment type active' })
  .refine((c) => new Set(c.medicineCategories.map((m) => m.toLowerCase())).size === c.medicineCategories.length, { path: ['medicineCategories'], message: 'Categories must be unique' })
  .refine((c) => new Set(c.designations.map((m) => m.toLowerCase())).size === c.designations.length, { path: ['designations'], message: 'Designations must be unique' });
export type Catalog = z.infer<typeof catalogSchema>;

export const DEFAULT_CATALOG: Catalog = {
  appointmentTypes: [
    { code: 'New', label: 'New consultation', feeBasis: 'Consultation', isActive: true },
    { code: 'FollowUp', label: 'Follow-up', feeBasis: 'FollowUp', isActive: true },
  ],
  paymentMethods: ['Cash', 'Card', 'Online', 'Insurance'],
  designations: [],
  medicineCategories: ['Analgesic', 'Antibiotic', 'Antidiabetic', 'Antihypertensive', 'Antihistamine', 'Cardiovascular', 'Gastrointestinal', 'Respiratory', 'Vitamin & supplement', 'Other'],
  medicationScheduleFrom: 'Prescribed',
};

export const hospitalSettingsSchema = z.object({
  name: z.string().trim().min(2).max(150),
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/, '2–6 letters'),
  logoUrl: z.string().trim().url().max(500).optional().or(z.literal('').transform(() => undefined)),
  address: optionalString(300),
  city: optionalString(80),
  phone: phone.optional(),
  email: email.optional(),
  website: optionalString(200),
  currency: z.string().trim().length(3).toUpperCase(),
  defaultTaxRate: z.coerce.number().min(0).max(100),
  numbering: z.object({
    mrn: z.string().max(40),
    invoice: z.string().max(40),
    receipt: z.string().max(40),
    prescription: z.string().max(40),
    emergency: z.string().max(40),
    labOrder: z.string().max(40),
    visit: z.string().max(40),
    appointment: z.string().max(40),
    purchaseOrder: z.string().max(40),
    goodsReceipt: z.string().max(40),
    dispense: z.string().max(40),
    admission: z.string().max(40),
    claim: z.string().max(40),
  }),
  notifications: z.object({
    email: z.boolean(),
    sms: z.boolean(),
    push: z.boolean(),
  }),
  hr: z
    .object({
      workStart: time24,
      workEnd: time24,
      graceMinutes: z.coerce.number().int().min(0).max(120),
      halfDayMinutes: z.coerce.number().int().min(60).max(600),
      weeklyOff: z.array(z.coerce.number().int().min(1).max(7)).max(3),
      holidays: z.array(isoDate).max(60),
      leaveEntitlements: z.object({
        Annual: z.coerce.number().min(0).max(60),
        Sick: z.coerce.number().min(0).max(60),
        Casual: z.coerce.number().min(0).max(60),
        Maternity: z.coerce.number().min(0).max(180),
        Other: z.coerce.number().min(0).max(60),
      }),
    })
    .refine((h) => h.workEnd > h.workStart, { path: ['workEnd'], message: 'Shift end must be after start' })
    .optional(),
  catalog: catalogSchema.optional(),
});
export type HospitalSettingsInput = z.infer<typeof hospitalSettingsSchema>;

export const departmentSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,10}$/, '2–10 letters/digits'),
  name: z.string().trim().min(2).max(100),
  description: optionalString(300),
  isClinical: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export const serviceSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/),
  name: z.string().trim().min(2).max(150),
  departmentId: objectId.optional(),
  category: z.enum(INVOICE_SOURCES),
  price: money,
  taxable: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const createUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email,
  phone: phone.optional(),
  roleIds: z.array(objectId).min(1, 'Assign at least one role'),
  password: passwordPolicy,
  mustChangePassword: z.boolean().default(true),
});

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: phone.optional(),
  roleIds: z.array(objectId).min(1).optional(),
  isActive: z.boolean().optional(),
});

export const adminResetPasswordSchema = z.object({ password: passwordPolicy });

export const roleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: optionalString(200),
  permissions: z.array(z.string().max(60)).max(200),
});

export const staffSchema = z.object({
  kind: z.enum(['Doctor', 'Nurse']),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  gender: z.enum(GENDERS),
  phone: phone.optional(),
  email: email.optional(),
  departmentId: objectId,
  designation: z.string().trim().min(2).max(80),
  joiningDate: isoDate,
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FullTime'),
  licenseNumber: z.string().trim().min(3).max(40),
  qualification: optionalString(150),
  specialization: optionalString(100),
  consultationFee: money.optional(),
  followUpFee: money.optional(),
  slotMinutes: z.coerce.number().int().min(5).max(120).optional(),
  dutyStart: time24.optional(),
  dutyEnd: time24.optional(),
  workingDays: z.array(z.number().int().min(1).max(7)).optional(),
  userId: objectId.optional(),
});
