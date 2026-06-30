# Changelog

All notable changes to `@altumstack/sii-core` are documented here. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/); the package is
pre-1.0, so MINOR bumps may carry breaking changes (pin or use `~` downstream).

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
