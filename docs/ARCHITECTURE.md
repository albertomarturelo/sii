# Architecture Overview

## The non-negotiable reality of SII

This shapes every architectural decision — internalize before writing code.
(Ported from the Python `sii-cli`; first-hand-observed, not assumed.)

1. **There is no unified API.** Only **DTE (facturación electrónica)** has
   official SOAP web services. Everything else — F29, F22, Boletas de
   Honorarios (BHE), Registro de Compras y Ventas (RCV), carpeta tributaria,
   situación tributaria, consulta RUT — must be driven through the taxpayer
   portal as a logged-in session. The portal is the source of truth; any
   "endpoint" found in browser devtools is internal and may change without
   notice.

2. **Three auth mechanisms, used in different places — do not conflate:**
   - **Certificado digital (.pfx/.p12)** — required for DTE SOAP services.
     Out of scope until the DTE write layer.
   - **RUT + Clave Tributaria** — login at `zeusr.sii.cl`. Everything-not-DTE
     rides this session. Account locks after repeated failed attempts — never
     retry blindly.
   - **Clave Única (gob.cl)** — federated OAuth/OpenID. Future.

3. **Production-only.** SII hostnames are constants in `@sii/core` config;
   never hard-code one elsewhere. No `SII_ENV` switch (sii-py ADR-016).

4. **Session-keyed vs body-RUT surfaces.** Some facades authorize by the body's
   RUT (RCV) — a persona can read a represented empresa's data under their own
   session. Others authorize by the SESSION PRINCIPAL (F29, BHE, and — to be
   confirmed — F22): a representing persona is rejected for those and must log
   in AS the empresa. Load-bearing for the identity model (ADR-005); F22/F29
   reach is an open observation item (see CURRENT_STATUS).

## Two surfaces, one core — and where Claude plugs in

```text
sii-new/                      # pnpm workspaces, TypeScript project references
├── packages/
│   ├── core/  (@sii/core)    # All domain logic. A Node library. Thin surfaces call its tasks.
│   ├── cli/   (@sii/cli)     # Human CLI (terminal). Also what Claude Code drives via Bash.
│   └── mcp/   (@sii/mcp)     # MCP stdio server. The integration point for Claude Code AND Claude Desktop.
├── docs/                     # CFD context layer (this file lives here)
└── .claude/commands/         # CFD slash commands
```

- **`@sii/cli`** — the human terminal surface. Claude Code can also invoke it
  directly through its Bash tool, so the CLI doubles as an AI-usable surface
  inside Claude Code.
- **`@sii/mcp`** — a stdio MCP server. Both **Claude Desktop** (via
  `claude_desktop_config.json`) and **Claude Code** (via `.mcp.json` /
  `claude mcp add`) consume stdio MCP servers, so this one package makes the
  same operations available to AI assistants in both clients. The Clave never
  reaches the model — login delegates to a browser flow (ADR-006).

Both surfaces are thin: each command / tool is a call into a `@sii/core` task.
Neither reaches past the task layer into a portal/DTE facade — that is where the
throttling, audit, and credential rails live (ADR-003).

## The core — a Node library with injectable seams

`@sii/core` is a normal Node library: it MAY use Node APIs (fs, keyring,
Playwright). It does NOT need to be runtime-agnostic — both surfaces run on
Node (the embedded-plugin idea was dropped). What it DOES keep is a small set of
**injectable seams** so unit tests never touch the real SII, the real keyring,
or the wall clock:

- `PortalDriver` — navigate the JS-heavy portal / issue HTTP (default: a
  Playwright adapter; tests inject a fake).
- `SecretStore` — read/write the Clave or cookies-only session secrets (default:
  OS keyring).
- `SessionStore` — persist + load cookies-only sessions (default: fs under
  `~/.sii/`).
- `AuditSink` — append the JSONL receipt (default: fs append).
- `Clock` — time, for testable/resumable flows.

The core ships default Node implementations of these and exposes a composition
helper; a surface can override any seam (mainly tests do). This is dependency
injection where it pays — testing + centralizing the guardrails — not full
hexagonal ceremony (ADR-003).

## Planned `@sii/core` module map (none implemented yet)

| Module | Purpose | Status |
| --- | --- | --- |
| `rut` | RUT parse / canonicalise / Mod-11 DV (in-house) | Done |
| `periodo` | Tax-time primitives: `Periodo` (YYYYMM, monthly — rcv/f29) + `Anio` (YYYY, año tributario — f22/renta), in-house, mirror `rut` | Done |
| `config` | Prod hostname constants + rate limits (single source of truth) | Done |
| `seams` | `PortalDriver` / `SecretStore` / `KeyValueStore` / `AuditSink` / `Clock` (now + `sleep`, the pacing primitive) interfaces + Node defaults. `PortalSession` includes `requestJson`/`cookie` — the authenticated SPA-JSON-facade primitive (www4 SDI endpoints) | Done |
| `auth` | Session lifecycle: browser cookies-only login, logout, status; only login mints. `withSession` is the consume-path — domain tasks acquire a live `PortalSession` (+ resolved operating RUT) through it; it never mints, raises `NotAuthenticated` when none | login/logout/status + `withSession` done; rest planned |
| `identity` | Operate-centric model: operating RUT, operable set | Planned |
| `portal/*` | Portal surfaces as typed facades over `PortalSession.requestJson`. Envelope parsed with zod (ADR-011), per-row curated projection alias-tolerant + `raw` (ADR-004) — except F22, which drops raw (its non-curated data is pure PII). `representacion` + `rcv` (body-RUT) + `f22` (session-keyed, consultaestadof22ui) landed; f29, bte, dte-public next | representación + rcv + f22 done; rest planned |
| `tasks/*` | High-level operations the surfaces call. Domain reads wrap a facade in `withSession` + one audit receipt (auth, operate, rcv, f22 done; profile, f29, bte, iva, renta planned) | auth/operate/rcv/f22 done; rest planned |
| `audit` | Append-only JSONL receipt (secret keys dropped) | Planned |
| `dte` | In-house DTE XML + signing + SOAP | Future |

## Why this split

The guardrails (throttling, audit log, credential handling, the operate-centric
auth model) live in `@sii/core` and apply uniformly whether a human typed a CLI
command, Claude Code ran the CLI via Bash, or an assistant invoked an MCP tool.
A surface that reaches past the task layer loses those rails.

## Data flow

```text
human (CLI) / Claude Code (CLI via Bash, or MCP) / Claude Desktop (MCP)
        │
        ▼
  surface package  ──▶  @sii/core tasks  ──▶  @sii/core {auth, identity, portal, dte}
        │ (wires seams)                              │ (via seams)
        └──────────────▶ default / injected adapters ◀┘
                                │
                                ▼
                          SII portal / SOAP   +   AuditSink (receipt)
```

## External dependencies

Infrastructure libraries only — NO SII-specific third-party code (ADR-004).
See `docs/STACK.md` for the chosen libraries (MCP TS SDK, Playwright, a CLI
framework, vitest) and their roles.
