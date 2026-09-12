# Changelog

Release history of the **sii** monorepo. The three published packages —
[`@albertomarturelo/sii-core`](packages/core), [`@albertomarturelo/sii-cli`](packages/cli)
and [`@albertomarturelo/sii-mcp`](packages/mcp) — move in **lockstep**: one version, one
tag, one npm publish (ADR-021). This file is the release-level view; the per-package
detail lives in each package's own changelog:

- [core](packages/core/CHANGELOG.md) — the domain engine (tasks, seams, portal facades)
- [cli](packages/cli/CHANGELOG.md) — the `sii …` terminal surface
- [mcp](packages/mcp/CHANGELOG.md) — the stdio MCP server

The project is pre-1.0, so MINOR bumps may carry breaking changes (pin, or use `~`).
Every decision behind a release is recorded as an ADR under
[`docs/decisions/`](docs/decisions/_index.md); the surface checklist is
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## 0.10.0 — 2026-09-12 — Carpeta Tributaria y la segunda sesión del SII

`sii carpeta instituciones` reads SII's **live** list of destination institutions for the
Carpeta Tributaria Regular — the `enfinCodigo` its `/generar` demands. No catalog ships with
the tool: the codes drift, and a hardcoded one had already gone stale. Live-validated with 67
rows; `codigo` stays a string compared verbatim, because zero-padded (`"016"`) and unpadded
(`"1005"`) codes coexist in SII's own list.

Getting there uncovered the release's real finding: **`www2.sii.cl/app/*` has its own session
layer.** The classic cookies-only session reaches www1, www3, www4 and loa, but every
`cte-api` call answers a bare `401` until an OAuth2 flow at SII's `oauthsii-v1` page mints a
second cookie pair. So `sii auth login --www2` adds that layer the same way the project has
always handled the Clave: **the user types it into SII's own page**, headed, cookies only —
never headless, because reCAPTCHA Enterprise gates it and an automated Clave submit is how
accounts get locked (ADR-026). Both layers live in one session file; `auth status` reports
them and `auth logout` closes both.

Two things worth knowing before upgrading. With a warm classic session `--www2` asks for the
Clave **twice**, since the headed browser opens without cookies — the one-prompt flow is
tracked as #119. And `carpeta regular`, the PDF itself (#109), is **not** in this release; the
catalog and the session layer are what it was blocked on.

