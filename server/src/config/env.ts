import { z } from 'zod';

/** `KEY=` copied from .env.example means "not configured", not an invalid value. */
const blankAsUnset = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === '' ? undefined : v), s);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(120).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  FILE_STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().default(10),
  LOG_LEVEL: z.string().default('info'),
  SEED_DEMO_PASSWORD: z.string().optional(),
  /**
   * SMS gateway (any HTTP JSON API, e.g. a PTA-registered local aggregator). When unset, SMS runs in
   * demo mode: messages are recorded as "Logged" and nothing is sent.
   * The adapter POSTs { to, from, text } with `Authorization: Bearer <SMS_API_KEY>`.
   */
  SMS_GATEWAY_URL: blankAsUnset(z.string().url().optional()),
  SMS_API_KEY: blankAsUnset(z.string().optional()),
  SMS_SENDER_ID: blankAsUnset(z.string().max(20).optional()),
  /** Overdue-payment reminders: days after issue before the first reminder (0 disables). */
  PAYMENT_REMINDER_DAYS: z.coerce.number().int().min(0).max(90).default(7),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast: never start with missing secrets.
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
};
