import { describe, it, expect } from 'vitest';
import { NotAuthenticatedError, SessionExpiredError, RateLimitError, SiiError } from './errors';

describe('errors', () => {
  it('sets the subclass name', () => {
    expect(new RateLimitError('x').name).toBe('RateLimitError');
  });

  it('SessionExpiredError is a NotAuthenticatedError', () => {
    expect(new SessionExpiredError('x')).toBeInstanceOf(NotAuthenticatedError);
  });

  it('every domain error extends SiiError', () => {
    expect(new NotAuthenticatedError('x')).toBeInstanceOf(SiiError);
  });
});
