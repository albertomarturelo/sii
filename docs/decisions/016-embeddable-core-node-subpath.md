# ADR-016: Embeddable core — pure main barrel, `./node` composition subpath, optional Playwright peer

## Status

Accepted — 2026-07-02. Builds on ADR-003 (injectable seams — the contract this makes
consumable without the default adapters), ADR-009 (NodeNext subpath exports, the `./cli`
precedent), ADR-015 (private publish; this REVISITS its alternative 4, which said
"reconsider a peer/optional playwright if a consumer only ever injects its own driver").

## Context

The first external consumer materialized (the OCSI desktop app's `sii-cl` connector,
`@altumstack/sii-core@0.1.0`) and it does exactly what ADR-015's alternative 4
anticipated: it injects its OWN `PortalDriver` (an Electron `BrowserWindow` port) and
never touches the default Playwright adapter. Two structural facts in 0.1.0 make that
consumption needlessly painful:

1. **The main barrel eagerly loads Node + Playwright.** `index.ts` re-exports
   `createNodeRuntime` from `runtime.ts`, which statically imports
   `adapters/node/index.ts` (`node:fs/os/path`) and `adapters/node/portal.ts`
   (`import { chromium } from 'playwright'`). `import { Rut } from '@altumstack/sii-core'`
   therefore evaluates Playwright at module-eval time, and `playwright` is a hard
   `dependency` — OCSI must stub the module at bundle time
   (`esbuild-stub-playwright.mjs`) and set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` just to
   install.
2. **The composition root is closed.** `createNodeRuntime()` takes no overrides and the
   concrete Node adapters (`SystemClock`, `FileKeyValueStore`, `FileAuditSink`,
   `PlaywrightPortalDriver`) are not exported anywhere — a consumer wanting "Node
   defaults + my own `AuditSink`" must re-implement all four seams (OCSI's
   `makeSiiRuntime` does exactly that today).

## Decision

Make the core genuinely embeddable, shipped as **0.2.0** (pre-1.0: a MINOR may break —
the CHANGELOG already states this):

1. **The main barrel becomes statically pure.** `src/runtime.ts` is deleted and its
   re-export removed from `src/index.ts`. The `.` entry's static import graph contains
   no `node:*` and no `playwright` (only platform-neutral globals such as
   `globalThis.crypto.randomUUID`). `sideEffects: false` is declared so bundlers can
   tree-shake the barrel.
2. **Composition moves to a new `./node` subpath** (`src/node.ts`, mirroring the `./cli`
   precedent from ADR-009/ADR-006): it exports
   `createNodeRuntime(overrides?: Partial<Runtime>)` — Node defaults, any seam
   replaceable — plus the concrete adapters (`SystemClock`, `FileKeyValueStore`,
   `FileAuditSink`, `PlaywrightPortalDriver`, `SII_DIR`) so partial reuse is a
   supported path, not a re-implementation.
3. **Playwright becomes an OPTIONAL peer dependency** (`peerDependencies` +
   `peerDependenciesMeta.playwright.optional: true`), kept as a `devDependency` of core
   (the workspace typechecks `portal.ts` against it, and — because pnpm links workspace
   packages by realpath — core's own `node_modules` is what resolves the import for the
   in-repo binaries). `adapters/node/portal.ts` drops the top-level value import and
   lazy-loads `await import('playwright')` inside the launch methods; a missing module
   surfaces an actionable "install playwright" error only when the default driver is
   actually driven. `@sii/cli` and `@sii/mcp` declare `playwright` in their OWN
   dependencies (they really use the default driver). `zod` stays a regular dependency
   (it runs in the wire-parsing path of the main graph).
4. **The ADR-003 CI boundary guard flips from denylist to allowlist**: any
   `@altumstack/sii-core/<subpath>` import in `packages/{cli,mcp}` fails unless the
   subpath is `node` (composition root) — or `cli`, allowed ONLY under `packages/cli`
   (tightening what ADR-006 always intended: the MCP package must not be able to reach
   `consoleLogin`).

## Alternatives Considered

1. **Keep `createNodeRuntime` in the main barrel, made async (lazy dynamic imports).**
   Rejected: it changes the signature to `Promise<Runtime>` for every consumer, and the
   barrel still anchors the Node adapters conceptually; a subpath is the established
   pattern (`./cli`) and keeps the factory synchronous.
2. **`optionalDependencies` for playwright.** Rejected: npm/pnpm still ATTEMPT the
   install by default (browser download included) — the exact cost OCSI needs to avoid.
   An optional peer is not auto-installed by npm ≥7 or pnpm.
3. **A separate `@altumstack/sii-primitives` package.** Rejected: package-count overhead
   for zero gain — subpath exports + a pure barrel deliver the same isolation from one
   publishable unit.
4. **Leave it to consumers (status quo: bundler stubs).** Rejected: every future
   consumer repeats the stub + env-var workaround, and partial seam reuse stays
   impossible; the friction is structural, so the fix belongs in the library.

## Consequences

- Easier: `import { Rut } from '@altumstack/sii-core'` works with playwright absent;
  OCSI deletes its esbuild stub and the `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` workaround
  and can reuse individual Node adapters instead of re-implementing seams.
- Breaking (0.2.0): `createNodeRuntime` moves from the main barrel to
  `@altumstack/sii-core/node`; consumers that drive the default Playwright driver must
  now install `playwright` themselves. Both are one-line changes, documented in the
  CHANGELOG and README.
- Obligation: public signatures under `./node` must stay seam-typed — a playwright type
  in an exported signature would drag the dependency back into consumers' typecheck.
  `prepack` now cleans before building (`tsc -b --clean && tsc -b`) so deleted modules
  (e.g. `runtime.ts`) never ship as stale `dist` artifacts.
