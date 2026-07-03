# ADR-008: Runtime library choices — commander CLI, browser-first auth

## Status

Accepted — 2026-06-27. Records the dependency picks that gate the auth base,
per ADR-001 (decisions before implementation).

## Context

The login/logout/operate base is the first real code. It needs a CLI framework
for `@albertomarturelo/sii-cli` and a decision on which auth path(s) to build first (which in turn
decides whether a keyring library is needed now). These choices pervade the
codebase, so they get an ADR before the code lands.

## Decision

- **CLI framework: `commander`.** Ubiquitous, simple, first-class nested
  subcommands (`sii auth login`, `sii operate`), good TS support, minimal
  ceremony. Lives in `@albertomarturelo/sii-cli` only; `@altumstack/sii-core` never imports it.
- **Auth base is browser cookies-only first** (ADR-006 default path). `auth login`
  opens a headed browser at SII's login page; the user types the Clave; we
  persist cookies-only via the `SessionStore` (a `KeyValueStore` key). This is the
  MCP-safe path and needs NO keyring.
- **Keyring deferred.** The optional credential path (getpass → keyring → submit,
  CLI only) is a later increment. The `SecretStore` seam is declared now so the
  shape exists, but no keyring library is added yet. When it lands, the choice is
  `@napi-rs/keyring` (maintained) over `keytar` (archived).
- **Runtime validation (`zod`) deferred.** RUT/period validation uses the
  in-house `rut`/`config` modules; `zod` is adopted when the first MCP tool with
  a non-trivial input schema lands, not before.
- **Portal driver: `playwright`** (already set by ADR-004/STACK) — the default
  `PortalDriver` adapter in `@altumstack/sii-core`. Added with that adapter, not in the
  pure-spine increment, to keep the first install light.

## Alternatives Considered

1. **`clipanion` / `yargs` for the CLI.** Rejected — clipanion's class API is
   more boilerplate than commander needs for a subcommand tree; yargs is less
   TS-first. commander is the lowest-risk fit.
2. **Build the keyring credential path now too.** Rejected — browser cookies-only
   is the primary + MCP-safe path; adding keyring now widens the surface and
   forces a native-module dependency before it's needed.
3. **Adopt `zod` up front for all validation.** Rejected — premature; the domain
   has its own validators (`rut`), and `zod`'s value is at the MCP input boundary
   that doesn't exist yet.

## Consequences

- Easier: the first install stays light (no native keyring, no Playwright
  browser download) so the spine builds + tests fast; the CLI surface has a clear,
  conventional framework.
- Obligation: when the keyring path lands it gets its own slice + the
  `@napi-rs/keyring` adapter behind `SecretStore`; when MCP tools land, revisit
  `zod`. `commander` and `playwright` are tracked in `docs/STACK.md` with pinned
  versions on install.
