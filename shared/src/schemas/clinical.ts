import { z } from 'zod';
import { DIAGNOSIS_TYPES, MEDICINE_ROUTES } from '../enums';
import { isoDate, objectId, optionalString } from './common';

const int = (min: number, max: number, label: string) =>
  z.coerce.number().int(`${label} must be a whole number`).min(min, `${label} too low`).max(max, `${label} too high`);
const dec = (min: number, max: number, label: string) =>
  z.coerce.number().min(min, `${label} too low`).max(max, `${label} too high`);

export const vitalsSchema = z
  .object({
    systolicBp: int(40, 300, 'Systolic BP'),
    diastolicBp: int(20, 200, 'Diastolic BP'),
    heartRate: int(20, 250, 'Heart rate'),
    temperatureC: dec(30, 45, 'Temperature'),
    spo2: int(50, 100, 'SpO2'),
    respiratoryRate: int(5, 60, 'Respiratory rate').optional(),
    weightKg: dec(0.5, 400, 'Weight'),
    heightCm: dec(30, 250, 'Height'),
    painScale: int(0, 10, 'Pain scale').default(0),
  })
  .refine((v) => v.systolicBp > v.diastolicBp, { path: ['diastolicBp'], message: 'Diastolic must be lower than systolic' });
export type VitalsInputSchema = z.infer<typeof vitalsSchema>;

export const nursingAssessmentSchema = z.object({
  vitals: vitalsSchema,
  symptoms: z.string().trim().min(2, 'Record the presenting symptoms').max(2000),
  notes: optionalString(2000),
});
export type NursingAssessmentInput = z.infer<typeof nursingAssessmentSchema>;

export const consultationNoteSchema = z.object({
  chiefComplaint: z.string().trim().min(2).max(1000),
  clinicalNotes: z.string().trim().min(2).max(10000),
  /** Why an already-saved note is being changed (kept with the version history). */
  amendmentReason: optionalString(300),
});

export const diagnosisSchema = z.object({
  icdCode: optionalString(20),
  description: z.string().trim().min(2).max(300),
  type: z.enum(DIAGNOSIS_TYPES).default('Provisional'),
});

export const treatmentPlanSchema = z.object({
  plan: z.string().trim().min(2).max(5000),
  followUpDate: isoDate.optional(),
});

export const prescriptionItemSchema = z.object({
  medicineId: objectId.optional(),
  medicineName: z.string().trim().min(2, 'Medicine is required').max(150),
  dosage: z.string().trim().min(1, 'Dosage is required').max(60),
  frequency: z.string().trim().min(1).max(60),
  timesPerDay: z.coerce.number().int().min(0).max(24),
  route: z.enum(MEDICINE_ROUTES).default('Oral'),
  durationDays: z.coerce.number().int().min(1, 'At least 1 day').max(365),
  quantity: z.coerce.number().positive('Quantity must be positive').max(10000),
  instructions: optionalString(300),
});

export const createPrescriptionSchema = z.object({
  items: z.array(prescriptionItemSchema).min(1, 'Add at least one medicine').max(30),
  notes: optionalString(1000),
});
export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;

export const completeConsultationSchema = z.object({
  followUpDate: isoDate.optional(),
});

export const visitIdParam = z.object({ visitId: objectId });
