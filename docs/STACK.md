# Tech Stack

## Runtime & toolchain

- **TypeScript** `^5.6` — `strict` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`. This is the equivalent of
  the Python project's `mypy --strict` gate; keep it at zero errors. (ADR-002)
- **Node.js** `>=20` (LTS) — the runtime for both surfaces (CLI + MCP).
  `@sii/core` is a Node library; external dependencies sit behind injectable
  seams for testability (ADR-003).
- **pnpm** `9.x` workspaces — the monorepo package manager. TypeScript project
  references (`tsc -b`) wire `@sii/core` into each surface. (ADR-002)
- macOS `aarch64` dev machine; portable to Linux. No Windows-specific bits.

## Infrastructure libraries (general-purpose, NOT SII-specific — ADR-004)

These are intended choices; versions are pinned when first installed.

- **`@modelcontextprotocol/sdk`** `^1.x` — MCP server SDK (TypeScript), stdio
  transport. The stdio server is what Claude Code and Claude Desktop both
  connect to. Expose Resources (identity/config), Tools (actions), and Prompts
  (contador workflows).
- **`playwright`** `^1.x` — portal scraping (the portal is JS-heavy and
  session-stateful). The default `PortalDriver` adapter; tests inject a fake.
- **CLI framework** — TBD via ADR (candidates: `commander`, `clipanion`,
  `yargs`). Pick one before the first CLI command lands.
- **Secret storage** — TBD via ADR (candidate: `keytar` / `@napi-rs/keyring`
  for the OS keychain). The default `SecretStore` adapter.
- **`zod`** (likely) — runtime validation at the wire boundary and for MCP tool
  input schemas. Confirm via ADR before adopting.

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
