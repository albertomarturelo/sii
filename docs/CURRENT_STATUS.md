# Current Project Status

Last updated: 2026-06-28

## In Progress

- _(nothing actively in progress — issue #5 closed; pick the next priority below)._

## Recently Completed

- [x] **Operable fetch on login (ADR-005).** `getDcvEmpresasAutorizadas` is now
  wired into login: a persona's operable set is fetched from SII (the empresas it
  can operate), replacing the `[self]` placeholder; empresa accounts skip it.
  Best-effort — any failure degrades to `[self]`, so a login never fails on the
  lookup; razón social is PII (never audited, only the count). Added the
  SPA-JSON-facade primitive to the seam — `PortalSession.requestJson` (authenticated
  JSON POST from the browser context) + `cookie()` — the reusable basis for ALL
  future read surfaces (rcv/f29/bte). New `portal/representacion.ts` ports the wire
  contract first-hand (cited; `docs/sii-contract/empresas-autorizadas.md`). 9 tests
  vs fakes (no SII). NOT yet live-validated (real empresas readback is the follow-up).
- [x] **MCP stdio surface (ADR-011 — zod adopted).** `@sii/mcp` server built over
  `@sii/core` tasks (thin, ADR-003): Tools `auth_login` (NO password arg —
  delegates to the browser flow, ADR-006), `auth_status` (`refresh`), `operate`
  (`rut`/`self`); Resources `sii://session`, `sii://operating`, `sii://config`.
  `buildServer(runtime)` is injectable; `main` serves over stdio (STDOUT = JSON-RPC,
  errors to STDERR). zod v4 validates tool inputs (the SDK derives the protocol JSON
  Schema). 5 tests via an in-memory MCP client against fakes (no SII); the built
  binary passes the `initialize` handshake. `consoleLogin` stays unreachable (it's
  in the CLI-only `@sii/core/cli` subpath). Pending: live connect from Claude Code
  (`.mcp.json`) / Claude Desktop (`claude_desktop_config.json`).
- [x] **Console login `sii auth login --console` (ADR-010)** — a CLI-only input
  method peer to the browser login. Prompts RUT + Clave (hidden, never a flag),
  validates the RUT (Mod-11) locally first, then headless form-fills SII's real
  login form (`#rutcntr`/`#clave`/`#bt_ingresar`, observed) and persists the SAME
  cookies-only session. The Clave is used once and NEVER stored (no keyring); it
  never reaches MCP or the audit log. One attempt, no retry (account-lock safety).
  New seam `PortalDriver.credentialLogin` + fake; `consoleLogin` core/task; 8 new
  tests (55/55). Not yet exercised against live SII (a session was already warm).
