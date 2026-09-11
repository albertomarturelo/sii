// Domain error hierarchy. The CLI maps these to exit codes (in @albertomarturelo/sii-cli):
// NotAuthenticated → 2, LoginFailed → 3, RateLimit → 4. Pass SII's Spanish
// messages through unchanged (sii-py error-surfacing convention).

export class SiiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** No valid cached session; the user must run `sii auth login`. */
export class NotAuthenticatedError extends SiiError {}

/** A cached session existed but the cookies are dead. Carries an actionable
 *  recovery message (e.g. re-run the browser login). Subclass of NotAuthenticated
 *  so a generic catch still treats it as "not authenticated". */
export class SessionExpiredError extends NotAuthenticatedError {}

/** Browser login was not completed (timeout / window closed). No partial
 *  session is ever written. */
export class LoginFailedError extends SiiError {}

/** SII server-side rate limit / block. NEVER retry — surface verbatim and stop. */
export class RateLimitError extends SiiError {}

/** A stored credential was required (e.g. unattended re-mint) but none resolved. */
export class CredentialNotFoundError extends SiiError {}

/** Invalid user input: bad RUT, an operate target not in the operable set, etc. */
export class ValidationError extends SiiError {}

/** An authenticated `requestJson` got a body that is NOT JSON and NOT the login wall —
 *  the response reached its destination host (no `LOGIN_HOST` bounce, not HTML) but the
 *  body does not parse. Observed 2026-09-11 (GH-111) on the cte-api
 *  `obtenerValorParametro` (URL cited in `adapters/node/response.ts`): HTTP 200
 *  `text/plain;charset=utf-8` with a bare URL — a live session, a wrong endpoint. Carries
 *  the endpoint, HTTP status, content-type and the first ~80 chars of the body VERBATIM
 *  (ADR-004), so a facade can tell a SII quirk from a dead session (`SessionExpiredError`)
 *  without a second round-trip. NOT a subclass of NotAuthenticated on purpose: re-login
 *  would not fix it. */
export class UnexpectedResponseError extends SiiError {}

/** SII rejected a portal/SDI facade request (error envelope or unparseable
 *  response). Carries SII's message verbatim — never translated (ADR-004). */
export class RepresentacionError extends SiiError {}

/** SII rejected an RCV (Registro de Compras y Ventas) facade request, or the
 *  response was not parseable. SII's message verbatim — never translated (ADR-004). */
export class RcvError extends SiiError {}

/** SII rejected an F22 (Declaración Anual de Renta) facade request, or the response
 *  was not parseable. SII's message verbatim — never translated (ADR-004). */
export class F22Error extends SiiError {}

/** SII rejected an F29 (Declaración Mensual de IVA) facade request, the response was
 *  not parseable, OR the operation is invalid for F29's session-keyed contract — F29
 *  authorizes by the session principal, so operating as a represented empresa is
 *  rejected up front (ADR-005). SII's message verbatim — never translated (ADR-004). */
export class F29Error extends SiiError {}

/** SII rejected a BTE/BHE (boletas de honorarios) consulta, or the inline report map was
 *  absent / unparseable (a non-report or cross-RUT page). SII's message verbatim where one
 *  exists — never translated (ADR-004). NOT raised for an empty month (a clean 0-boletas
 *  result). */
export class BteError extends SiiError {}

/** SII rejected a SISPAD peticiones (peticiones administrativas) GWT-RPC read, the
 *  response was a `//EX[…]` business error (surfaced verbatim — ADR-004), or the GWT
 *  object graph could not be decoded against the observed schema ("scraper roto", a loud
 *  fail — the app was recompiled with changed types). Peticiones is BODY-RUT (validate
 *  `--rut` vs the operable set, like RCV — ADR-005 / ADR-020). Never retried after a SII
 *  error; a `LOGIN_HOST` bounce surfaces as `SessionExpiredError`, not this. */
export class PeticionesError extends SiiError {}

/** The public DTE-authorized consulta could not be completed for a non-user reason —
 *  the network/CGI failed, a non-200 came back, or the portal HTML changed shape
 *  ("scraper roto"). A RUT that is simply not a DTE emisor is NOT this error: it is a
 *  clean negative result (`autorizado: false` + SII's verbatim message). Fail loud,
 *  never retry (ADR-004 / ADR-014).
 *  Also the MIPYME portal surface (ADR-023 / ADR-024): SII rejected a borrador operation, its
 *  own client-side validator refused the document (surfaced VERBATIM), or the portal form
 *  changed shape. Empresa-keyed. Never retried after a SII error; a `LOGIN_HOST` bounce is
 *  `SessionExpiredError`, not this. */
export class DteError extends SiiError {}

/** SII rejected a Carpeta Tributaria (`cte-api`) request, the body was not the observed shape
 *  ("scraper roto" — e.g. `/instituciones` not serving an array), OR the user's `--institucion`
 *  is not in SII's LIVE list (the message names the valid codes; no round-trip is spent).
 *  SII's message verbatim where one exists — never translated (ADR-004). Session-keyed like
 *  F29 (ADR-005). Never retried; a `LOGIN_HOST` bounce is `SessionExpiredError`, not this. */
export class CarpetaError extends SiiError {}
