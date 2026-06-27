# Current Project Status

Last updated: 2026-06-27

## In Progress

- **Auth + identity base — core LOGIC landed and tested; surfaces + real driver
  next.** `login` / `logout` / `authStatus` / `statusRefresh` / `operate` /
  `operateSelf` are implemented in `@sii/core` and fully unit-tested against the
  fake `PortalDriver` (no SII touched). What's left to make it usable: the real
  Node Playwright `PortalDriver` adapter, then the CLI (commander) + MCP surfaces.

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
- [x] **Toolchain green** — pnpm install; `tsc -b` (strict) ✓, eslint ✓,
  prettier ✓, **29/29 vitest tests** ✓.

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

- **`createNodeRuntime().portal` is an unwired stub that throws** — real browser
  login needs the Node Playwright `PortalDriver` adapter (next task). All auth
  logic is already validated via the fake driver, so this is a drop-in.
- pnpm 10 blocked esbuild's postinstall build script (warning only) — vitest
  bundles its own esbuild, tests run fine.

## Next Priorities

1. **Node Playwright `PortalDriver` adapter** — headed `interactiveLogin` (resolve
   off `zeusr.sii.cl`) + headless `restore`; wire into `createNodeRuntime`. Makes
   `auth login` real. Add `playwright` to `@sii/core` deps (ADR-008).
2. **CLI surface (commander)** — `sii auth login` / `logout` / `status [--refresh]`,
   `sii operate <rut> [--self]`, the always-visible `operating as:` header (STDERR).
3. **MCP surface** — `auth_login` (no password arg) / `auth_status` / `operate`
   + Resources (`sii://session`, `sii://operating`); validate it connects from
   Claude Code (`.mcp.json`) and Claude Desktop (`claude_desktop_config.json`).
4. **Operable fetch** on login (`getDcvEmpresasAutorizadas`) → real operate targets.
5. **Then fan out** the domain modules (rcv → f29 → f22 → bte → dte) via worktrees
   against the now-stable seams + task contract (ADR-007).

See `docs/ROADMAP.md` for the full surface checklist.
