# ADR-012: JSON is the default output; `@altumstack/sii-core` is the JSON contract

> **Amended 2026-10-18 (#134):** a JSON error carries a stable `type`, its exit code and, for
> logins, `reason` / `codigo`; the MCP uses the same shape. [Amendment](#amendment-2026-10-18-134).
> **Amended 2026-10-23 (#215):** kind `network`: SII never answered (DNS, connection, TLS, a
> proxy, the timeout); the message names the host and Node's cause. It was `unexpected`.
> **Amended 2026-10-26 (ADR-031, #230):** kind `aborted`: the caller's `AbortSignal` cut a task
> between SII calls. Exit 1; the CLI never passes a signal, so only library consumers see it.

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

`{ "error": "<message>" }` was not enough for an unattended agent (ADR-028): three login failures
share exit `3` but need different actions (Clave rejected; latch refused without contacting SII;
Queue-it). That meant regex-parsing Spanish, though the core held the answer as data.

- **The JSON error shape (CLI, STDERR):**
  `{ "error": "<verbatim>", "type": "<kind>", "exitCode": n, "reason"?: …, "codigo"?: … }`.
  `error` is the same verbatim message (ADR-004). `exitCode` repeats the process exit code.
  `reason` / `codigo` appear on every `login_*` kind and on no other (`codigo` is `null` when
  SII printed none). Human mode is unchanged: the bare message.
- **`type` is a stable kind name, never a JS class name.** One core function, `classifyError`,
  maps an error to its kind for both surfaces. The CLI's exit code is derived from the kind
  through a table the compiler checks for completeness, so the two cannot drift apart.

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
  | `network` | SII never answered: DNS, connection, TLS, a proxy or the timeout. `error` names the host and Node's cause code (#215; was `unexpected`, hence the same exit) | 1 |
  | `aborted` | The caller's `AbortSignal` cut a task between SII calls (ADR-031); nothing partial is returned | 1 |
  | `unexpected` | Not a domain error (a bug) | 1 |

  `login_rejected` uses the latch's own rule (`siiJudgedClave`, kept in agreement by a test), so
  it always means "the latch is now set for this RUT".
- **Compatibility.** Fields are only added; a kind is never renamed or reassigned, and is split only
  by a new amendment. An unrecognised `type` is treated as `unexpected`: stop, alert, never retry.
- **No secret in any field:** a kind name, a number, a reason enum and SII's código. `error` is
  the message the core wrote, so an input that must not be echoed (ADR-028) still is not.
- **MCP parity.** A failed tool call's text is the same object without `exitCode` (a tool has
  none), still with `isError: true`. It was the bare message.

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
