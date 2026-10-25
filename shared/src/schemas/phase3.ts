import { z } from 'zod';
import {
  ADMISSION_SOURCES,
  ADMISSION_STATUSES,
  ARRIVAL_MODES,
  BED_STATUSES,
  CLAIM_STATUSES,
  DISCHARGE_TYPES,
  ER_DISPOSITIONS,
  ER_STATUSES,
  GENDERS,
  TRIAGE_LEVELS,
  WARD_TYPES,
} from '../enums';
import { isoDate, money, nationalId, objectId, optionalString, paginationQuery, phone } from './common';
import { vitalsSchema } from './clinical';

// ── Emergency ────────────────────────────────────────────────────────────────

/**
 * Minimal, fast registration: everything except name and gender may be unknown on arrival.
 * If the CNIC matches a registered patient, the case is attached to that record instead.
 */
export const quickRegisterSchema = z
  .object({
    patientId: objectId.optional(), // pick an existing patient instead of creating one
    name: z.string().trim().min(1, 'Name is required (use "Unknown" if not known)').max(120).optional(),
    cnic: nationalId.optional().or(z.literal('').transform(() => undefined)),
    age: z.coerce.number().int().min(0).max(120).optional(),
    gender: z.enum(GENDERS).optional(),
    emergencyContactName: optionalString(120),
    emergencyContactPhone: phone.optional().or(z.literal('').transform(() => undefined)),
    arrivalMode: z.enum(ARRIVAL_MODES).default('Walk-in'),
    presentingComplaint: z.string().trim().min(2, 'Record the presenting complaint').max(500),
    triageLevel: z.enum(TRIAGE_LEVELS).optional(), // triage can be done at the desk in one step
  })
  .refine((v) => v.patientId || (v.name && v.gender), { path: ['name'], message: 'Name and gender are required for a new patient' });
export type QuickRegisterInput = z.infer<typeof quickRegisterSchema>;

export const triageSchema = z.object({
  level: z.enum(TRIAGE_LEVELS),
  notes: optionalString(1000),
  vitals: vitalsSchema.optional(),
});
export type TriageInput = z.infer<typeof triageSchema>;

export const erNoteSchema = z.object({ note: z.string().trim().min(2).max(4000) });

export const dispositionSchema = z
  .object({
    type: z.enum(ER_DISPOSITIONS),
    notes: z.string().trim().min(2, 'Record a disposition note').max(2000),
    referredTo: optionalString(150),
    /** Admission details when type = Admitted. */
    admission: z
      .object({
        bedId: objectId,
        attendingDoctorId: objectId.optional(),
        reason: z.string().trim().min(2).max(500),
        expectedDischarge: isoDate.optional(),
      })
      .optional(),
  })
  .refine((v) => v.type !== 'Admitted' || !!v.admission, { path: ['admission'], message: 'Choose a bed to admit the patient' })
  .refine((v) => v.type !== 'Referred' || !!v.referredTo, { path: ['referredTo'], message: 'Where is the patient referred to?' });
export type DispositionInput = z.infer<typeof dispositionSchema>;

export const erListQuery = paginationQuery.extend({
  status: z.enum(ER_STATUSES).optional(),
  active: z.coerce.boolean().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

// ── Wards, rooms, beds ───────────────────────────────────────────────────────
export const wardSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/),
  name: z.string().trim().min(2).max(80),
  type: z.enum(WARD_TYPES),
  departmentId: objectId.optional(),
  floor: optionalString(20),
  chargePerDay: money,
  isActive: z.boolean().default(true),
});

export const roomSchema = z.object({
  wardId: objectId,
  roomNo: z.string().trim().min(1).max(20),
  isActive: z.boolean().default(true),
});

export const bedSchema = z.object({
  roomId: objectId,
  bedNo: z.string().trim().min(1).max(20),
  chargePerDay: money.optional(), // overrides the ward rate (e.g. ventilator bed)
});

export const bedStatusSchema = z.object({
  status: z.enum(BED_STATUSES),
  note: optionalString(300),
});

// ── Admissions ───────────────────────────────────────────────────────────────
export const admitSchema = z.object({
  patientId: objectId,
  bedId: objectId,
  attendingDoctorId: objectId,
  source: z.enum(ADMISSION_SOURCES).default('Direct'),
  reason: z.string().trim().min(2, 'Reason for admission is required').max(500),
  provisionalDiagnosis: optionalString(300),
  expectedDischarge: isoDate.optional(),
  assignedNurseId: objectId.optional(),
});
export type AdmitInput = z.infer<typeof admitSchema>;

export const transferSchema2 = z.object({
  bedId: objectId,
  reason: z.string().trim().min(3).max(300),
});

export const ipdNoteSchema = z.object({ note: z.string().trim().min(2).max(5000) });

export const dischargeSchema = z.object({
  type: z.enum(DISCHARGE_TYPES).default('Routine'),
  finalDiagnosis: z.string().trim().min(2, 'Final diagnosis is required').max(500),
  treatmentGiven: z.string().trim().min(2, 'Summarise the treatment given').max(5000),
  conditionAtDischarge: z.string().trim().min(2).max(300),
  medications: optionalString(2000),
  instructions: optionalString(2000),
  followUpDate: isoDate.optional(),
});
export type DischargeInput = z.infer<typeof dischargeSchema>;

export const admissionListQuery = paginationQuery.extend({
  status: z.enum(ADMISSION_STATUSES).optional(),
  wardId: objectId.optional(),
  patientId: objectId.optional(),
  mine: z.coerce.boolean().optional(),
});

// ── Insurance claims ─────────────────────────────────────────────────────────
export const createClaimSchema = z.object({
  invoiceId: objectId,
  insuranceId: objectId.optional(), // patient's policy (defaults to the primary one)
  claimAmount: z.coerce.number().positive('Claim amount must be positive').max(100_000_000).optional(),
  notes: optionalString(1000),
});

export const claimDecisionSchema = z
  .object({
    decision: z.enum(['Approved', 'PartiallyApproved', 'Rejected']),
    approvedAmount: z.coerce.number().min(0).max(100_000_000).default(0),
    payerReference: optionalString(80),
    notes: optionalString(1000),
  })
  .refine((d) => d.decision === 'Rejected' || d.approvedAmount > 0, { path: ['approvedAmount'], message: 'Enter the approved amount' })
  .refine((d) => d.decision !== 'Rejected' || !!d.notes, { path: ['notes'], message: 'Give the rejection reason' });

export const claimPaidSchema = z.object({
  amount: z.coerce.number().positive().max(100_000_000),
  payerReference: z.string().trim().min(2, 'Enter the payer remittance reference').max(80),
});

export const claimListQuery = paginationQuery.extend({
  status: z.enum(CLAIM_STATUSES).optional(),
  provider: z.string().trim().max(100).optional(),
  patientId: objectId.optional(),
});
