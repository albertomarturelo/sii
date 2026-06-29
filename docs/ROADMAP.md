# Roadmap — sii (TypeScript)

The single source of truth for "are we there yet?". Every user-facing surface
(CLI verb + MCP tool) gets a row here; tick it ✅ when the work merges. Nothing
is implemented yet — this repo is at the CFD scaffolding stage.

## Where we're going

One `@sii/core` engine, two surfaces:

- **`@sii/cli`** — the terminal surface (and what Claude Code drives via Bash).
- **`@sii/mcp`** — a stdio MCP server, the integration point for **Claude Code**
  AND **Claude Desktop** (both connect to stdio MCP servers).

Together they cover the day-to-day a Chilean contador or single taxpayer
performs against SII: authenticate, read identity + contributor data, query the
RCV, prepare and read F29 / F22, read BHE/DTE, and pull composite summaries —
with a **single-account, operate-centric** identity model (ADR-005).

**Non-goals:** multi-tenant SaaS; custodying a third party's Clave; the cert
sandbox; any code on third-party SII libraries (ADR-004); an embedded plugin
(dropped — CLI + MCP only).

## Status legend

| | Meaning |
|---|---|
| ✅ | Shipped, tested + live-validated | 🚧 | In progress | 📋 | Planned (issue exists) | 💭 | Spike pending | 🔒 | Blocked | ❓ | Conditional |

## Foundations (must land before feature surfaces)

