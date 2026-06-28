// Output + error→exit-code mapping for the CLI. SII's Spanish messages are passed
// through unchanged (CONVENTIONS: opaque translations waste the user's time).
import { LoginFailedError, NotAuthenticatedError, RateLimitError } from '@sii/core';

/** Machine-readable result lines go to STDOUT. */
export function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Diagnostics + the operating-as header go to STDERR, so STDOUT stays clean. */
export function err(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Exit-code contract (see @sii/core errors.ts): NotAuthenticated → 2 (incl.
 *  SessionExpired), LoginFailed → 3, RateLimit → 4, anything else → 1. */
export function exitCodeFor(error: unknown): number {
  if (error instanceof NotAuthenticatedError) return 2;
  if (error instanceof LoginFailedError) return 3;
  if (error instanceof RateLimitError) return 4;
  return 1;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
