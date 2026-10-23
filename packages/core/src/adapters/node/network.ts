// Node's `fetch` (undici) rejects every transport failure with the same `TypeError('fetch
// failed')` and keeps the reason in `cause`: a socket / DNS / TLS error carrying a `code`, or an
// AggregateError with an empty message when every address of a host failed. Our timeout signal
// rejects with a `TimeoutError` instead. Surfacing only the message hid an egress proxy that
// resets the TLS handshake to ONE SII host (#215, Node 20.19: `ECONNRESET Client network socket
// disconnected before secure TLS connection was established`, on misiir only).
import { NetworkError } from '../../errors/index.js';

// A cause message is Node's, not ours or SII's: bounded so a verbose TLS error stays one line.
const MAX_DETAIL = 200;

/** Run one network step (`fetch`, or reading its body) and turn a transport failure into a
 *  `NetworkError` naming the host and the cause. Anything else propagates unchanged. */
export async function overNetwork<T>(url: string, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    throw asNetworkError(e, url) ?? e;
  }
}

/** The `NetworkError` for a transport failure of `fetch`, or null when `e` is not one (a bad
 *  argument is a bug and must stay `unexpected`). Only the host is kept: the path and query
 *  are left out, and the request body (a login POST carries the Clave) is never read. */
export function asNetworkError(e: unknown, url: string): NetworkError | null {
  const host = hostOf(url);
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
    return networkError(host, 'TIMEOUT', e.message);
  }
  if (!(e instanceof TypeError) || e.cause === undefined) return null;
  const cause = innermost(e.cause);
  const code = codeOf(cause);
  const message = cause instanceof Error && cause.message ? cause.message : e.message;
  return networkError(host, code, message);
}

function networkError(host: string, causa: string | null, detail: string): NetworkError {
  const text = detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL)}…` : detail;
  const reason = causa && !text.includes(causa) ? `${causa} ${text}` : text;
  return new NetworkError(
    `Sin respuesta de ${host}: ${reason}. Es un error de red (DNS, conexión, TLS o un proxy de ` +
      'salida), no una respuesta del SII. No se reintenta.',
    { host, causa },
  );
}

/** An AggregateError (every address of the host failed) reports through its first error. */
function innermost(cause: unknown): unknown {
  if (cause instanceof AggregateError && cause.errors.length > 0) return cause.errors[0];
  return cause;
}

function codeOf(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return null;
  return typeof cause.code === 'string' ? cause.code : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'host desconocido';
  }
}
