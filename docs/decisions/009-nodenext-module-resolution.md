# ADR-009: NodeNext module resolution for Node-runnable surface builds

## Status

Accepted — 2026-06-27.

## Context

The bootstrap toolchain (ADR-002) set `module: "ESNext"` +
`moduleResolution: "Bundler"` in `tsconfig.base.json`. With no bundler in the
stack, `tsc` emits **extensionless** relative imports (e.g.
`from './tasks/auth'`). Node's native ESM loader requires explicit `.js`
extensions, so the shipped artifacts cannot run under Node: `@sii/cli`'s `bin`
(`./dist/main.js`, executed directly via its shebang) and `@sii/mcp`'s stdio
server both fail with `ERR_MODULE_NOT_FOUND`. The vitest suite stayed green
because esbuild's resolver is more lenient than Node's, hiding the gap until the
first real binary run (surfaced wiring the CLI). This contradicts the core
contract in ARCHITECTURE/STACK: a Node library plus two **Node-executed**
surfaces, no bundler (an explicit non-goal).

## Decision

- Set `module: "NodeNext"` and `moduleResolution: "NodeNext"` in
  `tsconfig.base.json` (replacing `ESNext` / `Bundler`).
- All relative imports in source carry an explicit **`.js`** extension
  (TypeScript keeps them verbatim on emit), e.g. `from './tasks/auth.js'`,
  `export * from './errors/index.js'`. Package (bare) specifiers like
  `@altumstack/sii-core` and `commander` stay extensionless.
- No bundler and no new dependency. `tsc -b` output is the runnable artifact;
  `node packages/cli/dist/main.js …` works directly.

This is enforced at compile time: NodeNext makes `tsc` error on a missing
extension, so the bug class cannot silently return — consistent with the
zero-error strict gate (ADR-002).

## Alternatives Considered

1. **Add a bundler (`tsup`/esbuild).** Rejected — adds a dev dependency + per-
   surface build config to keep `Bundler` resolution honest, for no benefit at
   this scale; bundling a CLI and a stdio MCP server is unnecessary ceremony and
   widens the toolchain against the STACK "infrastructure-only, minimal" posture.
2. **Manual `.js` extensions, keep `moduleResolution: "Bundler"`.** Rejected —
   smallest diff but unenforced: a future extensionless import compiles and
   passes tests yet crashes the shipped binary. Fragile; defeats the strict gate.
3. **Keep `Bundler` + run sources via a TS loader (tsx) instead of compiling.**
   Rejected — shifts a runtime dependency onto every install and abandons the
   plain `dist/*.js` artifact the `bin` contract expects.

## Consequences

- Easier: artifacts run on Node with zero extra tooling; the "two Node surfaces"
  contract actually holds; forgetting an extension is a compile error, not a
  latent prod break.
- Obligation: every relative import — existing and new — must end in `.js`.
  One-time mechanical migration across `@altumstack/sii-core` + `@sii/cli`; new code follows
  the convention (recorded in CONVENTIONS.md). Editor/test tooling already
  resolves NodeNext, so no fixture churn.
