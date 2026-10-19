// The machine-readable kind of a failure (ADR-012 amendment, #134). An unattended agent
// branches on `type` instead of regex-parsing SII's Spanish message, which still travels
// verbatim next to it. The kind names are a CONTRACT: a refactor may rename a class, never a
// kind, and a kind is never reassigned to a different situation.
import {
  BrowserRequiredError,
  CredentialNotFoundError,
  LoginBlockedError,
  LoginFailedError,
  LoginQueuedError,
  NotAuthenticatedError,
  RateLimitError,
  SessionExpiredError,
  SiiError,
  UnexpectedResponseError,
  ValidationError,
  Www2SessionError,
  type LoginFailureReason,
} from './errors.js';

export type ErrorKind =
  | 'login_rejected'
  | 'login_blocked'
  | 'login_queued'
  | 'login_failed'
  | 'not_authenticated'
  | 'session_expired'
  | 'www2_session_required'
  | 'rate_limited'
  | 'validation'
  | 'credential_not_found'
  | 'browser_required'
  | 'unexpected_response'
  | 'sii_error'
  | 'unexpected';

/** `reason` / `codigo` ride on every `login_*` kind (`codigo` is `null` when SII printed
 *  none) and on no other, so a consumer can rely on their presence by kind. */
export interface ErrorInfo {
  type: ErrorKind;
  reason?: LoginFailureReason;
  codigo?: string | null;
}

/** Classify an error into its stable kind. Subclasses are tested before their parents. */
export function classifyError(error: unknown): ErrorInfo {
  if (error instanceof LoginFailedError) {
    return { type: loginKind(error), reason: error.reason, codigo: error.codigo };
  }
  if (error instanceof Www2SessionError) return { type: 'www2_session_required' };
  if (error instanceof SessionExpiredError) return { type: 'session_expired' };
  if (error instanceof NotAuthenticatedError) return { type: 'not_authenticated' };
  if (error instanceof RateLimitError) return { type: 'rate_limited' };
  if (error instanceof ValidationError) return { type: 'validation' };
  if (error instanceof CredentialNotFoundError) return { type: 'credential_not_found' };
  if (error instanceof BrowserRequiredError) return { type: 'browser_required' };
  if (error instanceof UnexpectedResponseError) return { type: 'unexpected_response' };
  if (error instanceof SiiError) return { type: 'sii_error' };
  return { type: 'unexpected' };
}

// `login_rejected` is the latch's own rule (`siiJudgedClave`, auth/login-block.ts): SII printed
// a código, so it judged the Clave and the latch is now set. Kept in agreement by a test.
function loginKind(error: LoginFailedError): ErrorKind {
  if (error instanceof LoginBlockedError) return 'login_blocked';
  if (error instanceof LoginQueuedError) return 'login_queued';
  return error.codigo ? 'login_rejected' : 'login_failed';
}
