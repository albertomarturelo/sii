# ADR-012: JSON is the default output; `@altumstack/sii-core` is the JSON contract

> **Amended 2026-10-18 (#134):** a JSON error now carries a stable `type` plus its exit code
> and, for login failures, `reason` / `codigo`. The MCP reports errors in the same shape. See
> [Amendment](#amendment-2026-10-18-134).

## Status

Accepted — 2026-06-29. Driven by the requirement to embed `@altumstack/sii-core` as a library in
another system, where the consumer needs structured data, not human text.

## Context

`@altumstack/sii-core` tasks already return plain, JSON-serializable TypeScript objects (`F22Estado`,
`RcvSummary`, the operate context, …) — no `Date`/`Map`/`Set`, no formatting baked in. That
IS the integration contract: a host system does `JSON.stringify(await f22Status(...))` and
gets clean JSON. But the human saw only the `@albertomarturelo/sii-cli` text rendering and reasonably worried
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

## Amendment (2026-10-18, #134)

`{ "error": "<message>" }` was not enough for an unattended agent (ADR-028). Three login
failures share exit code `3`, and an agent must act differently on each:
- SII rejected the Clave: stop, and a person must fix the Clave.
- The latch refused without contacting SII: stop, and do NOT lift the latch.
- The Queue-it waiting room: SII never judged the Clave.

Before this amendment, telling them apart meant regex-parsing a Spanish message. The core
already held the answer as data (the error class, `LoginFailedError.reason` / `.codigo`), and
the CLI dropped it.

- **The JSON error shape (CLI, STDERR):**
  `{ "error": "<verbatim>", "type": "<kind>", "exitCode": n, "reason"?: …, "codigo"?: … }`.
  - `error` is unchanged: the same verbatim message (ADR-004), never translated.
  - `exitCode` repeats the process exit code, so a consumer that captured only STDERR still has it.
  - `reason` and `codigo` appear on every `login_*` kind, and on no other kind. `codigo` is
    `null` when SII printed none.
  - Human mode is unchanged: the bare message.
- **`type` is a stable kind name, never a JS class name.** A refactor may rename a class; it
  must not rename a kind. One core function, `classifyError`, maps an error to its kind, so
  both surfaces read the same table. The CLI's exit code is now derived from the kind (a
  table that must list every kind, checked at compile time), so the two cannot drift apart.

  | `type` | When | Exit |
  | --- | --- | --- |
  | `login_rejected` | SII judged the Clave and printed a código (the latch tripped) | 3 |
  | `login_blocked` | The latch refused without contacting SII | 3 |
  | `login_queued` | SII's Queue-it waiting room (SII never judged the Clave) | 3 |
  | `login_failed` | Any other failed login: no código, timeout, empty Clave, missing `--clave-env` variable | 3 |
  | `not_authenticated` | No session | 2 |
  | `session_expired` | The stored session is dead | 2 |
  | `www2_session_required` | The www2 app session is missing or expired (ADR-026) | 2 |
  | `rate_limited` | SII's rate limit or block | 4 |
  | `validation` | Invalid input: a RUT, an operate target, a flag combination | 1 |
  | `credential_not_found` | No Clave in the keyring for that RUT | 1 |
  | `browser_required` | The surface needs Chromium and none is installed | 1 |
  | `unexpected_response` | An endpoint answered something the surface does not recognise and that is not the login wall: a non-JSON body from a JSON endpoint, or a changed page (e.g. Mi SII without `DatosCntrNow`, #139) | 1 |
  | `sii_error` | SII refused a domain read or write, or a scraper broke (`RcvError`, `F29Error`, …) | 1 |
  | `unexpected` | Not a domain error (a bug) | 1 |

  `login_rejected` uses the same rule as the latch's `siiJudgedClave`, and a test keeps the two
  in agreement. `login_rejected` therefore always means "the latch is now set for this RUT".
- **The compatibility rule.** Fields are only ever added. A kind is never renamed and never
  reassigned to a different situation. A kind may be split into finer ones only by a new
  amendment. A consumer that does not recognise a `type` treats it as `unexpected`: it stops
  and alerts a person, and never retries.
- **No secret in any field.** The only new fields are a kind name, a number, a reason enum and
  SII's message código. None carries a Clave, a cookie or an environment value. An error that
  must not echo its input (a `--clave-env` argument that looks like a value, ADR-028) still
  does not, because `error` is the message the core already wrote.
- **MCP parity.** A failed tool call's text is the same object without `exitCode` (an MCP tool
  has no exit code): `{ "error", "type", "reason"?, "codigo"? }`, still with `isError: true`.
  It was the bare message. The MCP already returns its results as JSON, and a model reads the
  verbatim message inside `error` just as well.

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
