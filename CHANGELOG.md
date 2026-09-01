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
