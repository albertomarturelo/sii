# Current Project Status

Last updated: 2026-06-28

## In Progress

- _(nothing actively in progress — issue #5 closed; pick the next priority below)._

## Recently Completed

- [x] **MCP `operate list=true` (#23).** The operable set was only reachable as the
  `sii://operable` Resource, which MCP clients don't surface as a callable method —
  so testing in Claude Desktop there was no way to *invoke* "list the accounts I can
  operate". Added `list=true` to the `operate` tool (equivalent to CLI `operate
  --list`): returns the operable set with self/current markers, no-session → an
  actionable `auth_login` hint. Thin call into the existing `listOperable` task
  (ADR-003); the resource stays. `formatOperableEntry` shared by CLI + MCP. 2 new tests.
- [x] **RCV read surface — the domain-read template (#17).** First full domain vertical:
  `portal/rcv.ts` (facade: `getResumen` + `getDetalle{Compra,Venta}`) → `tasks/rcv.ts`
  (`rcvSummary`/`rcvList`, `withSession`-wrapped, body-RUT, one audit receipt) → CLI
  `sii rcv summary|list` + MCP `rcv_summary`/`rcv_list`. **Live-validated 2026-06-28**
  (persona session): resumen+detalle aliases match real COMPRA data; two live fixes —
  an expired session now raises `SessionExpiredError` ("re-login") instead of a
  misleading "no es JSON" (the `requestJson` seam detects the login wall), and
  `codRespuesta=3` is "sin movimientos" (empty), not a rejection. **`--rut` reached a
  represented empresa's RCV** (code 0 + a row) → RCV is body-RUT, confirming ADR-005
  (partial answer to spike #15). Established three reusables the other modules inherit:
  the **`periodo`** primitive (YYYYMM, accepts `2026-5`), the **zod-at-the-boundary +
  alias-tolerant** wire-parsing convention (ADR-011), and the **per-module
  surface-registration pattern** (`commands/<mod>.ts` + `tools/<mod>.ts` register fns →
  append-only barrels, so parallel worktrees don't conflict). zod added to `@sii/core`.
  25 new tests vs fakes (no SII), 109/109 green.
- [x] **`withSession` session-acquisition primitive (#14).** Factored the
  restore-session lifecycle out of login/`statusRefresh` into `auth/session.ts`:
  `withSession(runtime, fn, {rut?})` restores the cookies-only session into a live
  `PortalSession`, resolves the operating/body RUT (override > pointer > self, ADR-005),
  hands both to `fn`, and always closes — raising `NotAuthenticated` when none. Consumes,
  never mints (ADR-006/019); no eager liveness probe (expiry surfaces as the facade's
  typed error); never retries after a block. `session.ts` now owns the session storage
  primitives; `statusRefresh`/`probeLive` reuse it (no behavior change). The reusable
  basis every domain read surface (rcv/f29/bte) wraps its facade call in. 4 new tests vs
  fakes (no SII), 84/84 green.
- [x] **MCP `auth_logout` tool (#11).** Added `auth_logout` to `@sii/mcp` — a thin
  call into the existing `logout` task (best-effort server-side close + local cookie
  wipe), no input args. Logout carries no secret, so ADR-006 doesn't bar it from MCP;
  switching accounts stays logout→login (ADR-005). Mirrors the CLI logout messages.
  4 added/extended tests via the in-memory MCP client against fakes (no SII), 80/80
  green. Flipped the ROADMAP logout row + MCP-structure note off "(CLI-only)".
- [x] **Operable fetch on login (ADR-005).** `getDcvEmpresasAutorizadas` is now
  wired into login: a persona's operable set is fetched from SII (the empresas it
  can operate), replacing the `[self]` placeholder; empresa accounts skip it.
  Best-effort — any failure degrades to `[self]`, so a login never fails on the
  lookup; razón social is PII (never audited, only the count). Added the
  SPA-JSON-facade primitive to the seam — `PortalSession.requestJson` (authenticated
  JSON POST from the browser context) + `cookie()` — the reusable basis for ALL
  future read surfaces (rcv/f29/bte). New `portal/representacion.ts` ports the wire
  contract first-hand (cited; `docs/sii-contract/empresas-autorizadas.md`). 9 tests
  vs fakes (no SII). **Live-validated 2026-06-28**: a real session returned 1
  represented empresa + self (the `.sii.cl` cookie covers www4 — no SPA nav needed);
  a fresh login populated `operate.json` and `sii operate --list` showed the empresa.
- [x] **Surface operable** — `sii operate --list` (operable set with self/current
  markers) + the MCP `sii://operable` resource + a `listOperable` task; fixed the
  dangling operate-rejection hint to point at `sii operate --list`. (PR #10, merged.)
- [x] **MCP stdio surface (ADR-011 — zod adopted).** `@sii/mcp` server built over
  `@sii/core` tasks (thin, ADR-003): Tools `auth_login` (NO password arg —
  delegates to the browser flow, ADR-006), `auth_logout` (no args, #11),
  `auth_status` (`refresh`), `operate` (`rut`/`self`); Resources `sii://session`,
  `sii://operating`, `sii://operable`, `sii://config`.
  `buildServer(runtime)` is injectable; `main` serves over stdio (STDOUT = JSON-RPC,
  errors to STDERR). zod v4 validates tool inputs (the SDK derives the protocol JSON
  Schema). 5 tests via an in-memory MCP client against fakes (no SII); the built
  binary passes the `initialize` handshake. `consoleLogin` stays unreachable (it's
  in the CLI-only `@sii/core/cli` subpath). Claude Desktop config repointed at the
  TS binary (`/opt/homebrew/bin/node …/packages/mcp/dist/main.js`, abs paths —
  Desktop's PATH is restricted); live tool-use confirmation from Desktop pending.
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

1. **Operate reach (representación) spike (#15)** — **RCV CONFIRMED body-RUT live
   2026-06-28**: a persona representante-legal's `--rut` reached a represented empresa's
   RCV (code 0 + a row). Still OPEN for the session-keyed surfaces (F29/F22/BHE) — run
   before wiring #18/#19/#20. Decides the rest of the ADR-005 reach contract.
2. **CLI header doesn't reflect a per-call `--rut`** — `operating as:` (preAction hook)
   shows the sticky operate POINTER, so `sii rcv summary … --rut <empresa>` prints
   "tú mismo" while the result line shows the empresa RUT. Minor ADR-005 "always
   visible" wart; the result is correct. Follow-up (small): make the header aware of
   the per-call override, or have domain commands print their effective RUT.
3. **Keyring lib** (`@napi-rs/keyring`) — only when the credential login path lands
   (ADR-008). _(`zod` resolved — adopted in ADR-011 for MCP input schemas.)_

## Known Issues

- pnpm 10 blocked esbuild's postinstall build script (warning only) — vitest
  bundles its own esbuild, tests run fine. (Same for `playwright`'s install
  script; the Chromium binary is fetched explicitly via `playwright install`.)

## Next Priorities

1. **Live-revalidate RCV** — re-observe `getResumen`/`getDetalle` against a real session
   from the TS port (operator-assisted): confirm endpoints/fields, refresh the dates in
   `sii-contract/rcv.md`, note new aliases. (The contract is ported, not yet re-observed.)
2. **Fan out the module worktrees** against the RCV template (registration pattern +
   `periodo` + zod-wire convention now stable): **DTE #21** can go immediately (public,
   no spike); **F29 #18 / F22 #19 / BTE #20** after the spike. (ADR-007)
3. **Operate-reach spike (#15)** (ADR-005) — does `operate` reach F29/F22/BHE or only
   RCV? Gates #18/#19/#20 (not RCV/DTE). Now testable live.
4. **Confirm MCP live in Claude Desktop** — the config points at the TS binary; confirm
   the `sii` tools/resources appear and `auth_login` drives the browser flow.
5. **`operate <alias>`** — alias targets now that the operable set has real empresas.

See `docs/ROADMAP.md` for the full surface checklist.
