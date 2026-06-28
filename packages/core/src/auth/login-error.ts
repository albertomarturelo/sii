// Pure parser for SII's failed-login page (rendered on zeusr.sii.cl at
// /cgi_AUT2000/CAutInicio.cgi). Kept DOM-free so it is unit-testable in Node;
// the Playwright adapter passes it the page's `innerText` (adapters/node/portal.ts).

/** Extract SII's verbatim login-error cause from the failed-login page body text.
 *  Observed 2026-06-28 (docs/sii-contract/auth-login.md): the page renders the
 *  human cause, then a line `El código de este mensaje es <código>`. The line
 *  BEFORE the código line is the cause (e.g. "La Clave Tributaria ingresada no es
 *  correcta…"). Returns `"<causa> (<código line>)"`, or `null` if the shape
 *  changed (the caller falls back to a generic no-retry message). */
export function parseSiiLoginError(bodyText: string): string | null {
  const lines = bodyText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const i = lines.findIndex((l) => /El c[oó]digo de este mensaje/i.test(l));
  return i > 0 ? `${lines[i - 1]} (${lines[i]})` : null;
}
