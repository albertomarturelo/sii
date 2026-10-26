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

/** The www2 APP SESSION (the second cookies-only layer `www2.sii.cl/app/*` needs — ADR-026) is
 *  missing or expired: `/app/session/status` did not answer a session JSON. A subclass of
 *  NotAuthenticated because the fix is a login (the MCP's `auth_login` with `www2`), never a
 *  retry — but DISTINCT from `SessionExpiredError` (the classic Mi SII session may be perfectly
 *  alive). */
export class Www2SessionError extends NotAuthenticatedError {}

/** Why a login was rejected, as DATA so a downstream consumer never regex-parses the
 *  message (#124). `'wrong-clave'` ONLY for SII's observed wrong-Clave código; every
 *  other código, a changed page shape, a timeout or the generic fallback is `'unknown'`
 *  — the safe direction (a consumer treats unknown as "blocked", never as "retry"). */
export type LoginFailureReason = 'wrong-clave' | 'unknown';

/** Browser login was not completed (timeout / window closed) OR SII rejected the Clave.
 *  No partial session is ever written. Carries the classified `reason` + SII's message
 *  `codigo` (when the page printed one) alongside the verbatim message, so a consumer
 *  reads them as data (#124). Both are additive: `new LoginFailedError(msg)` still works
 *  (`reason: 'unknown'`, `codigo: null`). */
export class LoginFailedError extends SiiError {
  readonly reason: LoginFailureReason;
  readonly codigo: string | null;
  constructor(message: string, opts?: { reason?: LoginFailureReason; codigo?: string | null }) {
    super(message);
    this.reason = opts?.reason ?? 'unknown';
    this.codigo = opts?.codigo ?? null;
  }
}

/** SII server-side rate limit / block. NEVER retry — surface verbatim and stop. */
export class RateLimitError extends SiiError {}

/** A surface needs a JS engine (SII's own page JS must run — BTE inline maps, MIPYME's
 *  in-page `validaFacEx`) but the runtime carries no `browser` engine: the default HTTP
 *  `PortalDriver` cannot `evaluate`/`interactiveLogin` (ADR-027). Actionable — names the
 *  Playwright install — never a silent fallback. */
export class BrowserRequiredError extends SiiError {}

/** The login POST was redirected into SII's Queue-it waiting room (`salaespera.sii.cl`),
 *  the peak-load queue an HTTP client cannot pass (observed in the browser jar, ADR-027).
 *  NOT a credential failure and NOT retryable here — surface it and stop. */
export class LoginQueuedError extends LoginFailedError {}

/** A NON-interactive login (`--clave-env` / `--clave-stdin` / `--keyring`) refused WITHOUT
 *  contacting SII because the rejection latch is set for that RUT: SII rejected a Clave for
 *  it earlier, and an unattended retry of the same stale value is how an account gets locked
 *  (ADR-028). Carries the latched `codigo`/`reason`. Lifted by an interactive login or
 *  `sii auth unblock`. A LoginFailed subclass, so it keeps that exit code. */
export class LoginBlockedError extends LoginFailedError {}

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

/** The request never got an answer from SII: DNS, the connection, TLS, an egress proxy or the
 *  timeout failed (#215). Node's `fetch` reports all of them as a bare "fetch failed" and keeps
 *  the reason in `err.cause`; this carries that cause and the host, so a caller can tell a proxy
 *  that resets one SII host from SII being down. NOT a SiiError on purpose: SII said nothing,
 *  so a composite read aborts on it (ADR-030) and a facade never relabels it as SII's answer.
 *  Never retried. */
export class NetworkError extends Error {
  /** The host contacted (never the path or query). */
  readonly host: string;
  /** The cause's code as Node reports it (`ECONNRESET`, `ENOTFOUND`, `TIMEOUT`…), or null. */
  readonly causa: string | null;
  constructor(message: string, opts: { host: string; causa: string | null }) {
    super(message);
    this.name = new.target.name;
    this.host = opts.host;
    this.causa = opts.causa;
  }
}

/** The caller's `AbortSignal` cut a multi-call read between two SII calls (ADR-031): nothing
 *  partial is returned. The signal's `reason` rides as `cause`, whatever value the caller gave
 *  it, so the kind does not depend on it. NOT a SiiError: SII refused nothing. */
export class AbortedError extends Error {
  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

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

/** SII refused an rfiInternet call with its own exception (`//EX`): the call took no effect.
 *  The F29 submit relies on this to tell "SII said no, nothing was filed" from a failure whose
 *  outcome is unknown (ADR-029 amendment). Still a `sii_error`. */
export class F29RechazoError extends F29Error {}

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
 *  ("scraper roto" — e.g. `/instituciones` not serving an array), the operation is invalid for
 *  its session-keyed contract (a representing pointer, ADR-005), OR the user's `--institucion` is
 *  not in SII's LIVE list (the message names the valid codes; no round-trip is spent). SII's
 *  message verbatim where one exists — never translated (ADR-004). Never retried; a missing www2
 *  app session is `Www2SessionError` and a `LOGIN_HOST` bounce `SessionExpiredError`, not this. */
export class CarpetaError extends SiiError {}
