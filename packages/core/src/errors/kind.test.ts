import { describe, it, expect } from 'vitest';
import {
  BrowserRequiredError,
  CarpetaError,
  CredentialNotFoundError,
  F29Error,
  LoginBlockedError,
  LoginFailedError,
  LoginQueuedError,
  NetworkError,
  NotAuthenticatedError,
  RateLimitError,
  RcvError,
  SessionExpiredError,
  UnexpectedResponseError,
  ValidationError,
  Www2SessionError,
} from './errors.js';
import { classifyError } from './kind.js';
import { siiJudgedClave } from '../auth/login-block.js';

// A código SII prints on its error page (synthetic value, shape as observed).
const CODIGO = '99.1';

describe('classifyError', () => {
  it('splits the four login failures that share exit code 3', () => {
    expect(
      classifyError(new LoginFailedError('m', { reason: 'wrong-clave', codigo: CODIGO })),
    ).toEqual({ type: 'login_rejected', reason: 'wrong-clave', codigo: CODIGO });
    expect(classifyError(new LoginBlockedError('m', { codigo: CODIGO }))).toEqual({
      type: 'login_blocked',
      reason: 'unknown',
      codigo: CODIGO,
    });
    expect(classifyError(new LoginQueuedError('m'))).toEqual({
      type: 'login_queued',
      reason: 'unknown',
      codigo: null,
    });
    expect(classifyError(new LoginFailedError('m'))).toEqual({
      type: 'login_failed',
      reason: 'unknown',
      codigo: null,
    });
  });

  it('tests the NotAuthenticated subclasses before their parent', () => {
    expect(classifyError(new Www2SessionError('m'))).toEqual({ type: 'www2_session_required' });
    expect(classifyError(new SessionExpiredError('m'))).toEqual({ type: 'session_expired' });
    expect(classifyError(new NotAuthenticatedError('m'))).toEqual({ type: 'not_authenticated' });
  });

  it('maps the remaining domain errors, and carries reason/codigo on login kinds only', () => {
    expect(classifyError(new RateLimitError('m'))).toEqual({ type: 'rate_limited' });
    expect(classifyError(new ValidationError('m'))).toEqual({ type: 'validation' });
    expect(classifyError(new CredentialNotFoundError('m'))).toEqual({
      type: 'credential_not_found',
    });
    expect(classifyError(new BrowserRequiredError('m'))).toEqual({ type: 'browser_required' });
    expect(classifyError(new UnexpectedResponseError('m'))).toEqual({
      type: 'unexpected_response',
    });
    // Facade errors (SII refused, or a scraper broke) share one kind; the command says which.
    expect(classifyError(new RcvError('m'))).toEqual({ type: 'sii_error' });
    expect(classifyError(new F29Error('m'))).toEqual({ type: 'sii_error' });
    expect(classifyError(new CarpetaError('m'))).toEqual({ type: 'sii_error' });
  });

  it('names a transport failure `network`, apart from a bug (#215)', () => {
    const e = new NetworkError('m', { host: 'misiir.sii.cl', causa: 'ECONNRESET' });
    expect(classifyError(e)).toEqual({ type: 'network' });
  });

  it('calls anything that is not a domain error unexpected', () => {
    expect(classifyError(new TypeError('m'))).toEqual({ type: 'unexpected' });
    expect(classifyError('a thrown string')).toEqual({ type: 'unexpected' });
  });

  it('says login_rejected exactly when the latch trips (siiJudgedClave)', () => {
    const attempts = [
      new LoginFailedError('m', { reason: 'wrong-clave', codigo: CODIGO }),
      new LoginFailedError('m', { codigo: CODIGO }),
      new LoginFailedError('m'),
      new LoginFailedError('m', { codigo: '' }),
      new LoginQueuedError('m'),
      new LoginQueuedError('m', { codigo: CODIGO }),
    ];
    for (const e of attempts) {
      expect(classifyError(e).type === 'login_rejected').toBe(siiJudgedClave(e));
    }
  });
});
