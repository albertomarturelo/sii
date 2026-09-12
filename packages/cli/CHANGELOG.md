# Changelog

All notable changes to `@albertomarturelo/sii-cli` are documented here. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/); the package is
pre-1.0, so MINOR bumps may carry breaking changes.

Versions move in **lockstep** with `@albertomarturelo/sii-core` and
`@albertomarturelo/sii-mcp` (ADR-021). Every command is a thin call into a core task
(ADR-003), so the domain detail behind each entry lives in the
[core changelog](../core/CHANGELOG.md).

## 0.10.0 — 2026-09-12

### Added

- **`sii carpeta instituciones`** — SII's **live** list of destination institutions for the
  Carpeta Tributaria Regular: `[{codigo, descripcion, abreviacion, tipo, rut, vigenteDesde,
  vigenteHasta}]` as JSON by default, `--human` for a table. The `codigo` is the value the
  Regular carpeta will demand (#109); it is read from SII on every call because the codes
  drift, and **no catalog is bundled**. Session-keyed. Live-validated 2026-09-12 (67 rows).
- **`sii auth login --www2`** — mints the **second** cookies-only session that the Carpeta
  Tributaria (and the rest of `www2.sii.cl/app/*`) needs, on top of the classic one (ADR-026).
  After the classic login the same browser opens SII's OAuth page and **you** type the Clave
  there; only cookies are kept, and both layers live in the same session file. Refused with
  `--console` / `--keyring`: that page runs reCAPTCHA Enterprise, so there is no headless
  variant, by decision. **You will type the Clave twice**, because the headed browser opens
  without cookies — the single-prompt flow is tracked as #119.
- **`sii auth status`** now reports the www2 layer (`activa (hasta …)` from its own cookie
  expiry; `--refresh` checks it live), and **`sii auth logout`** closes it too.

## 0.9.0 — 2026-09-09

### Added

- **`sii auth login --keyring [--rut <rut>]`** — reads the Clave from the OS keyring
  instead of the terminal and mints the same cookies-only session as `--console` (#101,
  ADR-025). Service `sii`, username = your RUT; the entry is tried canonical → dotted →
  body-only. **Exactly one attempt**, SII's message verbatim on failure, **no automatic
  re-login** — an expired session still asks you to run the verb. Built for unattended use,
  so it **never prompts**: without `--rut` it takes the RUT of the last local session, and
  with neither it fails naming the flag. A missing entry errors with the exact command that
  stores one, on both platforms:

  ```sh
  secret-tool store --label='SII' service sii username <rut>     # Linux (Secret Service)
  security add-generic-password -s sii -a <rut> -w                # macOS (Keychain)
  ```

  The CLI **never writes** to the keyring; storing the Clave is your own act with your own
  tool. `@napi-rs/keyring` `2.0.0` (exact pin) is a dependency of this package only.

## 0.8.0 — 2026-09-09

### Added

- **`sii dte empresas`** — the empresas the Portal MIPYME lists this account as *usuario
  autorizado* for (#90, ADR-023). This is a **third auth mode, empresa-keyed**: the list is
  the portal's own, neither the `operate` pointer's operable set nor the session principal,
  and `--empresa` is validated against it live. `--tipo <n>` scopes the DTE type (33
  factura, 34 exenta).
- **`sii dte borrador list|save|delete`** — prepare a factura on SII's FREE facturación
  portal, **borradores only, never emission** (ADR-023). `save <json>` takes the document
  as a file or on STDIN, with `--empresa`, `--ciudad`, `--fecha` and `--borrador <id>` to
  update an existing draft; `delete <id>` is gated by `--confirm <id>` (double-entry of the
  id), since deleting is the irreversible half. SII's own `validaFacEx()` runs in-page
  first, so its Spanish refusals reach you verbatim before anything is sent.
- **`sii dte preview <json>`** — the preview PDF of a document that was never issued,
  stamped "VISTA PREVIA · DOCUMENTO NO VÁLIDO" and carrying no folio. `--out <dir>` chooses
  the destination; prints the path and size, never the contents.
- **`sii dte emitidos --empresa <rut>`** — the documents an empresa has already emitted
  through the portal (#91), with `--tipo-doc`, `--estado emitido|preview`, `--folio`,
  `--receptor`, `--desde` / `--hasta` and paging.
- **`sii dte pdf <folio> --empresa <rut>`** — the PDF of an emitted document, resolved by
  folio through the listing so a wrong one fails clearly. `--out <dir>` (default
  `~/.sii/documentos/dte`).

Every `--help` on this surface opens by declaring its auth mode (ADR-024), and none of
these commands can issue a document: the signing CGI is never called.

### Changed

- **The MIPYME commands live under `sii dte`, not `sii factura` (ADR-024).** The verb is
  the SII artifact, and a factura is DTE 33 — an artifact that already had a verb. The
  `factura` spelling was never published, so no released command changed.

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
