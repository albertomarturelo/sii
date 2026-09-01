# Changelog

All notable changes to `@albertomarturelo/sii-mcp` are documented here. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/); the package is
pre-1.0, so MINOR bumps may carry breaking changes.

Versions move in **lockstep** with `@albertomarturelo/sii-core` and
`@albertomarturelo/sii-cli` (ADR-021). Every tool is a thin call into a core task
(ADR-003), so the domain detail behind each entry lives in the
[core changelog](../core/CHANGELOG.md).

## 0.7.0 — 2026-08-31

### Added

- **`f29_pdf` tool** (`periodo`, `tipo`, `directorio`, `folio`; `readOnlyHint`) —
  downloads the filed F29 as a local PDF (#80, ADR-022). It returns **only** the file's
  path and size: the document holds tax PII (razón social, domicilio, full financial
  position), so its contents are deliberately kept out of the model's context (ADR-006).
  The tool description says so explicitly, and points the reader at the path instead.

## 0.6.0 — 2026-07-04

### Added

- **`rcv_all` tool** — every RCV document of a período+lado in one session, flattened and
  tagged by document type, with `incomplete` + `rejectedTypes` when a type is rejected (#77).

## 0.5.0 — 2026-07-03

First published release — the MCP stdio server became publishable to public npm alongside
the CLI (ADR-021, #76). It carries the resources (`sii://session`, `sii://operating`,
`sii://operable`, `sii://config`) and the tools built up to that point: `auth_login` (no
password argument), `auth_logout`, `auth_status`, `operate`, `whoami`, `rcv_*`, `f22_*`,
`f29_*`, `bte_list`, `bte_emit` + `bte_emit_preview`, `dte_authorized` and
`peticiones_list`.
