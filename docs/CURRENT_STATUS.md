# Current Project Status

Last updated: 2026-06-27

## In Progress

- **Auth + identity base — core logic, Playwright driver, AND the CLI surface
  landed; runnable binary, real-SII validation + MCP next.** `@sii/core` exposes
  `login` / `logout` / `authStatus` / `statusRefresh` / `operate` / `operateSelf`
  (unit-tested against the fake driver). The Node Playwright `PortalDriver` is
  wired into `createNodeRuntime`. The `@sii/cli` (commander) surface is built and
  runs as a real Node binary: `sii auth login|status [--refresh]|logout`,
  `sii operate <rut>|--self`, with the always-visible `operating as:` STDERR
  header and the documented exit-code mapping. What's left: a real-SII `auth login`
  end-to-end run (headed browser against `zeusr.sii.cl`), then the MCP surface.

## Recently Completed

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
  `/review-pr` slash commands pointed at `AltumStack/sii`.
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
   (ADR-008). **`zod`** — only when the first MCP input schema lands.

## Known Issues

- **No real-SII login has been run yet.** The CLI runs and the Playwright driver
  is wired + offline-smoke-validated, but no `sii auth login` has gone against the
  live `zeusr.sii.cl` page. That headed end-to-end run is the next validation.
- pnpm 10 blocked esbuild's postinstall build script (warning only) — vitest
  bundles its own esbuild, tests run fine. (Same for `playwright`'s install
  script; the Chromium binary is fetched explicitly via `playwright install`.)

## Next Priorities

1. **Real-SII login validation** — run `sii auth login` against `zeusr.sii.cl`:
   headed browser, user types the Clave, confirm cookies-only persistence +
   `auth status --refresh` readback. First live contact with SII.
2. **MCP surface** — `auth_login` (no password arg) / `auth_status` / `operate`,
   plus Resources (`sii://session`, `sii://operating`); validate it connects from
   Claude Code (`.mcp.json`) and Claude Desktop (`claude_desktop_config.json`).
3. **Operable fetch** on login (`getDcvEmpresasAutorizadas`) → real operate targets.
4. **Then fan out** the domain modules (rcv → f29 → f22 → bte → dte) via worktrees
   against the now-stable seams + task contract (ADR-007).

See `docs/ROADMAP.md` for the full surface checklist.
