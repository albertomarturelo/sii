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
