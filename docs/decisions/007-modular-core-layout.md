# ADR-007: Modular core layout + worktree-parallel boundaries

## Status

Accepted — 2026-06-27. Builds on ADR-003 (shared core + seams).

## Context

The plan is to land a robust `auth` (login/logout) + `identity` (operate) base
first, then build the remaining domain modules (rcv, f29, f22, bte, dte) IN
PARALLEL using git worktrees. Parallel branches that edit the same files conflict
at merge. We need a layout where adding a module touches mostly NEW files, the
shared spine is small + stable, and dependencies never cycle.

## Decision

`@sii/core/src/` is organized by concern, with a strict downward dependency rule:

```text
config/    rut/    errors/      ← leaves: pure, zero deps, everyone may import
seams/                          ← interfaces (Clock, AuditSink, KeyValueStore, SecretStore, PortalDriver)
adapters/{node,fake}/           ← seam implementations (node defaults + in-memory fakes)
audit/                          ← uses AuditSink
auth/    identity/              ← domain: depend on leaves + seams, NEVER on each other's internals or on tasks/
portal/<surface>/               ← future domain modules, one dir each
tasks/                          ← PUBLIC API the surfaces call; composes domain modules
runtime.ts                      ← composition root (createNodeRuntime wires node adapters)
index.ts                        ← re-exports tasks + seam interfaces + runtime
```

Rules that make modules not collide:

- **Downward-only deps, no cycles:** `config`/`rut`/`errors`/`seams` are leaves;
  `audit`/`auth`/`identity`/`portal/*` depend on leaves + seams; `tasks` composes
  domain modules. A domain module NEVER imports another domain module's internals
  — cross-module composition happens ONLY in `tasks/`.
- **One directory per module; one task file per module** (`tasks/<module>.ts`).
  Adding a surface (e.g. rcv) = NEW files: `portal/rcv/*`, `tasks/rcv.ts`,
  `cli/src/commands/rcv.ts`, `mcp/src/tools/rcv.ts`. It does NOT edit `auth`/
  `identity`/another portal module.
- **Per-module local state uses DISTINCT `KeyValueStore` keys** (`auth` →
  `session`, `identity` → `operate`), so two modules never write the same file.
- **The only shared edit when adding a module** is appending one re-export line
  to a barrel/registry (`tasks/index.ts`, the CLI command registry, the MCP tool
  registry). Barrels are append-only lists → trivial, low-conflict merges. When
  even that friction matters, a module self-registers instead of being listed.
- **Surfaces register module command files via a small registry**, never a
  giant switch — so two worktrees adding commands touch different files.

## Alternatives Considered

1. **Flat `src/` with everything mixed.** Rejected — every parallel branch edits
   the same files; constant merge conflicts; no enforceable dependency direction.
2. **A package per domain module (`@sii/rcv`, `@sii/f29`, …).** Rejected for now
   — heavy ceremony (a manifest + tsconfig + publish wiring per surface) for what
   a directory boundary already gives; revisit only if a module needs independent
   versioning.

## Consequences

- Easier: worktrees on different domain modules rarely touch the same file; the
  spine (leaves + seams + tasks contract) is the stable interface everyone builds
  against; the dependency rule is greppable (and CI already guards the surface →
  core-internals boundary).
- Obligation: keep the downward rule honest (no domain-to-domain imports; compose
  in `tasks/`); barrels stay append-only; new shared state takes a new
  `KeyValueStore` key, never an existing file.
- The `auth` + `identity` base must land + merge to `main` first, because it
  defines the seams + task contract the parallel modules depend on.
