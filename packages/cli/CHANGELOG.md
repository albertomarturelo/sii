# Changelog

All notable changes to `@albertomarturelo/sii-cli` are documented here. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/); the package is
pre-1.0, so MINOR bumps may carry breaking changes.

Versions move in **lockstep** with `@albertomarturelo/sii-core` and
`@albertomarturelo/sii-mcp` (ADR-021). Every command is a thin call into a core task
(ADR-003), so the domain detail behind each entry lives in the
[core changelog](../core/CHANGELOG.md).

## 0.7.0 — 2026-08-31

### Added

- **`sii f29 pdf <periodo>`** — downloads the filed F29 as a local PDF (#80, ADR-022).
  `--tipo compacto` (the form as SII prints it — and **the payment receipt** when the
  período was paid), `solemne` (the Certificado de Declaración) or `ambos`; `--out <dir>`
  chooses the destination (default `~/.sii/documentos/f29`); `--folio <n>` targets one
  declaración when a período holds several (default: the vigente one). Prints the path and
  size, never the document's contents. A per-artifact refusal is listed under the artifacts
  that did land, so a partial failure stays visible.

## 0.6.0 — 2026-07-04

### Added

- **`sii rcv all <periodo> [--venta] [--rut]`** — every RCV document of a período+lado in
  one session, as a flat table tagged by `tipo`; prints a `⚠ Resultado incompleto` line
  listing any rejected types (#77).

## 0.5.0 — 2026-07-03

First published release — the CLI became publishable to public npm alongside the MCP
server (ADR-021, #76). It carries every surface built up to that point: `auth`
(login/logout/status), `operate`, `whoami`, `rcv`, `f22`, `f29`, `bte` (list + emit),
`dte authorized` and `peticiones list`.
