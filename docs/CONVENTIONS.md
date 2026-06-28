# Conventions

This file grows as real work surfaces patterns (ADR-007: corrections become
conventions). It starts with the load-bearing rules ported from the proven
Python `sii-cli`, adapted to TypeScript.

## Code style

- TypeScript `strict` everywhere, plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. No `any` without an inline justification; prefer
  `unknown` + narrowing at boundaries.
- ESLint + Prettier are authoritative. Format before commit.
- Comments explain WHY, not WHAT — non-obvious constraints, SII quirks, subtle
  invariants. Never restate the code.
- ESM only (`"type": "module"`). Named exports; avoid default exports.
- **NodeNext modules: relative imports end in `.js`** (e.g. `from './rut/index.js'`)
  so the compiled output runs directly on Node; bare specifiers (`@sii/core`,
  `commander`) stay extensionless. `tsc` errors on a missing extension. (ADR-009)

## Architecture patterns

- **Single-env (prod) is the contract.** No `SII_ENV` switch. Hostnames are
  constants in `@sii/core` config; never hard-code a SII hostname anywhere else.
- **Surfaces call `@sii/core` tasks only.** CLI and MCP never reach past the
  task layer into a portal/DTE facade — that bypasses throttling, audit log, and
  credential handling. (ADR-003)
- **External dependencies sit behind injectable seams.** `PortalDriver`,
  `SecretStore`, `SessionStore`, `AuditSink`, `Clock` are interfaces in
  `@sii/core` with Node default implementations; tests inject fakes so they
  never touch the real SII / keyring / clock. The core is otherwise a normal
  Node library (it may use Node APIs directly). (ADR-003)
- **Authentication is an explicit verb, not a side-effect.** Domain tasks never
  mint a session; they consume a valid one or raise `NotAuthenticated`. Only the
  login task mints. (ported sii-py ADR-019)
- **Identity is single-account + operate-centric.** One live session at a time;
  switch accounts by logout→login. Within a session, a persona's `operate`
  pointer chooses which RUT it acts as (self by default, or a represented
  empresa). `operate` SELECTS, never mints, and is validated against the cached
  operable set. Empresa accounts have no operate capability. The active operating
  RUT is ALWAYS visible (status + an `operating as:` header). (ADR-005)
- **Per-call `--rut` overrides the operate pointer** for one operation; it is the
  same value-domain (the operable set), not a separate concept.
- **Validate external inputs at the boundary with `zod` (ADR-011).** MCP tool
  inputs (the SDK derives the protocol JSON Schema from the zod shape) and, later,
  SII wire payloads in `@sii/core`. Validation stays at the boundary — internal
  domain invariants are plain TypeScript types, never zod.

## SII domain rules

- **No third-party SII libraries.** Every selector, endpoint, and payload
  constant is derived from first-hand observation of the live SII source (HTML,
  JS, WSDL, official PDFs) and cited in a code comment, e.g.
  `// observed at <URL> on <YYYY-MM-DD>`. (ADR-004)
- **Prefer inline structured data over DOM scraping.** Where the portal ships a
  JS object (e.g. `DatosCntrNow`) or an inline data map, read THAT, not the
  rendered DOM. Cite the variable name and observation source.
- **Portal session detection is URL-based, not DOM-based.** Landing on
  `zeusr.sii.cl` means not authenticated; any other host means we reached the
  destination. URL is part of the auth contract; DOM markers are a guess.
- **Wire contracts are documented under `docs/sii-contract/`** per surface, with
  the request shape, response shape, and observation date. (ported sii-py ADR-020)
- **Authenticated SPA-JSON facades go through `PortalSession.requestJson`.** The
  `www4.sii.cl` SDI endpoints (RCV, representación, …) are reached via the seam's
  authenticated JSON POST (the session cookies ride along), never a bespoke HTTP
  client. Cite the endpoint + observation date; parse the `data[]` rows
  alias-tolerantly (observed name first); curated + `raw`; surface the
  `respEstado` error envelope verbatim. (ADR-003 / ADR-004)
