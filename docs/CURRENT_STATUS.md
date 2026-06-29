# Current Project Status

Last updated: 2026-06-29 (PM — F22 historial shipped, #28 ✅ — F22 surface complete)

## In Progress

- _(no feature in progress — F22 is now COMPLETE: status/overview (#19), formulario (#27/#37),
  observaciones (#26), historial (#28) all merged + live-validated; CLI JSON-default (#35).)_
  **Next session candidates:** **#18 F29** (session-keyed, reuse the f22 task shape);
  **#21 DTE authorized** (public, no spike); **#20 BTE** (session-keyed). Two read templates
  exist: **RCV** (body-RUT) and **F22** (session-keyed); the **JSON-default surface contract**
  (ADR-012) is the norm for any new CLI verb (`emit(data, humanFn)`).

## Recently Completed

- [x] **F22 formulario grouping — post-merge MCP-testing fixes (PR #40).** Claude Desktop
  testing of the F22 surface surfaced four findings; resolved: (BUG 2) `157`/`158`/`304` (IGC
  intermediate steps — "según tabla" / "SUB TOTAL" / "débito fiscal") split out of `resultado`
  into a new **`calculo`** group — a subtotal is not a result; `F22Grupos` now has six groups,
  union still = flat grid (nothing hidden; omitting was rejected). (BUG 3) `162` kept in the
  combined `creditos` (retenciones·PPM·créditos) group — SII's glosa IS "Crédito al IGC/IUSC" —
  now documented. (BUG 4) `otros` kept (anti-allowlist safety net) + documented in the MCP
  description. (BUG 1, `f22_historial` superseded folio in `foliosConError`) **not a bug** — SII
  returns `data:null` + a server error for that folio (its own UI fails identically), so there
  are no events to parse. CLI + MCP share `groupCodigos`, so the fix covers both. Live-validated
  AT 2024; 168/168 green.
- [x] **F22 historial read surface (#28) — F22 surface now COMPLETE.** Fourth F22 vertical:
  `portal/f22.ts` `fetchF22Historial` (`buscaEventos(periodo,rut,dv,folio)` → the per-folio
  event timeline: declaración recibida, devoluciones, giros de Tesorería, rectificatorias,
  fechas) → `tasks/f22.ts` `f22Historial` (`withSession`, session-keyed, paced, audited) →
  CLI `sii f22 historial <año> [--folio]` + MCP `f22_historial`. **Phase-1 spike (live,
  2026-06-29, own session):** located `buscaEventos` first-hand via a direct authenticated
  probe — the **folio is REQUIRED** (without it: a RESTEASY 500), all params sent as **strings**
  (like `buscaDeclVgte`, unlike observaciones' numbers); cited in `sii-contract/f22.md` (the
  Python `sii-cli` only listed `buscaEventos` as a "supporting facade", never ported it).
  Default reads **EVERY folio of the año** (rectificatorias included), paced via `Clock.sleep`,
  aggregated **most-recent-first**; `--folio` scopes to one. **Per-folio resilience:** one
  folio's SII error is captured verbatim in `foliosConError` (CLI: a `⚠ folio …` line) and the
  other folios' events still return — a session-level failure still aborts. **Live-validated
  end-to-end** through the CLI: AT 2025 → 3 eventos, AT 2024 → 5, AT 2023 → 8. **AT 2026
  finding (drove the resilience):** a rectificatoria year had TWO folios — the vigente returned
  its 2 eventos, the superseded returned an SII server-side parse error
  (`"For input string: \"    <n>\""`); the historial now shows the good folio's events +
  flags the bad one (exit 0), instead of aborting. (Also resolved: `vgte` arrives `"1"`/`"0"`
  on some años, `"S"`/`"N"` on others.) Rows are **non-PII** (event code + glosa verbatim +
  carta refs) → fully curated, **no `raw`**, session-keyed (no `--rut`). 13 new tests vs fakes
  (no SII), 167/167 green.
- [x] **F22 complete form → `f22 formulario` verb (#27/#32 then #36/#37).** The complete
  grouped F22 form: reads `f22Compacto` (the form the SII renders) + curates into the lines a
  contador reads — **ingresos / deducciones / retenciones·PPM·créditos / resultado**, with a
  visible `otros` catch-all (nothing tax-relevant hidden). Live-designed from a headed-Playwright
  capture of the real "formulario completo" (AT 2023–2026): **`f22Completo` is noisier, not
  richer** → NOT used. **PII posture is a DENYLIST of identity/bank códigos only** (authoritative
  from `codigosFormato.codigosCabecera`); an allowlist was tried + REJECTED (it hid real
  honorarios/retenciones/deducciones). **es-CL monto parsing** fixed (`"12.345.678"` → 12345678;
  `Number()` mis-parsed it → income shown as "—"). Shipped first as `status --full` (#32) then
  **split into its own verb `f22 formulario <año>` / MCP `f22_formulario` (#37)** — `status`
  no longer overloaded. Taxonomy extracted to `portal/f22-codigos.ts`. CLI + MCP, both thin
  calls into the same `f22Status({full})` task. 154/154 green; live-validated.
- [x] **CLI JSON output by default — ADR-012 (#35).** The CLI emits each command's `@sii/core`
  result object as pretty JSON on STDOUT by default (`--human` for text); the core is the
  JSON-serializable library contract, the MCP already spoke JSON. Shared `emit(data, humanFn)`
  helper; STDOUT pure (pipeable to `jq`), header/diagnostics on STDERR human-only; errors in JSON
  mode are `{ "error": "<verbatim>" }`. CONVENTIONS records the output-contract rule.
- [x] **Review hygiene.** Real montos + a real folio had slipped into tests/docs as
  "synthetic" — caught in `/review-pr`, scrubbed to synthetic AND purged from branch history
  (force-push). Reaffirmed: tests/docs use synthetic data only; CONVENTIONS' denylist rule.
- [x] **F22 observaciones read surface (#26).** Third F22 vertical: `portal/f22.ts`
  `fetchF22Observaciones` (`situacionObservacion(periodo,rut,dv,folio)` →
  `[{codigo,descripcion,url}]`) → `tasks/f22.ts` `f22Observaciones` (`withSession`,
  session-keyed, paced, audited) → CLI `sii f22 observaciones <año> [--folio]` + MCP
  `f22_observaciones`. **Phase-1 spike (live, own session, 2026-06-29)** located the SDI
  endpoint first-hand via a headed-Playwright network capture (the Python `sii-cli` has no
  equivalent), cited in `sii-contract/f22.md`. **Live-validated 2026-06-29** (CLI + MCP):
  returned observación B102 with correct accents (the spike's mojibake was a
  `response.text()` artifact). Rows are **non-PII** (observación code + glosa + SII ayuda
  URL) — fully curated, no header-código exclusion, no `raw`. Envelope extended for the
  top-level `errorMsg` channel; `--folio` fails fast when non-numeric. 8 new tests vs
  fakes (no SII), 144/144 green.
- [x] **Manual/live test-plans dir (#29).** `docs/test-plans/` (README + the F22 plan
  covering CLI + MCP, incl. the validated observaciones cases) — the live counterpart to
  the vitest suites. Plus the F22 follow-up ROADMAP rows (#26/#27/#28).
- [x] **F22 read surface — annual Renta estado (#19).** Second domain vertical, the
  **session-keyed template**: `portal/f22.ts` (facade: `buscaDeclVgte` decls+estado →
  `f22Compacto` código grid, on the `consultaestadof22ui` SPA) → `tasks/f22.ts`
  (`f22Status` per-year detail + `f22Overview` multi-year, paced) → CLI `sii f22 status
  [año]` + MCP `f22_status`. Wire contract PORTED from the Python `sii-cli` (cited;
  `docs/sii-contract/f22.md`) — not yet live-revalidated from TS. **Session-keyed
  (ADR-005)**: always the session principal, ignores the operate pointer, NO `--rut`
  (empresa F22 needs its own session) — **answers spike #15 for F22** (body-RUT does NOT
  reach it). **PII-safe**: header/identity/bank códigos excluded + F22 exposes NO `raw`.
  New: `Anio` primitive (YYYY) and `Clock.sleep` (pacing seam, fake instant). 19 new
  tests vs fakes (no SII, synthetic RUTs), 134/134 green.
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

1. **Operate reach (representación) spike (#15)** — **RCV = body-RUT** (live 2026-06-28:
   `--rut` reached a represented empresa's RCV). **F22 = session-keyed** (Python live
   2026-06-27: `--rut <empresa>` returned a clean negative; body-RUT does NOT reach it →
   F22 reads the principal, no `--rut`). Still OPEN for **F29/BHE** (#18/#20) — expected
   session-keyed like F22; confirm live before wiring.
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

1. **F22 surface is COMPLETE** — status/overview (#19), formulario (#27/#37), observaciones
   (#26), historial (#28) all shipped + live-validated. _(Possible future: per-carta
   `buscaObservacion` drill needs a non-null `idCarta`, absent on observed eventos — not
   pursued.)_
2. **Live-revalidate RCV** — re-observe the ported contract against a real session
   (operator-assisted): confirm endpoints/fields, refresh the dates in `sii-contract/rcv.md`.
   (F22 status/formulario + observaciones are now live-validated; RCV is not.)
3. **Other read modules** against the stable templates (registration + `periodo`/`Anio` +
   zod-wire + body-RUT/session-keyed): **DTE #21** (public, no spike); **F29 #18**
   (session-keyed, reuse the f22 task shape); **BTE #20** (session-keyed). (ADR-007)
4. **`operate <alias>`** — alias targets now that the operable set has real empresas.

See `docs/ROADMAP.md` for the full surface checklist.
