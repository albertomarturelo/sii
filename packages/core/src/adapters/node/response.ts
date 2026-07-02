import { LOGIN_HOST } from '../../config/index.js';
import { SessionExpiredError } from '../../errors/index.js';

/** Classify a non-JSON SDI response. A dead/expired session makes an authenticated
 *  SDI POST get bounced to SII's login wall (HTML) instead of JSON; detect it the same
 *  URL-based way the rest of the auth flow does — landing on `LOGIN_HOST`, with an
 *  HTML content-type fallback for a same-host wall (ADR-009) — and return an ACTIONABLE
 *  `SessionExpiredError`. Anything else is a genuinely unexpected response → a generic
 *  Error (the facade maps it to its own typed error). Pure, so it is unit-tested
 *  without launching Playwright. */
export function nonJsonResponseError(finalUrl: string, contentType: string, status: number): Error {
  const ct = contentType.toLowerCase();
  const bouncedToLogin = new URL(finalUrl).hostname === LOGIN_HOST;
  if (bouncedToLogin || ct.includes('text/html')) {
    return new SessionExpiredError('La sesión expiró. Ejecuta `sii auth login`.');
  }
  return new Error(`Respuesta no-JSON de SII (HTTP ${status}, ${ct || 'sin content-type'}).`);
}

/** Login-wall detection for an authenticated FORM POST (ADR-017). Unlike `requestJson`,
 *  an HTML body is EXPECTED (the `TMBECN_*` emit CGIs render HTML), so the content-type
 *  heuristic can't apply — a dead session is detected purely by the response landing on
 *  `LOGIN_HOST` (URL-based, ADR-009). Returns an actionable `SessionExpiredError`, else
 *  null. Pure → unit-tested without a browser. */
export function formLoginWallError(finalUrl: string): Error | null {
  return new URL(finalUrl).hostname === LOGIN_HOST
    ? new SessionExpiredError('La sesión expiró. Ejecuta `sii auth login`.')
    : null;
}

/** Extract the charset label from a `Content-Type` header for decoding a public
 *  (unauthenticated) response body (ADR-014). SII's palena reports declare
 *  `text/html; charset=ISO-8859-1`, so a UTF-8 decode would mangle accents (ó, é,
 *  °) — we honour the DECLARED charset and fall back to UTF-8 when it is absent or
 *  not a label `TextDecoder` accepts. Pure → unit-tested without launching fetch. */
export function charsetOf(contentType: string | null | undefined): string {
  const label = /charset=([^;]+)/i
    .exec(contentType ?? '')?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '');
  if (!label) return 'utf-8';
  try {
    new TextDecoder(label); // validate the label; an unknown one throws RangeError
    return label;
  } catch {
    return 'utf-8';
  }
}
