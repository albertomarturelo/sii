import { LOGIN_HOST } from '../../config/index.js';
import { SessionExpiredError, UnexpectedResponseError } from '../../errors/index.js';

/** How much of a non-JSON body the error carries. Enough to recognise the quirk (a bare
 *  URL, an HTML fragment, a SII notice) without dumping a whole page into a message that
 *  reaches the terminal or an MCP client (the audit log never records error messages —
 *  a failed task audits ids/periods only). */
const BODY_SNIPPET_CHARS = 80;

/** Classify a non-JSON SDI response. A dead/expired session makes an authenticated
 *  SDI POST get bounced to SII's login wall (HTML) instead of JSON; detect it the same
 *  URL-based way the rest of the auth flow does — landing on `LOGIN_HOST`, with an
 *  HTML content-type fallback for a same-host wall (ADR-009) — and return an ACTIONABLE
 *  `SessionExpiredError`. Anything else is a genuinely unexpected response →
 *  `UnexpectedResponseError` naming the endpoint, status, content-type and the first
 *  chars of the body verbatim. Observed at
 *  https://www2.sii.cl/app/cte-api-carpetatributaria/{rut}/recurso/v2/carpeta-tributaria/obtenerValorParametro
 *  on 2026-09-11 (GH-111): a live session gets HTTP 200 `text/plain;charset=utf-8` with
 *  the bare URL of the "modificar email" SPA — the wrong endpoint, NOT a login wall, and
 *  the old message (status + content-type only) hid exactly the body that says so. A json-labelled
 *  non-JSON body gets the same treatment, spelled out (the content-type lied). Neither
 *  is something `requestJson` may return (the seam resolves parsed JSON only — ADR-003;
 *  a facade's zod envelope is where a bare string would fail, ADR-011). Pure, so it is
 *  unit-tested without launching Playwright. */
export function nonJsonResponseError(
  finalUrl: string,
  contentType: string,
  status: number,
  body = '',
): Error {
  const ct = contentType.toLowerCase();
  const url = new URL(finalUrl);
  const bouncedToLogin = url.hostname === LOGIN_HOST;
  // A real login wall is a 2xx/3xx HTML page (a same-host bounce). A 5xx HTML body is a SERVER
  // error, not an expired session — don't mislabel it "sesión expiró" (observed 2026-10-18: www4
  // answered HTTP 500 text/html to a malformed request; ADR-027 GH live validation).
  if (bouncedToLogin || (ct.includes('text/html') && status < 500)) {
    return new SessionExpiredError('La sesión expiró. Ejecuta `sii auth login`.');
  }
  const snippet = bodySnippet(body);
  const claimsJson = ct.includes('json');
  const what = claimsJson
    ? `SII declaró content-type ${ct} pero el cuerpo no es JSON`
    : `Respuesta no-JSON de SII (${ct || 'sin content-type'})`;
  return new UnexpectedResponseError(
    `${what} — HTTP ${status} en ${url.host}${url.pathname}` +
      (snippet ? `: "${snippet}"` : ' (cuerpo vacío)'),
  );
}

/** The first chars of a body, whitespace-collapsed, for an error message. */
function bodySnippet(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > BODY_SNIPPET_CHARS ? `${flat.slice(0, BODY_SNIPPET_CHARS)}…` : flat;
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

/** Larger than the observed stub (344 bytes) with room for a longer origin URL; a real portal
 *  page is tens of KB, so a size bound keeps the body scan off every normal response. */
export const LOGIN_STUB_MAX_BYTES = 2048;

/** Recognise SII's JS-only login-wall page and return where it sends the browser, else null.
 *  Mi SII answers a DEAD jar with HTTP 200 and a page whose only content is
 *  `location.replace('https://zeusr.sii.cl//AUT2000/InicioAutenticacion/IngresoRutClave.html?<origin>')`
 *  — no HTTP redirect, so a client that does not run JS stays on `misiir.sii.cl` and would read
 *  the session as alive. Observed at https://misiir.sii.cl/cgi_misii/siihome.cgi on 2026-10-18
 *  (GH-139); loa, www1, www3 and www4 bounced the same dead jar with a real HTTP redirect.
 *  Deliberately narrow: once the markup is stripped, the page must hold NOTHING but one
 *  navigation, and its target must be on `LOGIN_HOST`. A live page that merely links to zeusr
 *  (the "cerrar sesión" handler) never matches, because it has content besides that statement.
 *  Pure → unit-tested without fetch. */
export function loginStubTarget(html: string): string | null {
  const script = html
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
    .replace(/<script\b[^>]*>|<\/script>/gi, '')
    .trim();
  const m =
    /^(?:window\.)?location(?:\.replace\(|\.assign\(|\.href\s*=\s*|\s*=\s*)\s*(['"])([^'"]+)\1\s*\)?\s*;?$/.exec(
      script,
    );
  if (!m?.[2]) return null;
  try {
    const target = new URL(m[2]);
    return target.hostname === LOGIN_HOST ? target.href : null;
  } catch {
    return null;
  }
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
