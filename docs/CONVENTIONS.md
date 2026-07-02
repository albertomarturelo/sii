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
  so the compiled output runs directly on Node; bare specifiers (`@altumstack/sii-core`,
  `commander`) stay extensionless. `tsc` errors on a missing extension. (ADR-009)

## Architecture patterns

- **Single-env (prod) is the contract.** No `SII_ENV` switch. Hostnames are
  constants in `@altumstack/sii-core` config; never hard-code a SII hostname anywhere else.
- **Surfaces call `@altumstack/sii-core` tasks only.** CLI and MCP never reach past the
  task layer into a portal/DTE facade — that bypasses throttling, audit log, and
  credential handling. (ADR-003)
- **The core is the data layer; surfaces present. JSON is the default output.**
  `@altumstack/sii-core` tasks return plain, JSON-serializable objects (no `Date`/`Map`/`Set`,
  no human formatting) — that is the library/integration contract. The MCP surface
  emits `JSON.stringify`; the CLI emits JSON by DEFAULT (`--human` for the readable
  rendering, `--json` is the explicit default). A command computes its result object
  ONCE and renders it through the shared `emit(data, humanFn)` — never bare `out()`
  for a result. STDOUT carries only the result (JSON pipeable to `jq`); the
  `operating as:` header + diagnostics go to STDERR and are human-mode-only. (ADR-012)
- **External dependencies sit behind injectable seams.** `PortalDriver`,
  `SecretStore`, `SessionStore`, `AuditSink`, `Clock` are interfaces in
  `@altumstack/sii-core` with Node default implementations; tests inject fakes so they
  never touch the real SII / keyring / clock. The core is otherwise a normal
  Node library (it may use Node APIs directly). (ADR-003)
- **Authentication is an explicit verb, not a side-effect.** Domain tasks never
  mint a session; they consume a valid one or raise `NotAuthenticated`. Only the
  login task mints. (ported sii-py ADR-019)
- **Domain tasks reach SII through `withSession`, never a bespoke restore.** The
  `auth/session.ts` primitive restores the cookies-only session into a live
  `PortalSession`, resolves the operating/body RUT (override > pointer > self — a
  `--rut` override is validated against the operable set HERE, the single
  enforcement point, via the same `resolveOperableTarget` the `operate` command
  uses), hands both to the callback, and always closes the session — raising
  `NotAuthenticated` when there is none. It does NOT eagerly probe liveness — the
  first SDI POST IS the liveness test: the `requestJson` seam detects the login-wall
  response (a dead jar bounced to HTML / `LOGIN_HOST`) and raises `SessionExpiredError`
  (actionable "re-login"), so facades must let `NotAuthenticated` propagate instead of
  wrapping it as their domain error. NEVER retries after a block. New read surfaces
  (rcv/f29/bte) wrap their facade call in it. (ADR-003 / ADR-005)
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
  SII wire payloads in `@altumstack/sii-core`. Validation stays at the boundary — internal
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
  client. Cite the endpoint + observation date; surface the `respEstado` error
  envelope verbatim; curated + `raw`. (ADR-003 / ADR-004)
- **Inline-JS-map facades (legacy CGIs) go through `PortalSession.goto` + `evaluate`,
  NOT `requestJson`.** Some surfaces (BHE/BTE on `loa.sii.cl/cgi_IMT/`) serve an HTML
  skeleton whose tables are filled client-side from global JS maps (`xml_values`,
  `arr_informe_mensual`). Navigate with `goto` (the `.sii.cl` session cookie SSO-carries;
  detect a dead jar by a `LOGIN_HOST` landing → `SessionExpiredError`) and read the map
  with `evaluate("…Object.fromEntries(Object.entries(V))…")` — the `Object.entries`
  wrapper is REQUIRED (the maps are JS Arrays with string keys a bare read would drop).
  NEVER scrape the rendered DOM (the cells still hold the filling JS). Cite the CGI +
  observation date; pace pagination via `Clock.sleep`. (ADR-003 / ADR-004)
