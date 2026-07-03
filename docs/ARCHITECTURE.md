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

3. **Production-only.** SII hostnames are constants in `@albertomarturelo/sii-core` config;
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
│   ├── core/  (@albertomarturelo/sii-core)    # All domain logic. A Node library. Thin surfaces call its tasks.
│   ├── cli/   (@albertomarturelo/sii-cli)     # Human CLI (terminal). Also what Claude Code drives via Bash.
│   └── mcp/   (@albertomarturelo/sii-mcp)     # MCP stdio server. The integration point for Claude Code AND Claude Desktop.
├── docs/                     # CFD context layer (this file lives here)
└── .claude/commands/         # CFD slash commands
```

- **`@albertomarturelo/sii-cli`** — the human terminal surface. Claude Code can also invoke it
  directly through its Bash tool, so the CLI doubles as an AI-usable surface
  inside Claude Code.
- **`@albertomarturelo/sii-mcp`** — a stdio MCP server. Both **Claude Desktop** (via
  `claude_desktop_config.json`) and **Claude Code** (via `.mcp.json` /
  `claude mcp add`) consume stdio MCP servers, so this one package makes the
  same operations available to AI assistants in both clients. The Clave never
  reaches the model — login delegates to a browser flow (ADR-006).

Both surfaces are thin: each command / tool is a call into a `@albertomarturelo/sii-core` task.
Neither reaches past the task layer into a portal/DTE facade — that is where the
throttling, audit, and credential rails live (ADR-003).

## The core — a Node library with injectable seams

`@albertomarturelo/sii-core` is a normal Node library: it MAY use Node APIs (fs, keyring,
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

## Planned `@albertomarturelo/sii-core` module map (none implemented yet)

| Module | Purpose | Status |
| --- | --- | --- |
| `rut` | RUT parse / canonicalise / Mod-11 DV (in-house) | Done |
| `periodo` | Tax-time primitives: `Periodo` (YYYYMM, monthly — rcv/f29) + `Anio` (YYYY, año tributario — f22/renta), in-house, mirror `rut` | Done |
| `config` | Prod hostname constants + rate limits (single source of truth) | Done |
| `seams` | `PortalDriver` / `SecretStore` / `KeyValueStore` / `AuditSink` / `Clock` (now + `sleep`, the pacing primitive) interfaces + Node defaults. `PortalSession` includes `requestJson`/`cookie` — the authenticated SPA-JSON-facade primitive (www4 SDI endpoints). `PortalDriver.requestPublic` — the UNAUTHENTICATED text-HTTP primitive (no session/browser) behind public login-free consultas (palena DTE), Node `fetch` default (ADR-014) | Done |
| `auth` | Session lifecycle: browser cookies-only login, logout, status; only login mints. `withSession` is the consume-path — domain tasks acquire a live `PortalSession` (+ resolved operating RUT) through it; it never mints, raises `NotAuthenticated` when none | login/logout/status + `withSession` + `whoami` (own razón social/nombre + email) done; rest planned |
| `identity` | Operate-centric model: operating RUT, operable set | Planned |
| `portal/*` | Portal surfaces as typed facades over `PortalSession.requestJson`. Envelope parsed with zod (ADR-011), per-row curated projection alias-tolerant + `raw` (ADR-004) — except F22/F29, which drop raw (their non-curated data is PII). `representacion` + `rcv` (body-RUT) + `f22` (session-keyed, consultaestadof22ui) + `f29` (session-keyed, propuestaf29ui) landed. Two exceptions to the SDI-JSON shape: `dte-public` (PUBLIC, session-less HTML facade over `PortalDriver.requestPublic` — palena CGI, in-house table parser, no `raw`, ADR-014) and `bte` (session-keyed, reads the legacy `loa.sii.cl` CGIs' inline JS maps via `PortalSession.goto`/`evaluate` — NOT `requestJson` — curated, NO `raw`: the row mixes counterparty data with own-identity PII on both sides, so it joins F22/F29's no-raw camp, live BUG-1) | representación + rcv + f22 + f29 + dte-public + bte done; rest planned |
| `tasks/*` | High-level operations the surfaces call. Domain reads wrap a facade in `withSession` + one audit receipt (auth, operate, rcv, f22, f29, bte done; profile, iva, renta planned) — except `dteAuthorized` (public): NO `withSession`, still audited (ADR-014) | auth/operate/rcv/f22/f29/dte/bte done; rest planned |
| `audit` | Append-only JSONL receipt (secret keys dropped) | Planned |
| `dte` | In-house DTE XML + signing + SOAP | Future |

## Why this split

The guardrails (throttling, audit log, credential handling, the operate-centric
auth model) live in `@albertomarturelo/sii-core` and apply uniformly whether a human typed a CLI
command, Claude Code ran the CLI via Bash, or an assistant invoked an MCP tool.
A surface that reaches past the task layer loses those rails.

## Data flow

```text
human (CLI) / Claude Code (CLI via Bash, or MCP) / Claude Desktop (MCP)
        │
        ▼
  surface package  ──▶  @albertomarturelo/sii-core tasks  ──▶  @albertomarturelo/sii-core {auth, identity, portal, dte}
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
