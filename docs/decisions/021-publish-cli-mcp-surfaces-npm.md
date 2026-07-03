# ADR-021: Publish the CLI + MCP surfaces to public npm

## Status

Accepted — 2026-07-03. **Extends ADR-019** (which put `@albertomarturelo/sii-core` on the
public npm registry under the personal scope, tag-triggered CD) to the two SURFACE packages,
so anyone can install and run `sii` (CLI) + `sii-mcp` (stdio MCP) and wire it to Claude
**without cloning the repo**. Builds on ADR-016 (embeddable core; playwright is the surfaces'
own dependency) and ADR-018 (MIT).

## Context

`@sii/cli` and `@sii/mcp` were `private:true`, `0.0.0`, under the unpublishable `@sii` scope —
runnable only from the monorepo. The core is already public on npm, but a user still had to
clone the repo to get a working CLI/MCP. For adoption (and an honest "install it" story) the
surfaces must be `npm i -g`-able and documented for a no-repo install.

## Decision

Rename and publish both surfaces to **public npm** under the personal scope, versioned in
lockstep with the core on the existing `v*`-tag CD:

- **Names:** `@sii/cli` → **`@albertomarturelo/sii-cli`**, `@sii/mcp` → **`@albertomarturelo/sii-mcp`**
  (the unscoped `sii` is taken on npm; the scope matches the core). The **bins stay `sii` and
  `sii-mcp`** — the user-facing commands don't change.
- **Publishable `package.json`:** `private` dropped, `license:MIT`, `repository`+`directory`,
  `publishConfig.access:public`, `engines.node>=20`, `files:[dist,README,LICENSE]`,
  `prepack: tsc -b` (never ship stale `dist`), per-package README (npm renders it). The core
  dependency is `workspace:^` → pnpm rewrites it to `^<version>` on publish.
- **Versioning: the trio releases together.** All three move to **0.5.0** for this release —
  the surfaces' first publish AND a core republish (npm's `core@0.4.0` predates the `peticiones`
  code merged after 0.4.0, so a consumer on `^0.4.0` would lack `peticionesList`). A single
  `v*` tag drives the whole trio.
- **CD:** the `publish-core.yml` workflow publishes the workspace with **`pnpm -r publish`**
  (idempotent — already-published versions are skipped) instead of core-only; the tag==version
  guard checks all three (kept in lockstep).
- **Playwright is a direct dependency of each surface** (ADR-016) — auto-installed on
  `npm i -g`, but the **Chromium binary is a documented one-time post-install step**
  (`npx playwright install chromium`), NOT a heavy automatic postinstall. This is the one UX
  cliff; the READMEs make it step 2.

## Alternatives Considered

1. **Unscoped `sii` / `sii-mcp` names** — rejected: `sii` is already taken on npm; a scope also
   keeps the three packages visibly one project.
2. **Independent version lines for cli/mcp (start at 0.1.0)** — rejected: they release from one
   monorepo against one core; lockstep versions make "which core does this cli need" obvious and
   the CD a single tag. (Revisit if a surface ever diverges.)
3. **A heavy `postinstall` that runs `playwright install`** — rejected (ADR-016 posture): a
   library must not force a multi-hundred-MB browser download on install; document the explicit
   step instead.
4. **Keep the surfaces repo-only; publish core only** — rejected: it blocks the "install it and
   use it" adoption path this ADR exists to open.

## Consequences

- Easier: `npm i -g @albertomarturelo/sii-cli @albertomarturelo/sii-mcp` + one `playwright
  install` + a 3-line Claude config = a working setup, no clone. The CD stays one tag.
- Obligation: keep the trio's versions in lockstep; maintain three READMEs; the release now
  publishes three packages (the tag==version guard covers drift).
- Boundary held: the surfaces still depend ONLY on the core's public API (ADR-003); no new
  runtime coupling. MIT across all three (ADR-018).
- Risk: the Playwright browser step is a real drop-off point — mitigated by making it step 2 in
  every README + an actionable error from the default driver (ADR-016). A smoke test in a clean
  environment (no repo) gates the release.
