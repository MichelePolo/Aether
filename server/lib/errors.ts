export interface AppErrorOptions {
  status?: number;
  code?: string;
  cause?: unknown;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  override readonly cause?: unknown;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.status = options.status ?? 500;
    this.code = options.code ?? 'INTERNAL';
    this.cause = options.cause;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, { status: 400, code: 'VALIDATION_ERROR', cause });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`Not found: ${resource}`, { status: 404, code: 'NOT_FOUND' });
    this.name = 'NotFoundError';
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
