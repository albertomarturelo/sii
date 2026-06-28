# Tech Stack

## Runtime & toolchain

- **TypeScript** `^5.6` — `strict` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`. This is the equivalent of
  the Python project's `mypy --strict` gate; keep it at zero errors. (ADR-002)
  Module mode is **NodeNext**: relative imports end in `.js` so `tsc -b` output
  runs directly on Node with no bundler. (ADR-009)
- **Node.js** `>=20` (LTS) — the runtime for both surfaces (CLI + MCP).
  `@sii/core` is a Node library; external dependencies sit behind injectable
  seams for testability (ADR-003).
- **pnpm** `10.x` workspaces (pinned `pnpm@10.33.2` via `packageManager`, the
  single source of truth read by CI) — the monorepo package manager. TypeScript
  project references (`tsc -b`) wire `@sii/core` into each surface. (ADR-002)
- macOS `aarch64` dev machine; portable to Linux. No Windows-specific bits.

## Infrastructure libraries (general-purpose, NOT SII-specific — ADR-004)

These are intended choices; versions are pinned when first installed.

- **`@modelcontextprotocol/sdk`** `^1.x` — MCP server SDK (TypeScript), stdio
  transport. The stdio server is what Claude Code and Claude Desktop both
  connect to. Expose Resources (identity/config), Tools (actions), and Prompts
  (contador workflows).
- **`playwright`** `^1.49.0` (1.61.1 installed) — portal scraping (the portal is
  JS-heavy and session-stateful). Backs the default `PortalDriver` adapter
  (`@sii/core` `adapters/node/portal.ts`): headed Chromium for `interactiveLogin`,
  headless cookies-only for `restore`. Tests inject a fake instead. Chromium binary
  via `pnpm --filter @sii/core exec playwright install chromium`. (ADR-008)
- **`commander`** `^12.1.0` — the CLI framework for `@sii/cli` (ADR-008). Nested
  subcommands (`sii auth login`, `sii operate`). Lives in `@sii/cli` only;
  `@sii/core` never imports it.
- **Secret storage** — TBD via ADR (candidate: `keytar` / `@napi-rs/keyring`
  for the OS keychain). The default `SecretStore` adapter.
- **`zod`** `^4.4.3` — **adopted (ADR-011)**. Boundary validation. Direct dependency
  of **both** `@sii/mcp` (MCP tool input schemas — the SDK's `registerTool` takes a zod
  shape and emits the protocol JSON Schema) **and `@sii/core`** (SII wire-payload
  parsing: the SDI envelope is validated with zod, then rows are projected
  alias-tolerantly — landed with the RCV read surface, #17). Pinned to v4 to match the
  SDK's peer (`@modelcontextprotocol/sdk@1.29` → `zod@4.4.3`); same major in both
  packages, bumped in lockstep with the SDK.

## Dev tooling

- **vitest** `^2.x` — test runner. Tests must NOT hit production SII: default
  mode is recorded fixtures with SYNTHETIC data (no real PII).
- **ESLint** `^9` (flat config) + **typescript-eslint** `^8` — linting.
- **Prettier** `^3` — formatting. Format before commit.
- **tsc** `-b` — build + typecheck via project references.

## In-house SII modules (no third-party SII libraries — ADR-004)

All SII domain code is written from first-hand observation and cited in code.
Planned modules are listed in `docs/ARCHITECTURE.md`. Nothing is implemented
yet — this repo is at the CFD scaffolding stage.

Update this file whenever a version is pinned or a TBD is resolved by an ADR.
Cite versions in ADRs that depend on them.
