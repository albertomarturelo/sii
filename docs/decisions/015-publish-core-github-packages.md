# ADR-015: Publish `@sii/core` as a private package on GitHub Packages

## Status

Accepted — 2026-06-30. Builds on ADR-002 (pnpm monorepo), ADR-003 (core is a Node
library with injectable seams — the contract a consumer codes against), ADR-009
(NodeNext, `dist` runs directly on Node). Defers the public-release license + ToS
ADR that ADR-004 flagged ("a future public release will need its own ADR") — this
ADR is PRIVATE distribution, so that gate does not apply.

## Context

`@sii/core` is wanted as a dependency in ANOTHER (separate, internal) project, not
just the in-repo `cli`/`mcp`. Its `exports`/`main`/`types` already point at `dist`
and the architecture is "a Node library thin surfaces call" (ADR-003), so it is
structurally consumable. Blockers to an actual publish: it is `"private": true`;
the `@sii` scope is not ours on any registry; `version` is `0.0.0` with no release
flow; there is no `files`/`LICENSE`; and `playwright` is a hard dependency. Both
projects are internal/private under the `AltumStack` GitHub org — a private registry
fits, and avoids the public-ToS gate.

## Decision

Publish ONLY `@sii/core`, renamed **`@altumstack/sii-core`**, as a **private package
on GitHub Packages** (`https://npm.pkg.github.com`); it inherits the private repo's
restricted visibility (only org members with read can install). `cli`/`mcp` stay
private workspace apps and keep consuming core via `workspace:*` locally — unaffected.

Concrete package config (`packages/core/package.json`):

- `name: "@altumstack/sii-core"`, `version: "0.1.0"` (pre-1.0 ⇒ API still unstable),
  drop `"private": true`, `license: "UNLICENSED"` (proprietary/internal).
- `publishConfig: { registry: "https://npm.pkg.github.com" }`, `repository` pointing
  at `AltumStack/sii`, `files: ["dist"]`, a `prepack`/`prepublishOnly` running `tsc -b`.
- Keep the existing `exports` (`.` + the CLI-only `./cli` subpath for `consoleLogin`).
- **`playwright` stays a `dependency`** (the default `PortalDriver` needs it to reach
  SII). `zod` stays a dependency. A consumer that injects its own driver still gets
  playwright — acceptable; revisit as a `peerDependencies.optional` only if it bites.
- The rename ripples to `cli`/`mcp` imports (`@sii/core` → `@altumstack/sii-core`) and
  their `workspace:*` dep keys — a mechanical, repo-wide change.

**Release flow: MANUAL to start** — `pnpm --filter @altumstack/sii-core publish` with a
PAT carrying `write:packages` (consumers need `read:packages` + an `.npmrc` with
`@altumstack:registry=…/npm.pkg.github.com` and a token). Bump `version` by hand per
release. Automate (changesets + a GH Action) later if cadence grows — out of scope here.

## Alternatives Considered

1. **Public npm.** Rejected for now — it exposes SII automation publicly and is GATED
   by ADR-004 on a separate license + ToS-disclaimer ADR (lineage: sii-py ADR-021/022).
   Unnecessary for an internal consumer; revisit if/when a public release is wanted.
2. **Git dependency / `pnpm pack` tarball (no registry).** Rejected as the primary path
   — `@sii/core` is a monorepo SUB-package, so a `github:AltumStack/sii` dep can't
   install just `packages/core` cleanly; a `.tgz` works for a one-off but is manual to
   update and has no version resolution. Fine as an escape hatch, not the contract.
3. **changesets + automated release now.** Rejected for v0.1 — premature infra for a
   single internal consumer and an unstable API; manual publish is enough until the
   release cadence justifies automation.
4. **Make `playwright` a peer/optional dep now.** Rejected for v0.1 — the realistic
   consumer uses `createNodeRuntime()` to actually hit SII, which needs the default
   driver; a hard dependency is simpler and correct. Reconsider if a consumer only ever
   injects its own driver.

## Consequences

- Easier: the other internal project adds `@altumstack/sii-core` like any dep and codes
  against the task layer + `createNodeRuntime` + seam types (+ `testing` fakes) — the
  same contract `cli`/`mcp` use. No public-ToS work.
- Obligation: a one-time scope rename across the repo; bump `version` + `pnpm publish`
  per release; consumers need a GitHub token + `.npmrc`. The package is `0.x` ⇒ minor
  bumps may break — pin or use `~` downstream.
- Boundary held: only `core` is published; the guardrails (ADR-003/004/005/006) ship
  inside it, so a consumer gets the same rails. A future PUBLIC release still needs its
  own license/ToS ADR (ADR-004) — this ADR does not grant that.
