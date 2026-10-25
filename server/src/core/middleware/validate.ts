import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { ValidationError } from '../errors';

type Part = 'body' | 'query' | 'params';

/**
 * Validates and REPLACES req[part] with the parsed value. Unknown keys are stripped, so nothing
 * but schema-shaped primitives ever reaches a service or a Mongo filter.
 */
export const validate =
  (schema: ZodTypeAny, part: Part = 'body'): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const flat = result.error.flatten();
      const fieldErrors: Record<string, string[]> = { ...(flat.fieldErrors as Record<string, string[]>) };
      // Nested paths (e.g. items.0.quantity) are flattened to dotted keys for the client.
      for (const issue of result.error.issues) {
        if (issue.path.length > 1) fieldErrors[issue.path.join('.')] = [issue.message];
      }
      if (flat.formErrors.length) fieldErrors._form = flat.formErrors;
      return next(new ValidationError(fieldErrors));
    }
    // req.query is a getter in Express 5; assigning works in Express 4 and keeps the parsed copy.
    Object.defineProperty(req, part, { value: result.data, writable: true, configurable: true });
    next();
  };

export type Validated<S extends ZodTypeAny> = z.infer<S>;
