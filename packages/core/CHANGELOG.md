# Changelog

All notable changes to `@altumstack/sii-core` are documented here. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/); the package is
pre-1.0, so MINOR bumps may carry breaking changes (pin or use `~` downstream).

## 0.2.0 — Unreleased

### Breaking

- **`createNodeRuntime` moved to the `@altumstack/sii-core/node` subpath**
  (ADR-016). The main barrel is now statically pure — importing it evaluates
  no `node:*` module and no playwright, so tasks/primitives work in any
  bundled/sandboxed context. Update:
  `import { createNodeRuntime } from '@altumstack/sii-core/node'`.
- **`playwright` is now an OPTIONAL peer dependency** (was a hard dependency).
  Only the default `PortalDriver` needs it, and it is loaded lazily on first
  use. If you drive the default driver, install it yourself
  (`npm i playwright` + `npx playwright install chromium`); if you inject your
  own `PortalDriver`, you no longer need bundler stubs or
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`.

### Fixed

- `f29Overview` with no arguments no longer fails with a cryptic
  `ValidationError` (the MCP `f29_overview` tool used to send empty strings):
  it now defaults to the current calendar year to date, resolved through the
  injected `Clock`.

### Changed

- **`f29Overview` owns the range policy** (`{ desde?, hasta?, anio? }`): `anio`
  — or a bare-`YYYY` `desde` — means the whole calendar year (an explicit
  `hasta` may narrow it); `desde` (YYYY-MM) alone means that single month;
  nothing means the current year to date. The CLI and MCP pass their raw
  arguments through, so both surfaces share one semantics. Existing
  `{ desde, hasta }` calls behave as before.

### Added

- `createNodeRuntime(overrides?: Partial<Runtime>)` — any seam replaceable
  while keeping the other Node defaults.
- The Node default adapters are exported from `./node`: `SystemClock`,
  `FileKeyValueStore`, `FileAuditSink`, `PlaywrightPortalDriver`, `SII_DIR`.
- `sideEffects: false` — the package is tree-shakeable.
- **`format` helpers** — `formatMoney` (es-CL thousands, `—` for null) and
  `formatRut` (canonical → dotted display form), plus `describeOperating`
  (the shared `Operando como …` line, next to `formatOperableEntry`). The CLI
  and MCP consumed verbatim private copies of all three; now every consumer
  shares one rendering.

## 0.1.0 — 2026-06-30

Initial published release (private, GitHub Packages). Renamed from the in-repo
workspace package `@sii/core` (ADR-015).

### Added

- **auth** — browser cookies-only login, console login (`@altumstack/sii-core/cli`
  subpath), logout, local + refresh status; `withSession` session-acquisition
  primitive.
- **identity / operate** — single-account, operate-centric model (ADR-005):
  operating RUT resolution (`--rut` > pointer > self), operable set.
- **read surfaces** — `rcv` (summary/list, body-RUT), `f22`
  (status/formulario/observaciones/historial, session-keyed), `f29`
  (formulario/overview/status, Fase 1 SDI-JSON, session-keyed), `bte`
  (list, session-keyed), `dte` (authorized, public/login-free).
- **seams** — `PortalDriver` (+ `requestPublic`), `SecretStore`,
  `KeyValueStore`, `AuditSink`, `Clock`, with Node default adapters
  (`createNodeRuntime`) and in-memory fakes for tests.
- **primitives** — `rut` (Mod-11), `periodo` (YYYYMM) + `anio` (YYYY),
  `config` (prod hostnames + rate limits), append-only `audit`.
