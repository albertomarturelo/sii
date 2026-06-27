# ADR-003: Shared core consumed by CLI + MCP; injectable seams for external deps

## Status

Accepted — 2026-06-27. Supersedes its own first draft (which made the core
runtime-agnostic for an embedded plugin). The plugin was dropped this session;
the project is CLI + MCP only, both on Node, so the strong constraint is
unnecessary. Lineage: generalizes the dependency-injected credential/session
resolution the Python `sii-cli` used (its ADR-001 split, ADR-026 resolver).

## Context

The same SII operations must run behind a Node CLI and a Node MCP server (the
MCP server is what Claude Code and Claude Desktop connect to). Both are Node, so
the core does NOT need to avoid Node APIs. What we DO need: every legal /
operational guardrail (throttling, audit, credential handling, the
operate-centric auth model) applied uniformly across both surfaces, AND a way to
unit-test the core without hitting the real SII, the real OS keyring, or the
wall clock.

## Decision

- **One core package `@sii/core`** holds ALL domain logic and is a normal Node
  library (it may `import` `node:*`, `fs`, `playwright`, a keyring lib). The CLI
  and MCP packages are thin: each command / tool is a call into a `@sii/core`
  task. A surface NEVER reaches past the task layer into a portal / DTE / auth /
  storage facade — that bypasses the rails. (CI enforces this with a
  surface-boundary grep.)
- **Injectable seams for external, non-deterministic dependencies.** The core
  declares interfaces and ships DEFAULT Node implementations of each:
  - `PortalDriver` — navigate the JS-heavy portal / issue HTTP (default:
    Playwright).
  - `SecretStore` — read/write the Clave or cookies-only session secrets
    (default: OS keyring).
  - `SessionStore` — persist + load cookies-only sessions (default: fs under
    `~/.sii/`).
  - `AuditSink` — append the JSONL receipt (default: fs append).
  - `Clock` — time, for testable / resumable flows.
  Production wiring uses the defaults via a small composition helper; tests
  inject in-memory fakes so they never touch the real SII / keyring / clock.
- **The task layer is the single public API** of the core; surfaces import only
  it (plus the seam interfaces if they need to override a default).
- **This is dependency injection where it pays — testing + guardrail
  centralization — not full hexagonal architecture.** No mandate to abstract
  internal-only collaborators; only the external dependencies above get a seam.

## Alternatives Considered

1. **Runtime-agnostic core / no Node imports (the dropped first draft).**
   Rejected now — its sole justification was an embedded plugin that no longer
   exists; the ceremony buys nothing for two Node surfaces.
2. **No seams — core calls Node APIs directly everywhere.** Rejected — tests
   would then hit the real SII / keyring / clock, which the testing convention
   forbids; the seams are the cheapest way to keep tests hermetic.
3. **Let each surface reimplement tasks over a thin client.** Rejected — that is
   exactly how the guardrails get bypassed; "surfaces call tasks only" stays
   non-negotiable (lineage: sii-py ADR-001).

## Consequences

- Easier: the core is unit-testable with in-memory fakes; the same task runs
  identically in the CLI and the MCP server; no hexagonal boilerplate for
  internal code.
- Obligation: a CI surface-boundary check forbids CLI/MCP importing a core
  internal directly; every external/non-deterministic dependency gets a seam +
  a Node default + a fake; new capabilities decide explicitly whether they are a
  seam (external) or just core code (internal).
- If an embedded plugin (or a browser build) ever returns, the seams already
  isolate the Node-specific bits — re-introducing runtime-agnosticism would be a
  scoped change to which adapters are the defaults, not a core rewrite.
