# Changelog

All notable changes to `@albertomarturelo/sii-mcp` are documented here. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/); the package is
pre-1.0, so MINOR bumps may carry breaking changes.

Versions move in **lockstep** with `@albertomarturelo/sii-core` and
`@albertomarturelo/sii-cli` (ADR-021). Every tool is a thin call into a core task
(ADR-003), so the domain detail behind each entry lives in the
[core changelog](../core/CHANGELOG.md).

## 0.8.0 — 2026-09-09

### Added

- **The Portal MIPYME DTE tools (#90, #91, ADR-023)** — `dte_empresas`,
  `dte_borrador_list`, `dte_borrador_save`, `dte_borrador_delete`, `dte_preview_pdf`,
  `dte_emitidos` and `dte_pdf`. They cover preparing a factura on SII's free facturación
  portal and reading what an empresa has already emitted. **Empresa-keyed:** `empresa` is
  validated against the portal's own authorized list, not the operate pointer.
- **The emission step is not exposed, by design (ADR-023).** Signing on this portal is
  server-side and needs no certificate, so a Clave alone would be enough to issue a legally
  binding document. No tool reaches it — the model can prepare and preview a factura, and
  the irreversible click stays with a human in SII's own UI.
- **`dte_borrador_delete` carries `destructiveHint` and an explicit `confirmar`.** Saving a
  borrador does not: it is reversible and legally inert, so it needs no confirm ceremony
  (ADR-023). Deleting one is irreversible, so it gets the gate.
- **`dte_preview_pdf` and `dte_pdf` return only a path and a size**, never the document
  (ADR-022 / ADR-006) — the file holds counterparty identity and amounts, so its contents
  stay out of the model's context. Both tool descriptions say so.

### Changed

- **The MIPYME tools are prefixed `dte_`, not `factura_` (ADR-024).** The prefix is the SII
  artifact, and a factura is DTE 33. The `factura_` spelling was never published, so no
  released tool was renamed.

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