- **Unauthenticated public consultas go through `PortalDriver.requestPublic`.** A
  login-free CGI (DTE-authorized) is a cold, session-less, browser-free HTTP request
  (Node `fetch`, charset-aware) — not a `PortalSession`. Still a task + seam (audited),
  never a bespoke client in the facade. (ADR-014)
- **Authenticated HTML form-POST write flows go through `PortalSession.requestForm`.** The
  legacy `loa.sii.cl/cgi_IMT/` `TMBECN_*` CGIs (BHE emission) take `x-www-form-urlencoded`
  POSTs and return HTML, so they use `requestForm` (authenticated peer of `requestPublic.form`),
  NOT `requestJson` (JSON-only, treats HTML as a login wall). The login-wall check is URL-based
  (landing on `LOGIN_HOST`) since an HTML body is expected. Parse the response's inline
  `xml_values` with in-house helpers (single- AND double-quoted; `formatMiles("<n>")` amounts);
  read JS-built `<select>` values from their backing map (`iddir1`), never from the static HTML.
  (ADR-017)
- **Write surfaces are two-phase, session-keyed, confirm-gated, PII-free in the audit (ADR-017).**
  A state-changing op (first: `bte emit`) exposes a non-mutating PREVIEW (server computes the
  result without committing) split from the ISSUE step. The CLI defaults to the preview; the real
  write needs an explicit `--confirm <echo>` (double-entry of a load-bearing value, e.g. the gross
  total). The MCP `*_emit` tool carries `destructiveHint: true` + an explicit `confirmar` + amount
  echo, with an honest "issues a legally-binding document" description. Audit every attempt with
  the result id (folio) only — never the counterparty / amount / free-text (PII/business data).
  **Never retry a write after a SII error.** Server-computed values (retención rate) are READ from
  the form, never hardcoded. Live-validate the ISSUE path against a real (needed) document — never
  a throwaway.
- **Wire parsing is zod-at-the-boundary + alias-tolerant rows (ADR-011 / ADR-004).**
  Validate the SDI ENVELOPE with zod (`respEstado` block + the `data[]` array; use
  `.loose()` so unobserved fields survive into `raw`). Project each row into the
  curated shape with an **alias-tolerant** lookup (an ordered tuple per logical
  field, OBSERVED NAME FIRST; extend with a `// observed …` citation when SII serves
  a new key). Empty `data[]` is a legitimate "no rows", never an error. zod stays at
  the boundary only — curated domain types are plain TypeScript. `representacion.ts`
  predates this (hand-rolled, pre-zod) and may be migrated; `rcv.ts` is the template.
- **Domain read surfaces own a per-module file + a register fn (no barrel churn).**
  Each module ships `cli/src/commands/<mod>.ts` (`register<Mod>(program, runtime)`)
  and `mcp/src/tools/<mod>.ts` (`register<Mod>Tools(server, runtime)`); `program.ts`
  / `server.ts` call it from ONE append-only line. This keeps the shared command tree
  conflict-free across parallel module worktrees (ADR-007). `rcv` sets the pattern.
- **Curated + raw for rich payloads.** When SII returns 30+ fields per row,
  expose a curated typed shape (~10–15 fields) plus a `raw` carrying the full
  payload for tax-special edge cases. **Exception: drop `raw` when the
  non-curated data is PII, not tax detail.** F22's uncurated fields are pure
  identity/bank PII (RUT, dirección, email, número de cuenta) — every tax código
  IS curated — so F22 exposes NO `raw` at all, keeping that PII off every surface
  / the LLM / the audit log. **BTE/BHE joins this no-`raw` camp (live BUG-1):** a
  boleta ROW mixes counterparty data with the taxpayer's OWN identity on both sides
  (emitidas `usuemisor` = self emitter, recibidas `nombre_receptor` = self receptor),
  and the own-identity field set is not provably enumerable — so a per-field denylist
  is unsafe; curate the named tax fields and expose NO `raw`. **Prefer dropping `raw`
  over a denylist whenever the own-PII field set can't be proven complete.** (ADR-004)
