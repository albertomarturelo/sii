// Domain error hierarchy. The CLI maps these to exit codes (in @sii/cli):
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

/** The public DTE-authorized consulta could not be completed for a non-user reason —
 *  the network/CGI failed, a non-200 came back, or the portal HTML changed shape
 *  ("scraper roto"). A RUT that is simply not a DTE emisor is NOT this error: it is a
 *  clean negative result (`autorizado: false` + SII's verbatim message). Fail loud,
 *  never retry (ADR-004 / ADR-014). */
export class DteError extends SiiError {}
