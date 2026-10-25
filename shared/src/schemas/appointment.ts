import { z } from 'zod';
import { APPOINTMENT_STATUSES } from '../enums';
import { isoDate, objectId, optionalString, paginationQuery, time24 } from './common';

export const createAppointmentSchema = z.object({
  patientId: objectId,
  doctorId: objectId,
  date: isoDate,
  startTime: time24,
  /** A code from the hospital's configured appointment types (checked by the server). */
  type: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9]{1,23}$/).default('New'),
  reason: optionalString(300),
});
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const rescheduleAppointmentSchema = z.object({
  date: isoDate,
  startTime: time24,
  doctorId: objectId.optional(),
});

export const cancelAppointmentSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason').max(300),
});

export const appointmentListQuery = paginationQuery.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  doctorId: objectId.optional(),
  departmentId: objectId.optional(),
  patientId: objectId.optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
});

export const availabilityQuery = z.object({
  doctorId: objectId,
  date: isoDate,
});
