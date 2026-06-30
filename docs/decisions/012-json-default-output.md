# ADR-012: JSON is the default output; `@altumstack/sii-core` is the JSON contract

## Status

Accepted — 2026-06-29. Driven by the requirement to embed `@altumstack/sii-core` as a library in
another system, where the consumer needs structured data, not human text.

## Context

`@altumstack/sii-core` tasks already return plain, JSON-serializable TypeScript objects (`F22Estado`,
`RcvSummary`, the operate context, …) — no `Date`/`Map`/`Set`, no formatting baked in. That
IS the integration contract: a host system does `JSON.stringify(await f22Status(...))` and
gets clean JSON. But the human saw only the `@sii/cli` text rendering and reasonably worried
the data was text-shaped. We need the data contract to be unmistakable AND reachable when the
CLI is driven programmatically (Claude Code via Bash, scripts, other systems shelling out).

## Decision

- **The core is the data layer; surfaces are presentation.** `@altumstack/sii-core` returns
  JSON-serializable objects and never formats for humans. The MCP surface already emits
  `JSON.stringify`. This is reaffirmed as a contract, not just current behaviour.
- **The CLI emits JSON by DEFAULT.** `sii <cmd>` prints the task's object as pretty JSON to
  STDOUT — the same object the library returns. `--human` switches to the readable text
  rendering; `--json` is the (default) explicit form. Both flags parse in any position
  (`sii --human f22 status` and `sii f22 status --human`).
- **STDOUT stays pure.** The result (JSON or text) goes to STDOUT; diagnostics, prompts, and
  the `operating as:` header go to STDERR. In JSON mode the header is omitted entirely (the
  operating RUT is already a field), so `sii … | jq` works with no preprocessing.
- **Errors are structured too.** In JSON mode a failure prints `{ "error": "<verbatim SII
  message>" }` to STDERR with the documented exit code; `--human` prints the bare message.
- One shared `emit(data, humanRenderer)` helper enforces this uniformly; each command computes
  its result object once and hands it to `emit`.

## Alternatives Considered

1. **Human text default, `--json` opt-in (the usual CLI idiom: gh, kubectl).** Rejected for
   THIS tool: the primary consumers are programmatic (a library embed, Claude Code via Bash,
   the MCP server), so structured-by-default better fits the integration goal. A human still
   gets readable output with one flag.
2. **Only document the core contract, leave the CLI as text.** Rejected — the CLI is a real
   integration surface (Bash). Leaving it text-only forces consumers to parse formatted lines,
   the exact fragility we avoid.
3. **A separate `sii … --format=json|text` enum.** Rejected as heavier than two booleans for a
   binary choice; `--human` reads clearly.

## Consequences

- Easier: embedding the core (objects) or the CLI (`| jq`) both yield JSON; one `emit` helper
  keeps every command consistent; the MCP/CLI/library now speak the same shapes.
- Obligation: every new command computes a result object and renders through `emit` (never
  bare `out()` for results); new fields are added to the typed object, not just the text.
  Tests assert the JSON shape for the default and the text for `--human`.
- Risk: flipping the default could surprise a human who expected text — mitigated by `--human`
  and the always-present `--help`. The `operating as:` header (ADR-005) is human-only now; the
  same information lives in the JSON `rut`/`operating` fields, so the ADR-005 "always visible"
  intent is preserved per-surface.
