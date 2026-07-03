# ADR-019: Publish to public npm under the personal scope `@albertomarturelo/sii-core`

## Status

Accepted — 2026-07-02. Resolves the "republish target (public npm vs GitHub
Packages)" follow-up that ADR-018 left open, and **supersedes** two earlier
decisions now that the repo is public and personal:

- ADR-018's choice to **keep the `@altumstack/sii-core` package name** (superseded:
  the scope is now `@albertomarturelo`).
- ADR-015's **private GitHub Packages** registry (superseded: distribution moves to
  the public npm registry). ADR-015's tag-triggered CD *flow* is retained, only the
  registry + auth change.

## Context

The repo moved to a personal account and went public under MIT (ADR-018). The core
package was still configured for **private GitHub Packages** under the `@altumstack`
scope — which forces every consumer to add an `.npmrc` scope mapping and a GitHub
token with `read:packages`. For a public open-source library that is pure friction:
the natural home is the **public npm registry**, where `npm install <pkg>` just works.

The scope also no longer matched the owner. `@altumstack` is a GitHub org that no
longer owns the repo; on npm it does not exist at all (npm accounts are separate from
GitHub orgs). Continuing under `@altumstack` would have meant creating an npm org of
that name purely for branding that has been shed.

## Decision

Publish `@albertomarturelo/sii-core` to the **public npm registry**
(`https://registry.npmjs.org`), under the owner's **personal npm scope**
`@albertomarturelo`.

- **Rename** the package `@altumstack/sii-core` → `@albertomarturelo/sii-core`
  everywhere it is a *live* identifier: the three `package.json`s, every `.ts`
  import (incl. the `/node` and `/cli` subpaths), the CI boundary guard, the issue
  templates, and the living docs (`CLAUDE.md`, `ARCHITECTURE`, `CONVENTIONS`,
  `STACK`, `ROADMAP`, README/CONTRIBUTING/SECURITY, `sii-contract/*`).
- **Do NOT rewrite historical records.** Prior ADRs (`docs/decisions/*`), the
  `CHANGELOG` release entries for `0.1.0`/`0.2.0`, and `CURRENT_STATUS` narrative keep
  the `@altumstack/sii-core` name — they document what shipped *then*. Rewriting them
  would falsify the record. This ADR is the pointer from old name to new.
- `packages/core/package.json` `publishConfig` → `{ registry:
  "https://registry.npmjs.org", access: "public" }` (a scoped package is `restricted`
  by default; `access: public` is required to publish it publicly for free).
- `publish-core.yml` swaps `registry-url` to npm, `scope` to `@albertomarturelo`,
  auth from `GITHUB_TOKEN` to an **`NPM_TOKEN` repo secret** (an npm automation
  token), and publishes with `--access public`. The `v*`-tag trigger and the
  tag==version guard are unchanged.

**Prerequisites (owner, interactive — cannot be automated here):** own the npm
username/scope `@albertomarturelo` (`npm login`), create an npm **automation access
token**, and add it as the `NPM_TOKEN` repo secret. The first public publish is the
normal flow — bump `version`, merge, push a matching `v*` tag.

## Alternatives Considered

1. **Keep `@altumstack/sii-core` on a new npm org.** Rejected — creating an
   `altumstack` npm org solely to preserve a shed brand, and the scope would still not
   match the owner. Renaming is a one-time mechanical cost.
2. **Public GitHub Packages** (keep the registry, flip visibility). Rejected — even
   public, GitHub Packages still requires consumers to configure an `.npmrc` registry
   mapping; public npm is the frictionless default for an OSS library.
3. **Unscoped `sii-core`.** Available, but a scope namespaces the package to the owner
   and reads as intentional; the personal scope was preferred over a bare global name.

## Consequences

- Consumers install with a plain `npm install @albertomarturelo/sii-core` — no token,
  no `.npmrc`. Wider reach; this is the point of going public.
- A one-time repo-wide rename (done in this PR); historical records intentionally keep
  the old name, so `git grep @altumstack/sii-core` will still hit ADRs / CHANGELOG /
  CURRENT_STATUS — that is expected, not a leftover.
- The old **private** `@altumstack/sii-core` GitHub Packages versions (0.1.0, 0.2.0)
  are orphaned; retire them at leisure. Any prior internal consumer must repoint to the
  new name + registry.
- CI/CD now depends on an `NPM_TOKEN` secret; a missing/expired token fails the publish
  job (not CI). Guard the token's scope to publish-only on `@albertomarturelo`.
- The first public release's **version** is a separate call: `main` already carries the
  unreleased `0.3.0` / `bte emit` material whose tag was deferred to #62, so cutting the
  first npm release means either releasing `0.3.0` (incl. the not-yet-live-validated BHE
  issue step) or a dedicated bump — decided at publish time, not here.
