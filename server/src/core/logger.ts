import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development';

/** Credentials and patient identifiers, redacted at the top level and up to two levels down. */
const SENSITIVE = ['password', 'passwordHash', 'token', 'cnic', 'phone', 'email', 'dateOfBirth'];
export const LOG_REDACTION = {
  paths: [
    'req.headers.cookie',
    'req.headers.authorization',
    'res.headers["set-cookie"]',
    ...SENSITIVE.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
  ],
  censor: '[redacted]',
};

export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
  redact: LOG_REDACTION,
  transport: isDev ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } : undefined,
});
