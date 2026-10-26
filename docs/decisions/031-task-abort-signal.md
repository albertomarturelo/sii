# ADR-031: A caller bounds a multi-call task with an `AbortSignal`, checked between SII calls

## Status

Accepted — 2026-10-26. Amends ADR-012 (new error kind `aborted`). First applied to `bteList`
(#230).

## Context

Several core tasks make many paced SII calls inside one invocation: `bteList` walks a month's
pages (1 s apart, up to `MAX_PAGINAS` = 100), `rcvListAll` fans out over DTE types,
`f22Historial` over folios, `f22 terceros` over up to 30 pages, and `alertas` makes ~20 calls
(16–21 s measured, ADR-030). Once a task starts, its caller cannot stop it. An embedder with a
hard time limit (beanbang's sync job on a 60 s Lambda, #230) needs to say "start no SII call after
this deadline", and to know for sure when a read was cut, so that it never stores a partial
month. Today the only bound is the driver's per-request timeout (30 s), which caps one call, not
the task.

## Decision

- **A read task that makes more than one SII call MAY take `signal?: AbortSignal` in its args**
  (per call, never on `Runtime`). The caller builds it: `AbortSignal.timeout(ms)` for a
  deadline, `AbortSignal.any([...])` to combine with its own.
- **Checked between SII calls, never during one.** The task checks the signal:
  1. before opening the session, so a signal that is already aborted fails without contacting
     SII;
  2. before each pacing pause, so a cut does not waste the pause;
  3. after each pause, right before the next request.

  The signal is never passed into `PortalSession`: a request in flight always completes, and the
  seams do not change.
- **A cut is an error, never a partial result.** The task throws `AbortedError` (core, NOT a
  `SiiError`: SII did not refuse anything), with the signal's `reason` as its `cause`.
  `classifyError` maps it to the new kind **`aborted`** (exit 1). This amends ADR-012's table.
  A composite read (ADR-030) aborts as a whole, like any non-SII error: it is not a per-source
  `error`.
- **The audit receipt records the cut**: `result: 'aborted'` and how far the task got (for
  `bteList`, `paginas`), never any read data.
- **Writes never take a signal.** Cutting an F29 submit or a BHE emission between its calls would
  leave an ambiguous state (ADR-029 amendment: ambiguity is resolved by reading state, never by
  resending), which no deadline is worth.
- **Surfaces do not expose it yet.** The CLI has no deadline to honour. The MCP SDK hands each tool
  call a cancellation signal, which a later change may wire through; that needs no new ADR.
- **Adoption is per task, on demand.** `bteList` first (#230). Another task adopts the same
  shape when a caller needs it, with tests for each check point.

## Alternatives Considered

1. **A page cap (`maxPaginas`)** — deterministic and trivial to test, but the caller's limit is
   time and a page has no fixed duration (1 s of pacing plus up to 30 s of request). It also has
   no meaning for tasks that do not paginate (`alertas`). Rejected; a cap can be added later if
   someone needs it, without conflicting with this.
2. **A signal that also cancels the request in flight** — tighter, and harmless for a GET. But it
   changes every `PortalSession` primitive and both drivers, and it would reach the write paths,
   where a cut request is an ambiguous outcome. Rejected; the overrun is one request (≤ 30 s,
   usually under 1 s), which the caller budgets for.
3. **A partial result marked `incompleto: true`** (like `alertas`' sources) — keeps what was read.
   But for a paginated month the totals come from page 0 and would not match the rows read, and
   the caller has to discard it anyway. A marked result invites storing a partial month.
   Rejected.
4. **Rethrow the bare `signal.reason`** (a `DOMException`, as `fetch` does) — idiomatic, no new
   class. But a caller's own reason can be any value, and `classifyError` could not tell a cut
   from a bug (`unexpected`). Rejected in favour of a core class that carries it as `cause`.
5. **A per-task option for BTE only, no general rule** — less commitment, but the next task
   that needs it (most likely `alertas`) would reopen the question and might pick another shape.

## Consequences

- An embedder can run any adopting task under a deadline and tell a cut (`aborted`) from a
  failure. The worst overrun is whatever is in progress when the signal fires: the request in
  flight (≤ 30 s, the driver's timeout) or the pacing pause (≤ 1 s: `Clock.sleep` cannot be
  interrupted), plus restoring the session if it fires during that.
- `aborted` is a stable kind (ADR-012 compatibility rules). Consumers that do not know it read it
  as `unexpected`, which is safe: stop, do not retry.
- Each adopting task owes tests for the three check points, and for "the request in flight
  completes". The fakes need no change: the signal never reaches a seam.
- Adding the option is an Added change, so the release that ships it is a minor.