Also in: `UnexpectedResponseError` (#112), so an authenticated JSON call that gets a non-JSON
body no longer reads as an expired session — it names the endpoint, status, content-type and
the body's first characters verbatim. The SII surface that prompted it answers `200
text/plain` to a perfectly live session.

**No breaking changes.** Core's returned objects gain fields (`AuthStatusLocal.www2`,
`AuthLogoutResult.www2Closed`, `statusRefresh` → `AuthIdentityRefresh`) and `login` gains an
optional argument; all additive.

## 0.9.0 — 2026-09-09 — Login desde el llavero del sistema

`sii auth login --keyring`: the Clave is read from the OS keyring (Secret Service on Linux,
Keychain on macOS) instead of being typed, minting the same cookies-only session as
`--console`. Built for unattended use — one attempt, never a retry, never a prompt, and
**no automatic re-login**: an expired session still asks you to run the verb, because the
alternative is the shape that turns one stale entry into a locked account (ADR-025).

This resolves the `SecretStore` backend that ADR-006 left open, and it is **more
conservative than ADR-006 allowed**: the CLI never *writes* the Clave — storing it is your
own act with your own tool — and `Runtime.secrets` is typed read-only so no task can, even
by mistake.

**The MCP server gains nothing and holds no keyring.** The adapter is wired by the CLI's
composition root alone, never as a runtime default, so the MCP process carries no
`SecretStore` at all — asserted in both packages. The Clave still never crosses an MCP tool
argument.

`@napi-rs/keyring` `2.0.0`, pinned exactly: a native module that reads the OS credential
store must not roll a new major forward on a plain `pnpm install`.

**Breaking (core, type-level):** `Runtime.secrets` is now a `SecretReader` (`get` only), and
`AuthLoginResult.reason` gains `'keyring_login'`. Nothing shipped ever wired `secrets`, so no
runtime behaviour changes.

0.8.0 already shipped an outside contribution (#90); this is the first one taken through
the full review cycle `CONTRIBUTING.md` documents — issue, request-changes, fix, approve
(#101 → #105).

## 0.8.0 — 2026-09-09 — Facturación por el Portal MIPYME (borradores)

`sii dte empresas` / `borrador list|save|delete` / `preview` / `emitidos` / `pdf`: SII's own
**free** facturación portal, driven with the Clave alone — no certificado digital. Prepare a
factura (DTE 33/34), save and update it as a **borrador**, get the preview PDF, and read the
documents an empresa has already emitted, with their PDFs.

**Borradores only — emission is deliberately not implemented (ADR-023).** Signing on this
portal happens SERVER-SIDE, so a Clave alone would be enough to issue a legally binding
document. That one irreversible step stays with a human in SII's own UI; the signing CGI is
never called from this codebase, and a test asserts its absence from the build. Everything
that *prepares* a document is automated.

A **third authorization mode** joins body-RUT and session-keyed: **empresa-keyed**. The
portal keeps its own list of the empresas that registered you as *usuario autorizado*, which
is neither the `operate` pointer's operable set nor the session principal — so `--empresa` is
validated against that live list before every operation.

Surfaces are now named by **SII artifact** (ADR-024): the verb is `dte`, not the portal
(`mipyme`) or the transport, and document types are parameters (`--tipo 61`), not verbs.
`docs/ROADMAP.md` § "Where a new surface goes" is the placement table a new verb is checked
against. This work landed under a `factura` verb and was folded into `dte` before release,
so no published command or tool was renamed.

Also in this release: `CONTRIBUTING.md` now carries the CFD ceremony, the PR checklist in a
form a contributor without Claude Code can walk by hand, and what CI does **not** check on a
fork PR.

## 0.7.0 — 2026-08-31 — F29 document downloads

The first **document-download** surface: `sii f29 pdf` / `f29_pdf` saves the filed F29 of
a período to a local file — the form as SII prints it (which doubles as the **payment
receipt** when the período was paid) and/or the Certificado de Declaración.

The download needed no new SII reverse-engineering: the authorization token the PDF
servlet demands turned out to be a field the F29 estado facade already returned, so no
GWT-RPC and no SPA warm-up (ADR-022).

Two new seams: `PortalSession.requestBinary` (an undecoded response body — text decoding
corrupts a PDF) and `FileSink` (writing, mode 0600). A document-producing task returns a
DESCRIPTOR (path, size) and never the bytes: these PDFs are PII-dense, so their contents
stay out of the LLM's context (ADR-006).

**Breaking (core):** `PortalSession` gains `requestBinary` — only affects a consumer that
implements that interface itself.

## 0.6.0 — 2026-07-04 — RCV fan-out

`sii rcv all` / `rcv_all`: every RCV document of a período+lado in ONE session, flattened
and tagged by document type, with per-type resilience (a rejected type is surfaced, the
rest still return).

## 0.5.0 — 2026-07-03 — Peticiones administrativas; CLI + MCP on npm

`sii peticiones list` / `peticiones_list`: SISPAD administrative requests with their state
timeline, including SII's verbatim note on what is pending. The first **GWT-RPC** surface,
decoded in-house with a schema derived from the compiled permutation (ADR-020).

Also the first npm release of the **CLI and MCP** packages (ADR-021) — previously only the
core was published.

## 0.4.0 — 2026-07-03 — whoami

`sii whoami` / `whoami`: the authenticated account's own razón social (or full name) and
email, read live from the session principal. The audit records that the read happened,
never the values (ADR-006).

## 0.3.0 — 2026-07-02 — Public npm, MIT, and the first write surface

Renamed to `@albertomarturelo/sii-core`, relicensed **MIT** and published to the **public**
npm registry (ADR-018, ADR-019); `0.1.0`/`0.2.0` had been private on GitHub Packages.

First **write** surface: `bte emit` — issuing a Boleta de Honorarios Electrónica, two-phase
(preview vs issue) and confirm-gated (ADR-017).

## 0.2.0 — 2026-07-02 — Embeddable core

The core became embeddable: a pure main barrel (no `node:*` or Playwright evaluated at
import time) with a `./node` composition subpath, and Playwright as an OPTIONAL peer
(ADR-016). A consumer injecting its own seams never installs a browser.

## 0.1.0 — 2026-06-30 — First release

The read surfaces built up to that point — `auth`, `operate`, `rcv`, `f22`, `f29` (Fase 1),
`bte list`, `dte authorized` — on the shared core, behind injectable seams (ADR-003),
published privately to GitHub Packages (ADR-015, later superseded).
