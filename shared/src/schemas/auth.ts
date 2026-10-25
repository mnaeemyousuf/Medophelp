import { z } from 'zod';
import { email, passwordPolicy } from './common';

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
  rememberMe: z.boolean().optional().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20).max(200),
    password: passwordPolicy,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordPolicy,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })
  .refine((d) => d.newPassword !== d.currentPassword, { path: ['newPassword'], message: 'New password must differ from current' });

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  hospital: { id: string; name: string; code: string; logoUrl?: string; currency: string };
  patientId?: string;
  doctorId?: string;
  nurseId?: string;
  employeeId?: string;
  mustChangePassword: boolean;
}