- **Curated + raw for rich payloads.** When SII returns 30+ fields per row,
  expose a curated typed shape (~10–15 fields) plus a `raw` carrying the full
  payload for tax-special edge cases.
- **Pass SII's Spanish error messages through unchanged.** The user knows the
  domain; opaque translations waste their time. A scraper that can't find its
  selector raises a "scraper broken" error — never retry silently.
- **Never retry after a SII rate-limit / block.** It is server-side and timed;
  surface the message verbatim and stop.
- **Validate a RUT locally (Mod-11) BEFORE any login attempt.** A malformed RUT
  must never become a wasted submit — repeated failed logins lock the account.
  The CLI parses + Mod-11-checks the RUT before prompting/sending the Clave; a
  login (browser or `--console`) makes exactly ONE attempt, never auto-retried.
  (ADR-004 / ADR-010)

## Security, secrets & PII

- **The Clave never reaches the LLM and never lands in plaintext.** Login is
  either the user typing into SII's real page (browser, cookies-only) or a value
  in the OS keyring behind the `SecretStore` seam. No MCP tool accepts a
  password argument. (ADR-006)
- **Secrets are captured via a hidden terminal prompt — never a flag/env/arg.**
  The CLI `--console` login prompts the Clave with echo muted; it never accepts
  the Clave as a CLI flag, env var, or argument (no shell-history / argv /
  process-list leak). It is held in memory for one attempt, then discarded; only
  cookies persist. A task that takes a Clave (`consoleLogin`) is exported from the
  CLI-only `@sii/core/cli` subpath, NOT the main barrel, so the MCP server cannot
  wire it. (ADR-006 / ADR-010)
- **Never commit** `*.pfx`, `*.p12`, `.env`, or anything under `.sii/`. Sessions
  are cookies-only; `.gitignore` blocks them — re-verify before any `git add`.
- **Audit every state-touching op** via the `AuditSink` port: `{ts, action, rut,
  result, durationMs?, ...extra}`. Keys whose lowercased name contains
  `password|clave|cookie|secret|token` are dropped before the line is written.
  The log is a receipt, never a gatekeeper — write failures degrade silently.
- **PII hygiene.** Real PII (nombre, RUT, dirección, email, teléfono, DoB) never
  lands in a tracked file — including CI guard denylists (hold those in a repo
  secret). Tests use synthetic, Mod-11-valid RUTs only. A task that surfaces the
  user's own PII carries an explicit opt-in name and states the exposure in its
  CLI help + MCP description; PII values never go to the audit log.

## Testing

- Tests must NOT hit production SII. Default mode is recorded fixtures with
  synthetic data; any live test is gated behind an explicit env var.
- Reproduce CI conditions before pushing (env stripped of any credential vars).

## Naming

- Files: kebab-case `.ts` modules. Tests: `<module>.test.ts` (vitest).
- Domain terms stay in Spanish where they are Spanish (`boletaHonorarios`,
  `propuestaF29`, `carpetaTributaria`). Don't anglicize SII terminology.
- User-facing surfaces (CLI verbs, MCP tool names) are English where no
  entrenched Spanish term exists (`status`, `login`, `profile`), Spanish where
  one does (`rcv`, `f29`, `bte`).
- Form/document codes stay numeric (`F29`, `F22`, DTE `33`/`39`).

## Commits & PRs

- One topic per commit. Conventional Commits subject (`feat(scope): …`),
  ≤72 chars. English everywhere (commits, branches, PRs).
- **No AI attribution anywhere** — no `Co-Authored-By`, no "Generated with",
  no `🤖`, in any artifact that lands in git or on GitHub. Authorship is the
  human owner.
- `docs/` updates ship in the SAME commit as the code that motivated them.