- [x] **Real-SII auth login validated (issue #5)** — first live contact with SII.
  Headed `sii auth login` against `zeusr.sii.cl`: user typed the Clave, landed on
  Mi-SII (`misiir.sii.cl`, off the login host → URL detection holds), identity read
  from `DatosCntrNow`. Cookies-only session at `~/.sii/session.json` (0600,
  `{rut,cookies,savedAt}`, no plaintext secret). `auth status` (local) +
  `--refresh` (live portal readback) + `logout` (server close best-effort + local
  wipe) all confirmed. Wire contract captured in `docs/sii-contract/auth-login.md`
  (PII-free; ~45 `DatosCntrNow` fields, types only). No defects surfaced — no
  follow-up `fix` issue needed. The Playwright `PortalDriver` is now live-proven.
- [x] **Remote wired** — `origin` → `AltumStack/sii` (private, was empty).
- [x] **ADR-007** (modular core layout + worktree-parallel boundaries) +
  **ADR-008** (commander CLI, browser-cookies-only-first, keyring/zod deferred).
- [x] **Core spine** (all tested, no SII / fs / clock touched in tests):
  - `config` — prod hostnames + settings (single source of truth).
  - `rut` — parse + Mod-11 DV + canonical/formatted (in-house).
  - `errors` — domain hierarchy (NotAuthenticated/LoginFailed/RateLimit/…).
  - `seams` — `Clock` / `AuditSink` / `KeyValueStore` / `SecretStore` /
    `PortalDriver` interfaces (ADR-003).
  - `adapters/fake` (in-memory fakes) + `adapters/node` (fs KeyValueStore 0600,
    JSONL AuditSink, SystemClock) + `runtime.ts` composition root.
  - `audit` — stamps `ts`, drops secret-substring keys, never throws.
- [x] **`identity` / operate** — operate pointer (default self), operable set,
  account type, validation against operable, empresa-can't-operate rule,
  resolver precedence (`--rut` > pointer > self). Fully tested.
- [x] **`auth`** — browser cookies-only login orchestration (idempotent live-probe,
  reads `DatosCntrNow` for the RUT, persists cookies-only, defaults operate to
  self), logout (best-effort server close + local wipe), `localStatus` (pure
  local), `statusRefresh` (portal readback). Tested with the fake driver.
- [x] **`tasks/{auth,operate}`** public API (uniform `Runtime` arg) + the
  `@sii/core` barrel (surfaces import only this).
- [x] **Node Playwright `PortalDriver`** — `adapters/node/portal.ts`: headed
  Chromium `interactiveLogin` (resolves off `zeusr.sii.cl` via URL-based
  detection), headless `restore`, cookies-only `storageState` (ADR-006). The only
  module importing Playwright (ADR-003). Wired into `createNodeRuntime`; the
  throwing stub is gone. Offline-smoke-validated (no SII). (ADR-008)
- [x] **ADR-009 — NodeNext module resolution.** `module`/`moduleResolution` →
  `NodeNext`; all relative imports carry `.js`. `tsc -b` output now runs directly
  on Node (no bundler) — the prior extensionless-ESM output couldn't. Verified by
  running the built `sii` binary.
- [x] **`@sii/cli` (commander) surface** — `program.ts` command tree, thin calls
  into `@sii/core` tasks (ADR-003): `auth login|status [--refresh]|logout`,
  `operate [rut]|--self`. Always-visible `operating as:` STDERR header (ADR-005);
  error→exit-code mapping (NotAuthenticated 2 / LoginFailed 3 / RateLimit 4). Runs
  as a real binary; 8 CLI tests drive the whole tree against fakes (no SII).
- [x] **GitHub process bootstrap** — issue templates (bug / feature / work-unit)
  plus a PR template (adapted from sii-py to pnpm/vitest/TS); `/issue:*` and
  `/review-pr` slash commands pointed at `AltumStack/sii`; type + scope labels.
- [x] **GitHub Flow established** — PRs **#3** (process, closes #1) + **#4** (auth
  surfaces, closes #2) reviewed via `/review-pr`, findings fixed, squash-merged to
  `main`. Fixed a pre-existing CI bug: `pnpm/action-setup` pinned `version: 9`
  while `packageManager` is `pnpm@10.33.2` (failed before any step); CI now reads
  the version from `packageManager`. Both checks green on merge.
- [x] **Toolchain green** — pnpm install (+ `playwright`, `commander`, Chromium
  binary); `tsc -b` (strict) ✓, eslint ✓, prettier ✓, **39/39 vitest tests** ✓.

## Open Decisions / Questions

1. **Operate reach (representación) spike** — does a persona's `operate` reach the
   session-keyed surfaces (F29/F22/BHE), or only RCV? Decides the ADR-005 reach
   contract. Run before wiring those domain modules.
2. **Operable fetch** — `operate` currently caches `operable = [self]` on login;
   wiring `getDcvEmpresasAutorizadas` (a portal POST) to populate real represented
   empresas is the next identity increment.
3. **Keyring lib** (`@napi-rs/keyring`) — only when the credential login path lands
   (ADR-008). _(`zod` resolved — adopted in ADR-011 for MCP input schemas.)_

## Known Issues

- pnpm 10 blocked esbuild's postinstall build script (warning only) — vitest
  bundles its own esbuild, tests run fine. (Same for `playwright`'s install
  script; the Chromium binary is fetched explicitly via `playwright install`.)

## Next Priorities

1. **Live-validate MCP + operable** — register `@sii/mcp` in Claude Desktop /
   Claude Code; confirm the tools/resources appear and `auth_login` drives the
   browser flow; on a real persona login, confirm `getDcvEmpresasAutorizadas`
   returns the account's actual represented empresas.
2. **Surface operable** — MCP `sii://operable` resource + `operate <rut|alias>`
   (alias now that real empresas exist).
3. **Then fan out** the domain modules (rcv → f29 → f22 → bte → dte) via worktrees
   against the now-stable seams + task contract (ADR-007) — they reuse
   `PortalSession.requestJson`.

See `docs/ROADMAP.md` for the full surface checklist.
