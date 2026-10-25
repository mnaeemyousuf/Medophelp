import { z } from 'zod';
import { ALLERGY_SEVERITIES, BLOOD_GROUPS, GENDERS } from '../enums';
import { email, isoDate, nationalId, optionalString, paginationQuery, phone } from './common';

export const allergySchema = z.object({
  allergen: z.string().trim().min(1).max(100),
  reaction: optionalString(200),
  severity: z.enum(ALLERGY_SEVERITIES).default('Moderate'),
});

export const medicalHistorySchema = z.object({
  condition: z.string().trim().min(1).max(200),
  diagnosedOn: isoDate.optional(),
  isChronic: z.boolean().default(false),
  notes: optionalString(500),
});

export const insuranceSchema = z.object({
  provider: z.string().trim().min(1).max(100),
  policyNumber: z.string().trim().min(1).max(50),
  coveragePercent: z.coerce.number().min(0).max(100).default(100),
  coverageLimit: z.coerce.number().min(0).optional(),
  expiresOn: isoDate.optional(),
});

const patientBase = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(60),
  lastName: z.string().trim().min(1, 'Last name is required').max(60),
  guardianName: optionalString(120),
  cnic: nationalId.optional().or(z.literal('').transform(() => undefined)),
  dateOfBirth: isoDate.refine((d) => new Date(d) <= new Date(), 'Date of birth cannot be in the future')
    .refine((d) => new Date(d).getFullYear() >= 1900, 'Date of birth is too far in the past'),
  gender: z.enum(GENDERS),
  bloodGroup: z.enum(BLOOD_GROUPS).default('Unknown'),
  phone,
  email: email.optional().or(z.literal('').transform(() => undefined)),
  address: optionalString(300),
  city: optionalString(80),
  emergencyContactName: optionalString(120),
  emergencyContactRelation: optionalString(50),
  emergencyContactPhone: phone.optional().or(z.literal('').transform(() => undefined)),
});

export const createPatientSchema = patientBase.extend({
  allergies: z.array(allergySchema).max(50).default([]),
  medicalHistory: z.array(medicalHistorySchema).max(100).default([]),
  insurance: insuranceSchema.optional(),
  /** Set true by the user after reviewing a possible-duplicate warning. */
  confirmNotDuplicate: z.boolean().optional().default(false),
});
export type CreatePatientInput = z.infer<typeof createPatientSchema>;

export const updatePatientSchema = patientBase.partial().extend({
  /** Finalises an emergency quick-registration once the full demographics are captured. */
  completeRegistration: z.boolean().optional(),
});
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

export const patientSearchQuery = paginationQuery.extend({
  gender: z.enum(GENDERS).optional(),
});
