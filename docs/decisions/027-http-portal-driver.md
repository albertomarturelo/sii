# ADR-027: HTTP `PortalDriver` as the default; the CLI never needs a human at a browser

## Status

Accepted — 2026-10-18. Supersedes ADR-010's *mechanism* (headless form-fill) and reverses
its Alternative 2; ADR-010's input rules (hidden prompt, one attempt) stand. Amends
ADR-006 (the CLI no longer has a headed login) and ADR-026 (`--www2` leaves the CLI; the
MCP keeps it).

## Context

Every SII call goes through Playwright, even with no page JS involved: the `request*`
primitives use its `APIRequestContext`, which is plain HTTP underneath. Every command
pays a browser launch, and two CLI flows (the default headed login, `--www2`) need a
human at a browser window. Neither works for scripts, cron or an unattended agent on a
Linux VM.

A live spike (2026-10-17, ONE attempt, the maintainer's own account, no browser) found:

- **The login works.** A plain `fetch` POST to `CAutInicio.cgi` with the browser's exact
  form (`rut, dv, referencia, 411='', rutcntr=<dotted>, clave`) is accepted after a
  warm-up GET. The F5 WAF issued `TS*` cookies on the GET and posed no challenge.
- **Success is not a redirect.** It is `200 text/html` on `zeusr.sii.cl`, with the
  session set via `Set-Cookie` (`TOKEN`, `CSESSIONID`, `NETSCAPE_LIVEWIRE.*`,
  `RUT_NS`/`DV_NS`) and a JS navigation to `referencia`. No cookie is set by JS. A wrong
  Clave also answers `200` on that host.
- **The jar reaches the portal.** Mi SII serves `DatosCntrNow` as a **JSON literal**,
  parseable with no JS engine. A www4 SDI POST answers `codRespuesta: 0`.
- **Queue-it.** The browser jar held Queue-it cookies (`salaespera.sii.cl`), SII's
  peak-load waiting room, which an HTTP client cannot pass.

Some flows still need SII's page JS, with no human involved: BTE `list` (inline JS maps)
and MIPYME (the JS-built form plus `validaFacEx()` on a DOM).

## Decision

- **`HttpPortalDriver`** (`adapters/node/http.ts`) becomes `createNodeRuntime`'s default
  `portal`. It runs on Node `fetch` plus an **in-house cookie jar** for the observed
  `.sii.cl` semantics (domain, path, expiry, deletion).
  - `request{Json,Form,Text,Binary}`, `cookie`, `storageState`, `restore` and
    `requestPublic` keep their contracts.
  - `goto` = a redirect-following GET that returns the landed URL.
  - `evaluate` and `interactiveLogin` throw `BrowserRequiredError`.
- **Playwright stays, as the optional `Runtime.browser` engine, lazily imported.** A
  task that needs page JS asks `withSession(runtime, fn, { engine: 'browser' })`, which
  restores the same jar into a **headless** context. The choice is explicit, never a
  silent upgrade. If Chromium is missing, `BrowserRequiredError` names
  `npx playwright install chromium`, so only users of those surfaces download it.
- **The CLI has no headed browser at all.**
  - `sii auth login` is the HTTP login, with the Clave from the hidden prompt (default;
    `--console` is an alias), `--keyring`, or ADR-028's sources.
  - The headed login and `--www2` (a human typing past reCAPTCHA, ADR-026) are removed
    from the CLI.
  - The MCP keeps both: `auth_login` (and its `www2` flag) remains its only login, since
    no Clave crosses MCP (ADR-006).
- **Carpeta Tributaria becomes MCP-only** (`carpeta_instituciones`, `carpeta_regular` when
  built): the sole consumer of the www2 app session, which only the MCP can now mint. A CLI
  `carpeta` would depend on a session minted elsewhere — a deliberate MCP-only carve-out
  (inverse of the usual parity rule), justified by the www2 dependency.
- **The session file is unchanged** (cookies in the `storageState` shape). A jar from
  any login restores into either engine, with no migration.
- **The identity read leaves `evaluate`.** The `DatosCntrNow` literal is extracted from
  the Mi SII HTML, `JSON.parse`d and zod-validated (ADR-011). That is still inline
  structured data, not the DOM. If it can't be parsed ⇒ "scraper roto".
- **HTTP credential login:** one warm-up GET, then exactly ONE POST.
  - **Success** = the session cookies are set AND the body navigates off `LOGIN_HOST`;
    the Mi SII identity read is the proof.
  - **Anything else** = a rejection, with SII's line before `El código de este mensaje
    es …` passed verbatim (the `readLoginError` logic, ported).
  - **A Queue-it redirect** ⇒ `LoginQueuedError`: actionable, no retry. Its host is a
    `config` constant (ADR-004).
- **Packaging:** `playwright` stays a dependency of the CLI and MCP; Chromium is a
  separate, on-demand install.

## Alternatives Considered

1. **Playwright for everything (status quo).** Rejected: a browser launch per command,
   and a human at a window for the CLI's login and `--www2`.
2. **Remove Playwright entirely.** Rejected: BTE `list` and MIPYME run SII's page JS, and
   the MCP's only Clave-free login is SII's own page.
3. **Keep a headed `--browser` login in the CLI.** Rejected: the CLI's contract is to run
   with no manual browser step. The headed path lives in the MCP, where the Clave must
   not travel.
4. **Silently upgrade to Chromium on `evaluate`.** Rejected: it hides a multi-second
   cost behind an ordinary call and forces a jar↔browser cookie sync mid-flow.
5. **`tough-cookie` for the jar.** Rejected: a dependency for a narrow, observed cookie
   set on one registrable domain. The in-house jar is small and fixture-tested.

## Consequences

- **Easier:** login, `whoami`, RCV, F22, F29 (+ PDFs), peticiones, `dte authorized`,
  `bte emit` and the MIPYME listings/PDFs run with no browser at all, on a bare Linux
  VM. Chromium is needed only for BTE `list` and the MIPYME form flows, headless
  (BTE `list` left the browser on 2026-10-26: Amendment below).
- **Harder:** the cookie jar and login-success detection are ours to keep correct.
  They're covered by fake-`fetch` tests on synthetic `Set-Cookie`/HTML fixtures.
- **Risk:** the F5 WAF may start fingerprinting non-browser clients. That surfaces as a
  rejected/challenged POST (never retried), with no CLI fallback; it reopens this ADR.
- **Breaking:** a bare `sii auth login` no longer opens a browser; `--www2` is gone; and
  `sii carpeta instituciones` (shipped 0.10.0) leaves the CLI. Minor bump + release note.
- **Obligations:** update `sii-contract/auth-login.md` (HTTP flow), `STACK.md`, `ROADMAP.md`.

## Amendment (2026-10-26, #222)

**Context.** BTE `list` was one of the two surfaces kept on the browser because its CGIs fill
their tables from inline JS maps. A probe on 2026-10-26 (an empresa session minted by this
HTTP driver, structure only, `TMBCOC_InformeMensualBheRec.cgi` and the annual report) found that
the maps are not computed by the page: the HTML declares `xml_values` / `arr_informe_mensual`
as `new Array()` and writes every key as a literal statement, the row amounts as
`formatMiles('<n>', …)`, and the month's sums as `0` plus `+= <n>` statements after the rows
(their total leaves the annulled boletas out). The session's cookies reach
`loa.sii.cl` on a plain GET.

**Decision.**

- BTE `list` runs on the HTTP engine: `requestText` GET, then `readInlineMap`
  (`portal/inline-map.ts`) replays the map statements in document order (literal assignments,
  numeric `+=`). A statement it cannot evaluate removes the key rather than guess.
- The browser rule narrows: a surface asks for `engine: 'browser'` only when the page JS
  **computes** the data (MIPYME's JS-built form, `validaFacEx`). Data the page writes as
  literals, whether a JSON literal (`DatosCntrNow`) or map statements (BTE), is parsed from
  the HTML.
- `bte emit` keeps its own key readers (first match) until its issue step is live-validated
  (#62): its pages were captured once, and changing how a binding write reads them is not
  part of this change.

**Consequences.** Chromium is needed only for the MIPYME form flows and the MCP's headed /
www2 logins. Validated live on 2026-10-26 with no browser installed: recibidas, every
curated field, an annulled boleta and the month's totals; emitidas parsed an empty month (its
rows unvalidated, no account with emitidas at hand). Replaying the
statements is narrower than running JS: a page that starts computing its values with
expressions loses those keys, which a live check shows as nulls, never as wrong numbers.
