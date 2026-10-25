import { z } from 'zod';
import { LAB_ORDER_STATUSES, LAB_PRIORITIES, SAMPLE_TYPES } from '../enums';
import { isoDate, money, objectId, optionalString, paginationQuery } from './common';

const optNum = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().optional());

export const labParameterSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    unit: optionalString(20),
    type: z.enum(['numeric', 'text']).default('numeric'),
    refLow: optNum,
    refHigh: optNum,
    criticalLow: optNum,
    criticalHigh: optNum,
    refText: optionalString(80),
  })
  .refine((p) => p.refLow === undefined || p.refHigh === undefined || p.refLow <= p.refHigh, { path: ['refHigh'], message: 'High must be ≥ low' });

export const labTestSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,15}$/, '2–15 letters/digits'),
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  sampleType: z.enum(SAMPLE_TYPES),
  price: money,
  turnaroundHours: z.coerce.number().int().min(1).max(720).default(24),
  parameters: z.array(labParameterSchema).min(1, 'Add at least one parameter').max(40),
  isActive: z.boolean().default(true),
});
export type LabTestInput = z.infer<typeof labTestSchema>;

export const createLabOrderSchema = z.object({
  testIds: z.array(objectId).min(1, 'Select at least one test').max(30),
  priority: z.enum(LAB_PRIORITIES).default('Routine'),
  clinicalNotes: optionalString(500),
});
export type CreateLabOrderInput = z.infer<typeof createLabOrderSchema>;

export const collectSampleSchema = z.object({
  sampleType: z.enum(SAMPLE_TYPES).optional(),
  notes: optionalString(300),
});

export const enterResultsSchema = z.object({
  results: z
    .array(
      z.object({
        itemId: objectId,
        parameter: z.string().trim().min(1).max(80),
        value: z.string().trim().min(1, 'Enter a value').max(120),
      }),
    )
    .min(1)
    .max(400),
  comments: optionalString(1000),
  /** Save as draft keeps the order In progress; false marks it Completed (ready for verification). */
  draft: z.boolean().default(false),
});
export type EnterResultsInput = z.infer<typeof enterResultsSchema>;

export const rejectResultsSchema = z.object({ reason: z.string().trim().min(3).max(300) });

export const labOrderListQuery = paginationQuery.extend({
  status: z.enum(LAB_ORDER_STATUSES).optional(),
  statuses: z.string().max(200).optional(), // comma-separated
  patientId: objectId.optional(),
  priority: z.enum(LAB_PRIORITIES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  mine: z.coerce.boolean().optional(),
  /** Lab worklist: only orders assigned to the signed-in technician. */
  assignedToMe: z.coerce.boolean().optional(),
});

export const assignTechnicianSchema = z.object({ userId: objectId });
