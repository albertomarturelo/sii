# Changelog

All notable changes to `@albertomarturelo/sii-core` are documented here. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/); the package is
pre-1.0, so MINOR bumps may carry breaking changes (pin or use `~` downstream).

## 0.7.0 — 2026-08-31

### Breaking

- **`PortalSession` gains `requestBinary`.** A consumer that implements the
  `PortalSession` interface itself (rather than using the Node default driver) must add
  the method. The Node adapter, the fake session and both surfaces already do. Type-level
  only — no behaviour changed for consumers using `createNodeRuntime`.

### Added

- **`f29Pdf` — download the filed F29 as a local PDF (#80, ADR-022).** New task
  `f29Pdf(runtime, { periodo, tipo?, directorio, folio? })` returning `F29PdfResult`. Two
  artifacts, both plain authenticated GET servlets under `www4.sii.cl/rfiInternet/`:
  `compacto` (the form as SII prints it — and **the payment receipt** when the período was
  paid: its stamp reads "RECIBIDA Y PAGADA POR INTERNET", with banco / medio de pago /
  fecha), `solemne` (the Certificado de Declaración), or `ambos`. The `codInt` the servlet
  demands is the `codigo` field `getDeclaracionConEstados` already returned, so one
  existing JSON call yields both the folio and its authorization token — **no GWT-RPC and
  no SPA warm-up** (unlike Fase 2's `formCompleto`, which bounces a live session to the
  login wall). **Session-keyed** (ADR-005): no `--rut`; a representing operate pointer is
  rejected up front.
- **The document output contract (ADR-022, amends ADR-012).** The task writes the bytes to
  disk and returns a DESCRIPTOR — `{tipo, path, archivo, bytes, contentType}` — never the
  bytes and never base64: these PDFs are PII-dense (razón social, domicilio, full financial
  position) and their contents must stay out of the LLM's context (ADR-006). Success is
  decided by `content-type` + the `%PDF-` magic, **never by HTTP status** — SII answers 200
  for its own error page AND for the login-wall bounce. A per-artifact refusal is captured
  verbatim in `documentosConError` with `incompleto: true` and does not discard a sibling
  already written (CONVENTIONS' fan-out rule); only an all-artifacts failure throws. The
  audit receipt records rut / período / folio / tipos — not the destination path, not the
  contents.
- **`PortalSession.requestBinary` seam** — an authenticated request whose body is taken
  UNDECODED (`Uint8Array`, keeping the pure barrel Node-free). Text decoding would corrupt
  a PDF irreversibly, so this is a distinct primitive rather than a flag on `requestText`.
  Login-wall detection is URL-based, as in `requestForm`/`requestText`.
- **`FileSink` seam + `NodeFileSink`** — writes a produced document (`mkdir -p`, mode
  **0600**, leading `~` expanded). `Runtime.files` is **OPTIONAL** (like `secrets`), so an
  embedded consumer injecting its own seams (ADR-016) is not forced to supply one; a task
  that needs it and finds it missing raises an actionable error. `createNodeRuntime` always
  wires the default.
- **`DOCUMENTOS_DIR`** exported from the `./node` subpath (`~/.sii/documentos`) — the
  destination is a required task argument, since the pure core cannot know `$HOME`, and each
  surface applies the default.
- **`testing.InMemoryFileSink`** — records what would have been written, so tests touch no
  filesystem.
- Surfaced as `sii f29 pdf <periodo> [--tipo compacto|solemne|ambos] [--out <dir>]
  [--folio <n>]` and the MCP `f29_pdf` tool (`readOnly`), whose description states that the
  file holds tax PII and that its contents are deliberately not returned. The surface tipo
  list has one owner (`F29_PDF_TIPO_ARGS`) so the CLI option list and the MCP zod enum
  cannot drift.

## 0.6.0 — 2026-07-04

### Added

- **`rcvListAll` — single-session RCV detalle fan-out (#77).** New task
  `rcvListAll(runtime, { periodo, side, rut? })` returning `RcvDetalleAll`: every
  RCV document of a período+lado in ONE session — `fetchRcvResumen` enumerates the
  present DTE types, then `fetchRcvDetalle` per type, flattened (each
  `RcvDetalleAllDoc` carries its `codigoTipoDoc`). A consumer gets one flat "todos
  los documentos" table without opening N browser sessions (ADR-003). **Body-RUT**
  (`--rut`/operate selects a represented empresa, like `rcvList`), paced between
  POSTs (ADR-004). **Per-type resilience** (mirrors `f22Historial`): a per-type
  `RcvError` is captured in `rejectedTypes` and flips `incomplete: true` while the
  other types still return; a session-level error (`NotAuthenticated`/
  `SessionExpired`) still aborts. Never retries a rejected type. One audit receipt
  (`rcv_detalle_all`, rut/periodo/side/count — no PII).
- Surfaced as `sii rcv all <periodo> [--venta] [--rut]` and the MCP `rcv_all` tool
  (`readOnly`); the CLI human render tags each row with its `tipo` and prints a
  `⚠ Resultado incompleto` line listing the rejected types.

## 0.5.0 — 2026-07-03

### Added

- **`peticionesList` — peticiones administrativas via GWT-RPC (#74).** New task
  returning a taxpayer's SISPAD administrative requests with their state timeline
  (número, materia, estado actual, and per transition the fecha + SII's verbatim
  note). **Body-RUT** (operable-set gate, like RCV). The FIRST GWT-RPC surface: a
  cold authenticated POST to `www3.sii.cl/sispadinternet/peticion` decoded in-house
  (`portal/gwt.ts`, schema-directed — the field layout derived from the compiled
  permutation, `gwt-schema.ts`). PII: NO `raw`, tight allowlist; the audit records
  only the read (rut + count). Live-validated end-to-end (ADR-020).
- **`PortalSession.requestText` seam** — an authenticated raw-body GET/POST → text,
  the peer of `requestPublic`; the transport behind GWT-RPC read facades (ADR-020).

## 0.4.0 — 2026-07-03

### Added

- **`whoami` — the authenticated account's own identity (#70).** New task
  `whoami(runtime)` returning `AuthWhoami` (`rut`, `accountType`, `nombre` =
  razón social for an empresa / full name for a persona, `email`). Read live from
  the session principal's `DatosCntrNow` — **session-keyed** (ignores the operate
  pointer). The audit records only that a read happened (rut), never the razón
  social / email VALUES (PII off the receipt, ADR-006). Live-validated (CLI + MCP).
  Surfaced as `sii whoami` and the MCP `whoami` tool (whose description declares
  the PII exposure to the model). Domicilio (from `direcciones[]`) is a follow-up.

## 0.3.0 — 2026-07-02

First release on the **public npm registry** under `@albertomarturelo/sii-core`
(ADR-018 / ADR-019). Prior `0.1.0` / `0.2.0` were private on GitHub Packages.

> **Note on `bteEmit`:** the emission *preview* (`bteEmitPreview`) is live-validated;
> the final issue POST in `bteEmit` is coded to a real capture but **not yet
> live-validated end-to-end** and is guarded behind explicit confirmation — treat it
> as experimental until #62 lands.

### Changed

- **Renamed `@altumstack/sii-core` → `@albertomarturelo/sii-core`, now MIT-licensed
  and published to the public npm registry** (ADR-018, ADR-019). Consumers install
  with a plain `npm install @albertomarturelo/sii-core` — no GitHub Packages token or
  `.npmrc` scope mapping. The earlier `0.1.0` / `0.2.0` releases were private on GitHub
  Packages under the old scope (ADR-015; superseded).

### Added

- **BHE emission — the first WRITE surface (`bteEmit` / `bteEmitPreview`, ADR-017).**
  Issue a Boleta de Honorarios Electrónica: `bteEmitPreview` runs SII's flow to the
  confirmation step and returns the server-computed retención/líquido WITHOUT issuing;
  `bteEmit` issues and returns the código de barras (folio) + PDF URL, with an optional
  email send. Session-keyed (rejects a representing pointer); local validation (Mod-11
  receptor, positive monto, ±3-month date, region/comuna) before any session; the audit
  receipt carries the folio but never the receptor / monto / glosa. Retención is
  server-side (the emitter reads the vigente rate from the form, never a hardcoded table).
- **`PortalSession.requestForm`** — an authenticated `x-www-form-urlencoded` POST
  from the logged-in session (cookies ride along), returning the decoded text body.
  The primitive behind the legacy HTML write flows (BHE emission, ADR-017); the
  authenticated peer of `PublicRequest.form`. Login-wall detection is URL-based
  (landing on `LOGIN_HOST` → `SessionExpiredError`), since an HTML body is expected.
- **`portal/bte-comunas`** — the SII region/comuna code table (16 regiones / 346
  comunas), ported verbatim from `GLB_comunas.js`, for local region-comuna validation.

## 0.2.0 — 2026-07-02

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

### Internal

- `portal/f22` split into per-view modules (`declaraciones` / `grid` /
  `observaciones` / `historial` over a `shared` wire layer); the module barrel
  re-exports the same names, so the public surface is unchanged.

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
