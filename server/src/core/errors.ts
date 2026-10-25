export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = 'error',
    public details?: unknown,
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(what = 'Resource') {
    super(404, `${what} not found`, 'not_found');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, message, 'forbidden');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, message, 'unauthorized');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'conflict', details?: unknown) {
    super(409, message, code, details);
  }
}

/** Business-rule violation: invalid transition, overpayment, insufficient stock... */
export class BusinessRuleError extends AppError {
  constructor(message: string, code = 'business_rule') {
    super(422, message, code);
  }
}

export class ValidationError extends AppError {
  constructor(fieldErrors: Record<string, string[]>, message = 'Some fields are invalid') {
    super(400, message, 'validation', { fieldErrors });
  }
}