| Status | Item | Notes | ADR |
|---|---|---|---|
| ✅ | CFD scaffolding | docs, ADRs, slash commands, CI validate-context | ADR-001 |
| ✅ | Monorepo skeleton | pnpm workspaces + TS project references; core + cli + mcp stubs | ADR-002 |
| ✅ | Install + build green | `pnpm install` + `tsc -b` (strict) + eslint + prettier + 39 vitest tests, all green | ADR-002 |
| ✅ | NodeNext build | `module`/`moduleResolution` → NodeNext; `.js` on relative imports; `tsc -b` output runs directly on Node (no bundler), verified via the built `sii` binary | ADR-009 |
| ✅ | Seams spine | `PortalDriver` / `SecretStore` / `KeyValueStore` / `AuditSink` / `Clock` interfaces + Node defaults + in-memory fakes | ADR-003 |
| ✅ | `rut` + `config` + `audit` | Pure-core modules: Mod-11 RUT, prod hostnames, secret-dropping audit | ADR-004 |
| 🚧 | auth + identity base | core logic + Playwright driver + CLI surface landed & tested; **CLI real-SII validated (#5)** — login/status/--refresh/logout; MCP next | ADR-005, ADR-006 |
| ✅ | Node Playwright `PortalDriver` | Headed login / headless cookies-only restore wired into `createNodeRuntime`; **real-SII login validated (#5)** — landed on Mi-SII off `zeusr.sii.cl`, cookies-only restore + `DatosCntrNow` read confirmed | ADR-006, ADR-008 |
| 💭 | Operate reach (representación) | Spike: does a persona's operate reach F29/F22/BHE, or only RCV? Decides the identity contract | ADR-005 |
| ✅ | Operable fetch | `getDcvEmpresasAutorizadas` wired into login (best-effort → `[self]` on failure) + `PortalSession.requestJson` seam. **Live-validated 2026-06-28** (real session → 1 empresa + self; the `.sii.cl` cookie covers www4, no SPA nav). | ADR-005 |

## Identity & auth (the operate-centric center — ADR-005)

| Status | CLI | MCP | Spec |
|---|---|---|---|
| 🚧 | `sii auth login` (browser) / `--console` | `auth_login` (no password arg) | **CLI real-SII validated (#5)**; **MCP tool built + tested** (no password arg; delegates to the browser flow). **`--console`** (ADR-010): RUT + hidden Clave in the terminal → headless form-fill → same cookies-only session, Clave never stored. CLI-only. Headed login persists `~/.sii/session.json` (0600, no secret). |
| 🚧 | `sii auth status [--refresh]` | `auth_status` / Resource `sii://session` | **CLI real-SII validated (#5)**; **MCP tool + resource built + tested**. Local read (who am I, operating-as); `refresh=true` reads `DatosCntrNow` live. |
| ✅ | `sii auth logout` | `auth_logout` | **Real-SII validated (#5)**: server-side close (best-effort, redirect off `autTermino.cgi`) + local wipe. **MCP tool built + tested** (#11) — no secret, so MCP-eligible (ADR-006); no input args. Switching accounts = logout→login. |
| 🚧 | `sii operate <rut\|alias>` / `--self` / `--list` | `operate` (`rut`/`self`/`list`) / Resources `sii://operating`, `sii://operable` | CLI built + tested incl. **`--list`** (operable set with self/current markers); **MCP `operate` tool incl. `list=true` (#23)** + `sii://operable` resource. Validated against the operable set; always visible. Alias TBD. |
| 📋 | `sii profile` | `profile` | Full contributor snapshot INCLUDING PII (opt-in name; states exposure). |

## Read surfaces

| Status | CLI | MCP | Spec |
|---|---|---|---|
| 🚧 | `sii rcv summary` / `list` (`match` 📋) | `rcv_summary` / `rcv_list` | **Built + tested (#17)** — the domain-read template: `getResumen` aggregates + `getDetalle` rows, `withSession` + body-RUT (`--rut`/operate), curated+`raw`. Wire contract ported (cited), **not yet live-revalidated from TS**. `match` (folio reconciliation) deferred. |
| 📋 | `sii f29 draft` / `status` (#18) | `f29_*` | Read the IVA propuesta + the presented F29. Session-keyed (login as the empresa); blocked on spike #15 + RCV template. |
| 🚧 | `sii f22 status [año]` | `f22_status` | **Built + tested (#19)** — the session-keyed template: `buscaDeclVgte` (decls+estado) → `f22Compacto` (código grid). No año → multi-year overview; with año → detail. **Session-keyed** (no `--rut`; reads the principal — spike #15 answered: body-RUT does NOT reach it). PII-safe (header códigos + raw dropped). Ported (cited), **not yet live-revalidated from TS**. |
| 📋 | `sii f22 status <año> --full` (#27) | `f22_status` (`full`) | **Richer readback** — extend #19's curated grid (`f22Compacto`) to the full form (`f22Completo`), grouped into the lines a contador reads: **ingresos** (base imponible / rentas), **retenciones · PPM · créditos**, and **resultado** (impuesto a pagar / devolución / giro), sign-preserving. PII-safe (header códigos still dropped, no `raw`). Needs the `f22Completo` wire ported + first-hand-observed (ADR-004). |
| ✅ | `sii f22 observaciones <año> [--folio]` (#26) | `f22_observaciones` | **Built + live-validated (#26, 2026-06-29)** — `situacionObservacion(periodo,rut,dv,folio)` → `[{codigo,descripcion,url}]`: the observación códigos (B102, G37…) + glosa + SII ayuda URL. Endpoint located first-hand via a live spike (no Python equivalent), cited in `sii-contract/f22.md`. Folio resolved from `buscaDeclVgte` (vigente) or `--folio`. **Session-keyed** (no `--rut`). PII-safe: rows are non-PII (no header-código exclusion, no `raw`). |
| 💭 | `sii f22 historial <año>` (#28) | `f22_historial` | **Historial / eventos** — the per-year event timeline every estado glosa points to ("sección Historial"): devoluciones, rectificatorias, giros, fechas. New SDI facade → spike + contract. Session-keyed; lower priority than `observaciones`. |
| 📋 | `sii bte list` (#20) | `bte_list` | Read BHE recibidas/emitidas. Session-keyed; blocked on spike #15 + RCV template. |
| 📋 | `sii dte authorized` (#21) | `dte_authorized` | Public consulta of authorized DTE types (no login); reuses the RCV registration pattern only (no `withSession`/spike). |
| 📋 | `sii iva` / `sii renta` | `iva` / `renta` | Composite contador summaries derived from the surfaces above. |

## Write surfaces (each needs its own ADR for legal weight)

| Status | Surface | Notes |
|---|---|---|
| 🔒 | `f29 submit` / `f22 submit` | File monthly/annual returns. |
| 🔒 | `bte emit` / `dte emit` / `dte accept` | Issue boletas / DTEs; DTE accept per Ley 19.983. DTE emit also blocked on the cert auth layer. |

## MCP-specific structure (best practices — ADR-003)

The MCP server is the surface that lands the project in Claude Code and Claude
Desktop, so structure it to the spec. The stdio server is built
(`@sii/mcp`, `buildServer(runtime)` + stdio `main`), tested with an in-memory
client (no SII), and binary-smoke-validated (`initialize` handshake):

- **Resources** (read-only context): ✅ `sii://session`, `sii://operating`,
  `sii://operable`, `sii://config`. NOT tools — the model reads them to orient.
- **Tools** (actions): ✅ `auth_login` (no password — delegates to the browser
  flow), `auth_logout` (no args — best-effort server close + local wipe),
  `auth_status` (`refresh`), `operate` (`rut`/`self`/`list`); read surfaces
  `rcv_summary` / `rcv_list` (body-RUT) + `f22_status` (`anio`/`folio`/`years`,
  session-keyed), all `readOnlyHint`. Each is a
  thin call into a `@sii/core` task; future writes get `destructiveHint`.
  `auth_logout` is MCP-eligible because it carries no secret (ADR-006). New modules
  register their tools via `tools/<mod>.ts` (`register<Mod>Tools`) — append-only.
- **Prompts** (workflow templates): 📋 "revisar IVA del mes", "preparar renta",
  "conciliar folio" — deferred until the read surfaces they orchestrate land.

## How to keep this current

Tick rows ✅ on merge; add issue links when a 📋 row gets an issue; update the
ADR column when a decision gates/unblocks a row; resolve spikes (💭 → ADOPT adds
rows / REJECT strikes them). Do NOT list internal core modules here — those live
in `docs/ARCHITECTURE.md`.
