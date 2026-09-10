# Tech Stack

## Runtime & toolchain

- **TypeScript** `^5.6` — `strict` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`. This is the equivalent of
  the Python project's `mypy --strict` gate; keep it at zero errors. (ADR-002)
  Module mode is **NodeNext**: relative imports end in `.js` so `tsc -b` output
  runs directly on Node with no bundler. (ADR-009)
- **Node.js** `>=20` (LTS) — the runtime for both surfaces (CLI + MCP).
  `@albertomarturelo/sii-core` is a Node library; external dependencies sit behind injectable
  seams for testability (ADR-003).
- **pnpm** `10.x` workspaces (pinned `pnpm@10.33.2` via `packageManager`, the
  single source of truth read by CI) — the monorepo package manager. TypeScript
  project references (`tsc -b`) wire `@albertomarturelo/sii-core` into each surface. (ADR-002)
- macOS `aarch64` dev machine; portable to Linux. No Windows-specific bits.

## Infrastructure libraries (general-purpose, NOT SII-specific — ADR-004)

These are intended choices; versions are pinned when first installed.

- **`@modelcontextprotocol/sdk`** `^1.x` — MCP server SDK (TypeScript), stdio
  transport. The stdio server is what Claude Code and Claude Desktop both
  connect to. Expose Resources (identity/config), Tools (actions), and Prompts
  (contador workflows).
- **`playwright`** `^1.49.0` (1.61.1 installed) — portal scraping (the portal is
  JS-heavy and session-stateful). Backs the default `PortalDriver` adapter
  (`@albertomarturelo/sii-core` `adapters/node/portal.ts`): headed Chromium for `interactiveLogin`,
  headless cookies-only for `restore`. Tests inject a fake instead. Chromium binary
  via `pnpm --filter @albertomarturelo/sii-core exec playwright install chromium`. (ADR-008)
  **An OPTIONAL peer of `@albertomarturelo/sii-core` since ADR-016** (lazy-loaded by the
  `./node` subpath's default driver; core keeps it as a devDependency for typecheck +
  in-workspace resolution); `@albertomarturelo/sii-cli` and `@albertomarturelo/sii-mcp` declare it as their own
  dependency. An external consumer that injects its own `PortalDriver` never installs it.
- **`commander`** `^12.1.0` — the CLI framework for `@albertomarturelo/sii-cli` (ADR-008). Nested
  subcommands (`sii auth login`, `sii operate`). Lives in `@albertomarturelo/sii-cli` only;
  `@albertomarturelo/sii-core` never imports it.
- **`@napi-rs/keyring`** `2.0.0` — **adopted (ADR-025)**, resolving the secret-storage
  TBD. Backs the `SecretStore` adapter (`adapters/node/keyring.ts`): the freedesktop
  Secret Service on Linux (gnome-keyring / kwallet), the Keychain on macOS. A prebuilt
  N-API binding — no node-gyp — imported LAZILY, so composing a runtime never loads it.
  A dependency of **`@albertomarturelo/sii-cli` only** (plus a core devDependency for typecheck, the
  playwright arrangement); `@albertomarturelo/sii-mcp` never gets it, and its composition root wires
  no `secrets` seam at all. Read by exactly one CLI-only task, `keyringLogin`
  (`sii auth login --keyring`); `keytar` was rejected as unmaintained.
  **Pinned EXACTLY, not with a caret** — it is a native module that reads the OS
  credential store and `2.0.0` is a new major, so a `2.x` must never arrive on a plain
  `pnpm install` without a human reviewing it.
- **`zod`** `^4.4.3` — **adopted (ADR-011)**. Boundary validation. Direct dependency
  of **both** `@albertomarturelo/sii-mcp` (MCP tool input schemas — the SDK's `registerTool` takes a zod
  shape and emits the protocol JSON Schema) **and `@albertomarturelo/sii-core`** (SII wire-payload
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
