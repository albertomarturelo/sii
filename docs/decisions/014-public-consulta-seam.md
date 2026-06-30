# ADR-014: Unauthenticated `PortalDriver.requestPublic` seam for public login-free consultas

## Status

Accepted — 2026-06-29. Scopes the DTE-authorized read surface (#21). Builds on
ADR-003 (injectable seams; surfaces call tasks only), ADR-004 (first-hand
observation, audit, verbatim errors). Lineage: the public-consulta carve-out is
sii-py ADR-024.

## Context

The public **consulta de empresas autorizadas a emitir DTE** (#21) is the first
SII surface that takes **no session**: a cold form-POST to a palena CGI
(`https://palena.sii.cl/cvc_cgi/dte/ee_empresa_rut`, body `RUT_EMP`/`DV_EMP`)
returns a **server-rendered HTML report** (`charset=ISO-8859-1`) for ANY RUT —
no cookie, no Referer, no UA required (observed; ported from sii-py portal/dte.py).

Every seam we have today is built for the *authenticated* SPA-JSON facades:
`PortalSession` is a logged-in browser context, and `requestJson` both rides the
session cookies AND treats any non-JSON body as a login wall (raises
`SessionExpiredError`). Neither fits a session-less endpoint that answers in HTML.
ADR-004 still binds (audit the call, errors verbatim, no third-party libs), and
ADR-003 still binds (the surface must reach this through a task + a seam, never a
bespoke HTTP client in `portal/`). So we need a new seam, decided before code.

## Decision

Add one method to the existing `PortalDriver` seam (it is session-less portal
I/O — it belongs on the driver, not on `PortalSession`):

```ts
interface PublicRequest {
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  /** application/x-www-form-urlencoded body (the palena CGI takes form fields). */
  readonly form?: Record<string, string>;
}
interface PublicResponse {
  readonly status: number;
  readonly body: string; // decoded text (charset-aware)
}
interface PortalDriver {
  // …interactiveLogin / credentialLogin / restore…
  /** Issue an UNAUTHENTICATED request (no session, no cookies) to a public SII
   *  endpoint and return the decoded text body. The basis for login-free
   *  consultas (DTE authorized). */
  requestPublic(url: string, options?: PublicRequest): Promise<PublicResponse>;
}
```

- **Default impl: Node 20 global `fetch`** (undici) in `adapters/node/portal.ts` —
  no Chromium launch (a public CGI needs no browser; the Python original used a
  plain `httpx` POST cold). The adapter decodes the body per the response's
  **declared charset** (parse `content-type`; ISO-8859-1 here) so accents survive —
  encoding is an I/O concern, kept out of the core. The fake driver in
  `adapters/fake` returns a scripted `{status, body}` so tests never hit SII.
- The core's `portal/dte-public.ts` facade calls `requestPublic`, parses the HTML
  table in-house (stdlib only, no third-party HTML lib — ADR-004), and surfaces a
  curated result + SII's verbatim "no autorizado" message. No `raw` (the HTML
  carries exactly the curated fields — ADR-004 curated+raw is for fat JSON rows).
- The task still audits (`rut=<subject>`, **no `rutAuth`** — no authenticated
  principal) and passes SII's Spanish messages through unchanged.

## Alternatives Considered

1. **`requestPublic` via Playwright `request.newContext()`.** Rejected — keeps all
   HTTP in one library but still spins a Playwright request context for a cold
   public CGI; global `fetch` is lighter and the endpoint needs nothing a browser
   provides (no cookie/JS/captcha — observed).
2. **Reuse `restore({cookies:[]})` + a new `PortalSession.requestText`.** Rejected —
   launches headless Chromium just to POST a form, and conflates "logged-in
   session" with a session-less call, muddying the `PortalSession` abstraction.
3. **No seam — `fetch` directly in `portal/dte-public.ts`.** Rejected — violates
   ADR-003 (the core reaches external I/O only through seams, so tests stay
   hermetic) and would make the facade untestable without the network.

## Consequences

- Easier: public consultas (DTE authorized now; sibling `mipyme`/`fiscales` later)
  get a clean, browser-free, hermetically testable path; the seam count stays flat
  (one new method, not a new interface).
- Obligation: `fetch` is a second HTTP mechanism alongside Playwright's context —
  acceptable because the two serve disjoint auth classes (session-less vs
  session-bound). The adapter owns charset decoding; new public endpoints reuse it.
- Boundary held: even though it is login-free, the call goes task → seam and is
  audited (ADR-003/004); the surface never reaches the CGI directly.
