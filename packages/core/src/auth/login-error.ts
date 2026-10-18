// Pure parser for SII's failed-login page (rendered on zeusr.sii.cl at
// /cgi_AUT2000/CAutInicio.cgi). Kept DOM-free so it is unit-testable in Node;
// the Playwright adapter passes it the page's `innerText` (adapters/node/portal.ts).

import type { LoginFailureReason } from '../errors/index.js';

/** SII's message código for a wrong Clave Tributaria, observed 2026-06-28
 *  (docs/sii-contract/auth-login.md). It is the ONLY código classified as
 *  `'wrong-clave'`; the locked-account página has a DISTINCT código, not yet
 *  observed (triggering it risks a real lock, ADR-004/ADR-010), so it stays
 *  `'unknown'` until captured. */
export const WRONG_CLAVE_CODIGO = '01.01.203.500.720.20';

export interface SiiLoginErrorDetail {
  /** `"<causa> (<código line>)"` verbatim, or `null` if the page shape changed. */
  message: string | null;
  /** The código SII printed (e.g. `01.01.203.500.720.20`), or `null` if none. */
  codigo: string | null;
  /** Classified from `codigo` — `'wrong-clave'` only for `WRONG_CLAVE_CODIGO`. */
  reason: LoginFailureReason;
}

/** Parse SII's failed-login page body into {message, codigo, reason}.
 *  Observed 2026-06-28 (docs/sii-contract/auth-login.md): the page renders the
 *  human cause, then a line `El código de este mensaje es <código>`. The line
 *  BEFORE the código line is the cause (e.g. "La Clave Tributaria ingresada no es
 *  correcta…"). A changed shape ⇒ `{message: null, codigo: null, reason: 'unknown'}`
 *  (the caller falls back to a generic no-retry message). */
export function parseSiiLoginErrorDetail(bodyText: string): SiiLoginErrorDetail {
  const lines = bodyText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const i = lines.findIndex((l) => /El c[oó]digo de este mensaje/i.test(l));
  if (i <= 0) return { message: null, codigo: null, reason: 'unknown' };
  const codigoLine = lines[i] ?? '';
  const codigo = /El c[oó]digo de este mensaje es\s+([0-9][0-9.]*)/i.exec(codigoLine)?.[1] ?? null;
  const reason: LoginFailureReason = codigo === WRONG_CLAVE_CODIGO ? 'wrong-clave' : 'unknown';
  return { message: `${lines[i - 1]} (${codigoLine})`, codigo, reason };
}

/** Back-compat string view: SII's verbatim cause line, or `null` if the shape changed. */
export function parseSiiLoginError(bodyText: string): string | null {
  return parseSiiLoginErrorDetail(bodyText).message;
}
