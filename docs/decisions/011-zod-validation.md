# ADR-011: Adopt zod for MCP tool input schemas (and wire-boundary validation)

## Status

Accepted — 2026-06-28. Resolves the zod TBD flagged in STACK.md and the open
decision in CURRENT_STATUS ("zod — only when the first MCP input schema lands").

## Context

The MCP surface is landing. The MCP TypeScript SDK's high-level
`McpServer.registerTool` takes a **zod** shape as the tool `inputSchema` and
derives the protocol JSON Schema from it. STACK listed zod as "likely" but gated
adoption behind an ADR; the first input-taking tool (`operate <rut>`) is the
trigger. Separately, SII JSON payloads will need runtime validation at the wire
boundary when read surfaces land (curated typed shape + `raw`, ADR-004).

## Decision

- Adopt **zod** as the project's boundary-validation library. Direct dependency
  of `@albertomarturelo/sii-mcp`, pinned to **v4** (`^4`) to match the SDK's peer — current
  `@modelcontextprotocol/sdk@1.29` resolves `zod@4.4.3`.
- MCP tools use the SDK's high-level `registerTool({ inputSchema: <ZodRawShape> })`;
  the SDK emits the protocol JSON Schema. No hand-written JSON Schema, no manual
  argument validation in tool handlers.
- zod is also the sanctioned validator for **wire-boundary** parsing in
  `@altumstack/sii-core` (SII JSON payloads → curated typed shapes, ADR-004) WHEN those
  surfaces land — added as a `@altumstack/sii-core` dependency at that point, same major.
- **Validation lives at the boundary only** — external inputs (MCP args, SII
  payloads). Internal domain invariants stay plain TypeScript types; no zod in
  pure core logic.

## Alternatives Considered

1. **Raw JSON Schema via the low-level `Server` API** — rejected: heavy
   boilerplate, manual arg validation + error mapping, no type inference, and it
   abandons the SDK's ergonomic high-level API — reinventing zod exactly at the
   boundary where validation matters most.
2. **A lighter validator (valibot / arktype)** — rejected: the SDK is zod-native,
   so any other validator needs an adapter; bundle size is irrelevant for a local
   stdio server; a less-standard dependency for no benefit. The SDK pulls zod
   transitively regardless.

## Consequences

- Easier: idiomatic MCP tool definitions with type inference; one standard
  validator across MCP inputs and (later) SII wire parsing; the SDK already
  depends on zod, so this adds no net-new transitive surface.
- Obligation: pin zod to the SDK's major (v4) and bump it in lockstep with the
  SDK; STACK.md records the version on install; keep validation at boundaries
  only (recorded in CONVENTIONS.md).
- Risk: a future SDK change to its zod peer range could force a major bump;
  mitigated by pinning `^4` and tracking the SDK's peer.