- **Curate PII-dense code grids by DENYLISTING the (bounded) PII, not allowlisting
  the tax códigos.** When a grid interleaves tax códigos with identity/bank PII
  (F22), drop ONLY the PII códigos and surface everything else. The PII set is small,
  fixed, and authoritative (F22's `codigosFormato.codigosCabecera` = the form header
  section, + the bank códigos) — so a denylist stays comprehensive. The tax códigos,
  by contrast, are many and taxpayer-specific: an **allowlist of tax códigos was
  tried for F22 `--full` (#27) and REJECTED** because it silently HID real
  honorarios/retenciones/deducciones lines for taxpayers whose códigos weren't in the
  hand map (AT 2023–2024) — the exact data the user needs. Surface unmapped non-PII
  códigos in an `otros`/visible bucket, never drop them. Keep the PII denylist
  complete by citing each código (`// observed …`); the RUT leaked under `9306`/`9920`
  then `8809` before the set was completed. (ADR-004 / ADR-006)
- **Body-RUT vs session-keyed surfaces (ADR-005).** A *body-RUT* surface (RCV)
  carries the operating RUT in the request body, so `operate`/`--rut` reaches a
  represented empresa — the task resolves the operating RUT. A *session-keyed*
  surface (F22; F29/BHE expected) authorizes by the session PRINCIPAL: it ignores
  the operate pointer, takes NO `--rut`, and always reads self; the empresa's data
  is reached by logging in AS the empresa (logout→login). Confirm reach live before
  wiring each session-keyed surface (F22 confirmed 2026-06-27). `rcv` is the body-RUT
  template, `f22` the session-keyed one.
- **Pace multi-call fan-outs via `Clock.sleep`.** A task that fires N POSTs (a
  multi-period/-year loop, a folio walk) sleeps `1000/rateLimitRps` ms between
  them through the `Clock` seam (the fake resolves instantly, so tests don't wait)
  — never hammer SII; never retry after a block. (ADR-004)
- **Pass SII's Spanish error messages through unchanged.** The user knows the
  domain; opaque translations waste their time. A scraper that can't find its
  selector raises a "scraper broken" error — never retry silently.
- **Never retry after a SII rate-limit / block.** It is server-side and timed;
  surface the message verbatim and stop.
- **In a multi-call fan-out, a per-item SII error stops the ITEM, not the batch.**
  When a task fans out N POSTs (a multi-folio/-period/-year loop) and ONE item
  returns a business/server error (e.g. F22 `historial`'s `buscaEventos` failing on
  a superseded folio — SII's own UI fails identically), capture that item's SII
  message VERBATIM in a per-item error list (F22's `foliosConError`) and continue
  with the rest; never retry it. A SESSION-level error (`NotAuthenticated` /
  `SessionExpired`) is NOT a per-item error and still aborts the whole fan-out. This
  refines "surface verbatim and stop" for the batch case: stop the item, surface it,
  keep the rest. (ADR-004)
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
  CLI-only `@altumstack/sii-core/cli` subpath, NOT the main barrel, so the MCP server cannot
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
- **One feature / work-unit per PR.** Don't bundle two distinct features even on
  the same branch — when a second feature emerges mid-branch, give it its own
  branch/PR (stacked if it depends on the first). Split BEFORE opening the PR.
- **Status docs go in a SEPARATE commit from feature code.** `CURRENT_STATUS.md`
  and `ROADMAP.md` bookkeeping is its own commit; the feature commit carries code
  plus its tightly-coupled docs only (the ADR + any `sii-contract/*.md`).
- **No AI attribution anywhere** — no `Co-Authored-By`, no "Generated with",
  no `🤖`, in any artifact that lands in git or on GitHub. Authorship is the
  human owner.
- `docs/` updates ship in the SAME commit as the code that motivated them.
