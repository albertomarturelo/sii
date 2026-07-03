# Current Project Status

Last updated: 2026-07-02 — **`sii whoami` built + live-validated (#70)** — the authenticated account's razón social + email (CLI + MCP, session-keyed); PR open

## In Progress

- _(no feature in progress — `bte emit` (#60, PR #61) is MERGED to `main`.)_
  **NEXT (deferred, #62): live-validate the `bte emit` ISSUE step + cut the `0.3.0` release.** The
  preview/dry-run path is LIVE-VALIDATED (own session, 2026-07-02: login → valida → presenta →
  confirma returns the correct total/retención 15,25%/líquido, no boleta issued; both retención
  modes — RETRECEPTOR/RETCONTRIBUYENTE — dry-run-validated). NOT yet TS-live-validated: the final
  ISSUE POST (`TMBECN_BoletaHonorariosElectronica.cgi`, step 4) + its `cod_barras` parse + the
  optional email send — coded to the 2026-07-02 capture but not yet exercised for real
  (#62), to avoid a throwaway legal document + manual anulación. **The `v0.3.0` tag waits on #62.**
  Annulment (`bte anular`) is a separate follow-up (#63; needs its own live capture).
  **ALSO deferred (ADR-013): #18 F29 Fase 2 — the PRESENTED form via GWT-RPC.** The filed
  balance (computed totals 538/89/91, `fuente:"presentada"` + a `resumen`) lives ONLY behind
  `rfiInternet` **GWT-RPC** — a two-GWT-app, UI-stateful, build-hash-fragile flow (mapped in the
  spike; `docs/sii-contract/f29.md`). Gated on a headless warm+intercept PoC; own PR + ADR;
  encapsulated with "scraper roto" errors. **Also pending:** capture the propuesta-internal código
  glosas (142/563/115…) from `propuestaf29ui` once an available propuesta exists (June 2026; May
  already declared) — until then those show `glosa:null` (honest; ADR-004).

## Recently Completed

- [x] **`sii whoami` read surface (#70).** The authenticated principal's own identity beyond the
  RUT: **razón social/nombre + email**, read live from `DatosCntrNow` (like `auth status --refresh`,
  plus `eMail`). **Session-keyed** — reads the login principal, ignores the operate pointer (no
  `--rut`). CLI `sii whoami` (JSON default) + MCP `whoami` tool (`readOnly`) whose description
  **declares the PII exposure** to the model (ADR-006 / CONVENTIONS). **PII posture:** the audit
  records only that a read happened (rut), NEVER the razón social / email values; curated only, no
  `raw`. No spike needed (`razonSocial`/`eMail` already observed). **Domicilio deferred** (needs a
  live `direcciones[]` capture). 9 new tests vs fakes (no SII), 262/262 green. **Live-validated
  (CLI + MCP).**

- [x] **`bte emit` — the FIRST WRITE surface (ADR-017, #60, PR #61).** Issue a Boleta de Honorarios
  Electrónica (legally-binding). The `TMBECN_*` emission contract — **never captured before** — was
  **live-captured 2026-07-02** (a real boleta issued end-to-end, operator-driven headed Playwright)
  → `docs/sii-contract/bte.md` § Emisión. Clave-no-cert, **session-keyed** (emisor = principal).
  **New seam `PortalSession.requestForm`** (authenticated form-POST, the peer of `requestPublic.form`).
  Facade `portal/bte-emit.ts` (in-house `xml_values`/`formatMiles` parsers, cited `observed
  2026-07-02`) — `previewBteEmision` (steps 1–3, NO issue) + `emitBteEmision` (step 4, returns
  `cod_barras`/folio + PDF) + optional email. `portal/bte-comunas.ts` (16 regiones/346 comunas from
  `GLB_comunas.js`). Retención is **server-side** (reads the vigente rate from the form — 15,25%
  2026; no hardcoded table). **CLI** `sii bte emit`: default = safe preview; real issue needs
  `--confirm <monto-total>` (double-entry of the gross total). **MCP**: `bte_emit_preview` (readOnly)
  + `bte_emit` — the **first `destructiveHint:true` tool** (requires `confirmar` + amount echo).
  Audit records the folio only (never receptor/monto/glosa); session-keyed guard reused; no retry.
  **Preview LIVE-VALIDATED** (both retención modes); it also caught two wire mismatches the fakes
  couldn't (the from-scratch step-2 body; double-quoted `xml_values`). **`/review-pr` APPROVE** — two
  findings fixed (envío `origen` SEPTIMO; a scoped "no autorizado" detector, not a false-positive
  alert scan). 253/253 green. The ISSUE step's live validation + the `0.3.0` tag are #62; `bte
  anular` is #63.

- [x] **Embeddable core → `@altumstack/sii-core@0.2.0` (ADR-016; PRs #55/#56/#57/#58/#59,
  issues #50–#54).** Driven by the first EXTERNAL consumer (OCSI's `sii-cl` connector, which
  injects its own `PortalDriver` and had to stub playwright at bundle time). (1) **Pure main
  barrel** — `createNodeRuntime` moved to the new **`./node` subpath** (mirrors `./cli`); the
  `.` entry's static graph has no `node:*`/playwright; `sideEffects:false`. (2)
  **`createNodeRuntime(overrides?: Partial<Runtime>)`** + the concrete Node adapters exported
  from `./node` — partial seam reuse is now a supported path. (3) **playwright = OPTIONAL peer**
  (devDep in core for typecheck + workspace realpath resolution; cli/mcp declare it themselves),
  lazy-loaded by the default driver with an actionable install error; verified with a real npm
  consumer WITHOUT playwright (barrel import ✓, overrides ✓, no auto-install ✓, no stale
  `dist/runtime.*` ✓ — `prepack` now rebuilds dist from scratch; `tsc -b --clean` left orphans).
  (4) **CI boundary guard → allowlist** (`/node` both surfaces; `/cli` only from packages/cli —
  ADR-006 tightened: MCP can no longer import `consoleLogin`). (5) **f29Overview owns the range
  policy** (`{desde?,hasta?,anio?}` via the Clock seam) — fixes the MCP `f29_overview` no-args
  crash (sent empty strings → cryptic ValidationError); CLI/MCP now share ONE semantics. (6)
  **Shared es-CL format helpers** (`formatMoney`/`formatRut` in a new `format` module +
  `describeOperating` in identity) — the copy-pasted surface helpers deleted, output
  byte-identical. (7) **Splits**: `portal/f22.ts` (457) → `portal/f22/` per-view modules
  (same-name barrel); `program.test.ts` (720) / `server.test.ts` (595) → per-command/per-tool
  suites + `test-helpers` (excluded from dist). Test counts preserved exactly. 234/234 green.
  **Post-merge:** push tag `v0.2.0` → CD publishes; OCSI can then drop its playwright esbuild
  stub + `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` on upgrade.
- [x] **`@altumstack/sii-core@0.1.0` PUBLISHED to GitHub Packages (ADR-015, PR #47) + repo
  governance (PR #48).** The shared core is now a private, installable package for an external
  (internal) project. **Rename** `@sii/core` → `@altumstack/sii-core` repo-wide (cli/mcp imports +
  `workspace:*` keys, core src comments, the `ci.yml` ADR-003 boundary guard, all docs/ADRs;
  `@sii/cli`/`@sii/mcp` untouched — not published). **Publishable** `packages/core`: version 0.1.0,
  drop `private`, `license:UNLICENSED`, `repository`+`directory`, `publishConfig`→npm.pkg.github.com,
  `files:[dist,CHANGELOG.md]`, `prepack:tsc -b`; new LICENSE (proprietary) + CHANGELOG + README
  (consumer how-to: `.npmrc` + `read:packages` token, task-layer + `createNodeRuntime` usage, fake
  seams). **CD on a `v*` tag** (`.github/workflows/publish-core.yml`): build → verify tag==version →
  `pnpm publish` with `GITHUB_TOKEN` (`packages:write`, no PAT) — the user chose CD-on-tag over the
  ADR's original "manual" text (ADR-015 updated to match). **First release shipped:** tag `v0.1.0`
  pushed → Action green → `sii-core@0.1.0` live, **private** (inherits repo visibility), 1 version.
  222/222 green. **GitHub verified:** repo private, Actions enabled, per-workflow `packages:write`
  elevates without loosening the org default. **`main` branch protection (PR #48):** require PR +
  1 approval **from a code owner** (CODEOWNERS `* @albertomarturelo` = the sole admin) + **CI green
  required** (`Build + Lint + Format + Test` · `Validate context …`); admins bypass
  (`enforce_admins:false` — a single classic-protection toggle, so admins bypass CI too);
  force-push/deletion of `main` blocked; **auto-delete head branch on merge** enabled. Stale merged
  branches pruned (6).
- [x] **BTE/BHE read surface — boletas de honorarios (#20) — MERGED (PR #46) + live-validated.**
  `sii bte list <periodo> [--recibidas|--emitidas]` + MCP `bte_list` → one month's boletas de
  honorarios for the session principal. **First inline-JS-map facade:** the legacy
  `loa.sii.cl/cgi_IMT/` CGIs serve an HTML skeleton filled client-side from global JS maps
  (`xml_values` meta + `arr_informe_mensual` rows), so `portal/bte.ts` reads them via
  **`PortalSession.goto`/`evaluate`** (NOT `requestJson`) — paginated + paced (`Clock.sleep`),
  curated `BteBoleta`, **NO `raw`**. **No new seam** (goto/evaluate already existed).
  **Session-keyed (ADR-005)** — rejects a representing operate pointer up front, no `--rut`.
  **PII — no `raw` (live BUG-1):** the boleta row mixes counterparty data with the taxpayer's OWN
  identity on BOTH sides (emitidas `usuemisor` = self emitter, recibidas `nombre_receptor` = self
  receptor) + a counterparty email; a per-field denylist isn't provably complete, so BTE drops
  `raw` entirely (joins F22/F29). Found by **live MCP testing** (3 RUTs: persona / empresa / a
  worker who emitted to the empresa) — `raw` had leaked the principal's full name. **Phase-1 spike
  (live 2026-06-30):** confirmed the `.sii.cl` cookie SSO-carries to `loa.sii.cl` from a headless
  `restore`+`goto`, the inline maps read through `evaluate`, and the shapes match the ported Python
  contract (+ new keys). Reach (spike #15 for BHE) = session-keyed, re-confirmed. es-CL monto
  parsing; `S`/`N`→`ANUL`/`VIG`. **Live-validated emitidas + recibidas** (3 RUTs). Wire contract
  `sii-contract/bte.md`; CONVENTIONS bullets (inline-JS-map facades + prefer-drop-`raw`-over-
  denylist). 222/222 green. **Spike #15 fully resolved** (RCV body-RUT; F22/F29/BHE session-keyed).
- [x] **DTE authorized — public read surface (#21) — MERGED (PR #45).** The FIRST
  public, login-free SII surface: `sii dte authorized <rut>` + MCP `dte_authorized` query the
  palena CGI (`ee_empresa_rut`) for the DTE types a RUT is authorized to emit — **no session**,
  any RUT (counterparties incl.). Curated `DteAutorizados` (razón social, resolución,
  authorized-docs grid with `DD-MM-YYYY` dates) **+ no `raw`** (the HTML carries exactly the
  curated fields); a non-emisor RUT is a clean negative (`autorizado:false` + SII's verbatim
  message), never an error. **New seam `PortalDriver.requestPublic` (ADR-014)** — the
  unauthenticated text-HTTP primitive (Node `fetch`, charset-aware decode for the ISO-8859-1
  report; fake mirrors it), since the consulta is **session-less + HTML** (the existing
  `requestJson` is auth-bound + JSON-only, treats non-JSON as a login wall). `tasks/dte.ts`
  `dteAuthorized` does **NOT** use `withSession`; Mod-11-validates locally; audited
  `rut=<subject>` with **no `rutAuth`** (no authenticated principal). In-house HTML table parser
  (stdlib regex, no third-party lib — ADR-004). Wire contract **ported** from the Python sii-cli
  (cited; `docs/sii-contract/dte-authorized.md`), **not yet TS-live-revalidated**. 18 new tests
  vs fakes (no SII), 206/206 green; `tsc -b`/eslint/prettier clean.

- [x] **F29 Fase 1 read surface (#18, PR #43) — MERGED + live-validated.** Session-keyed,
  robust SDI-JSON (no GWT-RPC). The initial 1:1 port (propuesta + estado-metadata) was rejected
  for not showing the IVA **balance across months**; redesigned (ADR-013) into three verbs:
  `f29 formulario <periodo>` (the IVA **propuesta** labeled + grouped, `fuente:"propuesta"`),
  `f29 overview <desde> <hasta>`/`<año>` (**per-month** position across a date range: estado/folio
  + the declared **`total`** = "lo que pagué"; paced, ≤36 meses), `f29 status <periodo>`. CLI + MCP
  (`f29_formulario`/`f29_overview`/`f29_status`), JSON-default. **157-código taxonomy**
  (`portal/f29-codigos.ts`, glosa+signo+grupo) observed from the form HTML (`rfiInternet/cargarHtml`);
  unobserved código → `otros` (anti-allowlist). Estado `monto` surfaced as `total` (own figure;
  never audited). **Session-keyed (ADR-005)**: no `--rut`, rejects a representing operate pointer
  up front — answers spike #15 for F29 (the body RUT of a represented empresa returns "no
  autorizado", Python live 2026-06-26). Post-redesign fixes from live MCP testing: `tienePropuesta`
  on an empty/all-zero propuesta; administrativos 90xx/91xx dropped from the formulario.
  **Live-validated 2026-06-29** (empresa session). **Review hygiene:** real folios/timestamps had
  slipped into a test fixture as "synthetic" — caught in `/review-pr`, scrubbed to synthetic AND
  purged from branch history (force-push). 188/188 green. Fase 2 (presented form via GWT-RPC) +
  the propuesta código glosas are deferred.

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
- [x] **CLI JSON output by default — ADR-012 (#35).** The CLI emits each command's `@altumstack/sii-core`
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
  append-only barrels, so parallel worktrees don't conflict). zod added to `@altumstack/sii-core`.
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
  `@altumstack/sii-core` tasks (thin, ADR-003): Tools `auth_login` (NO password arg —
  delegates to the browser flow, ADR-006), `auth_logout` (no args, #11),
  `auth_status` (`refresh`), `operate` (`rut`/`self`); Resources `sii://session`,
  `sii://operating`, `sii://operable`, `sii://config`.
  `buildServer(runtime)` is injectable; `main` serves over stdio (STDOUT = JSON-RPC,
  errors to STDERR). zod v4 validates tool inputs (the SDK derives the protocol JSON
  Schema). 5 tests via an in-memory MCP client against fakes (no SII); the built
  binary passes the `initialize` handshake. `consoleLogin` stays unreachable (it's
  in the CLI-only `@altumstack/sii-core/cli` subpath). Claude Desktop config repointed at the
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
  `@altumstack/sii-core` barrel (surfaces import only this).
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
  into `@altumstack/sii-core` tasks (ADR-003): `auth login|status [--refresh]|logout`,
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

1. **Operate reach (representación) spike (#15) — RESOLVED.** **RCV = body-RUT** (live
   2026-06-28: `--rut` reached a represented empresa's RCV). **F22 = session-keyed** (Python
   live 2026-06-27: body-RUT does NOT reach it → reads the principal, no `--rut`). **F29 =
   session-keyed** (Python live 2026-06-26: represented body RUT returns `Consulta RUT no esta
   autorizado`). **BHE = session-keyed** (Python live #62 + **TS-live re-confirmed 2026-06-30**,
   #20: `rut_arrastre` is keyed to the principal). All session-keyed surfaces wired off this:
   no `--rut`, reject a representing pointer up front. (F29 TS live-validation of the surface
   itself still pending, but the reach contract is settled.)
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
- **`main` branch protection: admins bypass CI too.** Classic branch protection's
  `enforce_admins` is a single toggle, so allowing admins to bypass the required
  approval (the user's choice) also lets them bypass the required CI checks. If CI must
  be inviolable even for admins, migrate to **repository rulesets** (per-actor bypass).
  Also: the CI checks are `strict:false` (a PR need not be up to date with `main` before
  merging) — flip to `strict:true` if that guarantee is wanted.
- GitHub Actions warns Node 20 is deprecated on runners (forced to Node 24). Non-blocking;
  bump `node-version: 24` in `ci.yml` + `publish-core.yml` when convenient.

## Next Priorities

1. **#18 F29 Fase 2 — presented form via GWT-RPC (own PR + ADR).** First a **headless PoC**:
   warm the `rfiInternet` 2-app chain + the `SdiAATokenService` handshake, intercept
   `findDeclaraciones`'s `<FormularioRfi>` XML, parse the código grid. If reliable, build
   `fuente:"presentada"` + a computed `resumen` (real totals 538/89/91), reusing the Fase-1
   taxonomy; encapsulate the GWT-RPC in the `PortalDriver` with "scraper roto" errors. Then flip
   the ROADMAP F29 row 🚧 → ✅.
2. **Live-revalidate the remaining ported contracts** — re-observe against a real session
   (operator-assisted): refresh `sii-contract/rcv.md` (RCV) and `sii-contract/dte-authorized.md`
   (the #21 DTE consulta was ported from sii-py, not yet TS-live-revalidated). **BHE is now done**
   — emitidas + recibidas both live-validated 2026-06-30 (3 RUTs). (F22 + BTE are live-validated;
   RCV + DTE are not.)
3. **`operate <alias>`** — alias targets now that the operable set has real empresas.

_(F22 surface is COMPLETE — status/overview #19, formulario #27/#37, observaciones #26,
historial #28, grouping fixes #41 — all shipped + live-validated.)_

See `docs/ROADMAP.md` for the full surface checklist.
