# ADR-002: TypeScript + Node + pnpm-workspaces monorepo toolchain

## Status

Accepted — 2026-06-27

## Context

The project must ship two surfaces — a CLI and an MCP server — over one shared
SII engine, both usable from Claude Code and (the MCP server) from Claude
Desktop. That demands a monorepo with a single core package consumed by both,
strong typing at the core's contract boundary (the Python project relied on
`mypy --strict`), and a build that wires the core into each surface without
publish-and-reinstall churn.

## Decision

- **Language: TypeScript**, `strict` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedLocals/Parameters`.
  This is the `mypy --strict` equivalent and is a zero-error CI gate. ESM only.
- **Runtime: Node.js `>=20`** for both surfaces (CLI + MCP). `@altumstack/sii-core` is a
  Node library; external dependencies sit behind injectable seams (ADR-003).
- **Package manager: pnpm `9.x` workspaces.** Packages live under `packages/*`
  (`@altumstack/sii-core`, `@sii/cli`, `@sii/mcp`); cross-package deps use `workspace:*`.
- **Build: TypeScript project references** (`tsc -b`) — a root solution
  `tsconfig.json` references each package; each package `extends`
  `tsconfig.base.json` and emits to `dist/`. `composite: true` enables
  incremental, reference-aware builds.
- **Dev tooling:** vitest (tests), ESLint flat config + typescript-eslint
  (lint), Prettier (format). Versions tracked in `docs/STACK.md`.

## Alternatives Considered

1. **Plain JavaScript + JSDoc.** Rejected — a core consumed by three surfaces
   needs enforced types at its boundary; JSDoc gives weaker guarantees and no
   strict gate.
2. **Bun (runtime + workspaces + bundler + test in one).** Rejected for now —
   faster and simpler, but less battle-tested with Playwright and parts of the
   MCP ecosystem we depend on. Revisit if Node friction grows.
3. **Nx / Turborepo.** Rejected for now — build orchestration/caching is
   overkill at four packages; pnpm workspaces + `tsc -b` references suffice.
   Reconsider if the package count or build time grows.
4. **Polyrepo (separate repos per surface).** Rejected — the core's contract
   would drift across repos and every change would need cross-repo version
   dances; a monorepo keeps the core and its consumers in lockstep.

## Consequences

- Easier: one `pnpm build` typechecks + builds the whole graph; the core's
  types propagate to all surfaces instantly; one place to run tests/lint.
- Obligation: keep the project-reference graph correct (each surface references
  `../core`); keep the strict gate at zero; pin dep versions on first install
  and cite them in `STACK.md`.
- Risk: project-reference drift (a surface forgetting to reference `../core`)
  surfaces as a build error, not a silent runtime failure — keep `tsc -b` green
  in CI.
