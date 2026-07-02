// Program-level plumbing tests (per-command suites live in commands/*.test.ts;
// the shared fixture is test-helpers.ts). Fakes only — no SII.
import { describe, it, expect } from 'vitest';
import {
  LoginFailedError,
  NotAuthenticatedError,
  RateLimitError,
  SessionExpiredError,
} from '@altumstack/sii-core';
import { exitCodeFor } from './io.js';

describe('exit-code mapping (errors.ts contract)', () => {
  it('maps domain errors to documented codes', () => {
    expect(exitCodeFor(new NotAuthenticatedError('x'))).toBe(2);
    expect(exitCodeFor(new SessionExpiredError('x'))).toBe(2); // subclass of NotAuthenticated
    expect(exitCodeFor(new LoginFailedError('x'))).toBe(3);
    expect(exitCodeFor(new RateLimitError('x'))).toBe(4);
    expect(exitCodeFor(new Error('x'))).toBe(1);
  });
});
