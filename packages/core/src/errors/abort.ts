// The ADR-031 check point, kept OUT of the errors barrel on purpose: `AbortedError` and the
// `aborted` kind are the public contract; how a task checks its signal is not.
import { AbortedError } from './errors.js';

/** Throw `AbortedError` when `signal` has fired: a task calls it before opening its session and
 *  before every SII call or pacing pause (ADR-031). A no-op without a signal. */
export function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new AbortedError('La operación se detuvo antes de la siguiente llamada al SII.', {
      cause: signal.reason,
    });
  }
}
