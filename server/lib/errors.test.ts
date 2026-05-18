import { describe, it, expect } from 'vitest';
import { AppError, ValidationError, NotFoundError, isAppError } from './errors';

describe('errors', () => {
  it('AppError carries status and code', () => {
    const e = new AppError('oops', { status: 500, code: 'INTERNAL' });
    expect(e.message).toBe('oops');
    expect(e.status).toBe(500);
    expect(e.code).toBe('INTERNAL');
    expect(e).toBeInstanceOf(Error);
  });

  it('ValidationError defaults to 400 / VALIDATION_ERROR', () => {
    const e = new ValidationError('bad input');
    expect(e.status).toBe(400);
    expect(e.code).toBe('VALIDATION_ERROR');
  });

  it('NotFoundError defaults to 404 / NOT_FOUND', () => {
    const e = new NotFoundError('profile xyz');
    expect(e.status).toBe(404);
    expect(e.code).toBe('NOT_FOUND');
    expect(e.message).toMatch(/profile xyz/);
  });

  it('isAppError distinguishes AppError instances', () => {
    expect(isAppError(new ValidationError('x'))).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError('string')).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  it('AppError uses default status=500 and code=INTERNAL when no options provided', () => {
    const e = new AppError('oops');
    expect(e.status).toBe(500);
    expect(e.code).toBe('INTERNAL');
  });

  it('AppError preserves cause when supplied', () => {
    const root = new Error('root cause');
    const e = new AppError('wrap', { cause: root });
    expect(e.cause).toBe(root);
  });
});
