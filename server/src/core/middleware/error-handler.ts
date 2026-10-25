import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../errors';
import { logger } from '../logger';
import { env } from '../../config/env';

/** RFC 7807 problem response. Stack traces never leave the server in production. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'internal_error';
  let message = 'Something went wrong. Please try again.';
  let details: unknown;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = 'validation';
    message = 'Some fields are invalid';
    details = { fieldErrors: Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, [v.message]])) };
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'bad_id';
    message = `Invalid ${err.path}`;
  } else if ((err as { code?: number }).code === 11000) {
    status = 409;
    code = 'duplicate';
    const key = Object.keys((err as { keyPattern?: object }).keyPattern ?? {}).filter((k) => k !== 'hospitalId')[0];
    message = key ? `A record with this ${key} already exists` : 'Duplicate record';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'payload_too_large';
    message = 'Request is too large';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'bad_json';
    message = 'Malformed JSON body';
  }

  if (status >= 500) logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  res.status(status).type('application/problem+json').json({
    type: `https://hms.local/problems/${code}`,
    title: message,
    status,
    code,
    ...(details ? { details } : {}),
    ...(!env.isProd && status >= 500 ? { debug: String(err?.stack ?? err) } : {}),
  });
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).type('application/problem+json').json({
    type: 'https://hms.local/problems/not_found',
    title: `No route for ${req.method} ${req.path}`,
    status: 404,
    code: 'not_found',
  });
};
