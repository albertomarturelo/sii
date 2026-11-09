# ADR-033: ROADMAP and the SII wire rules load on demand, not in every session

## Status

Accepted — 2026-11-09

## Context

ADR-001 made `CLAUDE.md` an index of `@docs/*` references. An `@` reference is not a
pointer: the agent loads the file into the context of every session, and every request
of that session re-reads it. The index now pulls in about 115 KB of docs. Two files make up
most of it, and both grew by about 70% between 2026-10-17 and 2026-11-09:

- `docs/ROADMAP.md` (≈44 KB), a status checklist whose rows now carry the validation
  narrative of each surface;
- `docs/CONVENTIONS.md` (≈46 KB), of which the « SII domain rules » section is ≈28 KB:
  wire-parsing rules that matter only when a change touches a portal facade or a task.

The CFD telemetry trial (#260) shows the load at the first request rising with each
change to these docs, while the orientation cost after that load stays small. So the
docs work; loading all of them in every session is what scales badly, because
`session-close` and "corrections become conventions" make both files grow on purpose.

## Decision

Split the context layer into an **always-on** part and an **on-demand** part.

- **Always on** (stays `@`-imported by `CLAUDE.md`): `ARCHITECTURE.md`, `STACK.md`,
  `decisions/_index.md`, and `CONVENTIONS.md` without its SII domain section. These are
  the rules a slip breaks anywhere: layer boundaries, secrets and PII, commits and PRs,
  naming. `CLAUDE.md`'s Critical Rules stay as they are.
- **On demand**, referenced by plain path (no `@`):
  - `docs/ROADMAP.md`. It is status, not instructions. `session-start` and `session-close`
    already read it; `issue-new` reads it to place a new surface.
  - `docs/conventions/sii-wire.md`, the « SII domain rules » section moved verbatim out
    of `CONVENTIONS.md`. `CONVENTIONS.md` keeps one line in its place that points to it.
- **The trigger lives in the always-on part.** `CLAUDE.md`'s Critical Rules say: before
  changing `packages/core/src/portal/`, `packages/core/src/tasks/` or
  `docs/sii-contract/`, **and before a write against the live SII**, read
  `docs/conventions/sii-wire.md`. The write case is there because some wire rules govern
  operating the CLI, not editing code (classify every item before a batch of
  irreversible writes). `issue-start` and `review-pr` read it when the issue or the diff
  touches those paths. An agent that runs
  no skill still meets the trigger, because it sits in the file every agent loads
  (`AGENTS.md` is a symlink to it).
- **Corrections still become conventions.** A new SII wire rule goes into
  `conventions/sii-wire.md`; any other rule into `CONVENTIONS.md`. The move changes where
  a rule lives, never its text.
- **Proof.** Once at least three sessions exist after the change, the telemetry dashboard's
  before/after row must show a lower context at the first request **and** no rise in the
  tokens before the first edit. A rise there means the on-demand reads cost more than the
  eager load saved: revisit this ADR.

## Alternatives Considered

1. **Pointers only: ROADMAP and all of CONVENTIONS on demand** — saves the most, but
   CONVENTIONS also holds the secrets, PII and commit rules. A quick fix done without a
   skill (or from another agent) would never load them, and those are the mistakes that
   leak data or land in public history. Rejected: the safety rules must be always on.
2. **Keep everything eager, compact the text** (ROADMAP to one line per row, CONVENTIONS
   condensed) — keeps "the agent always knows everything", but it is a large editorial
   rewrite that risks losing the nuance each rule was written for, and both files grow
   back by design. Rejected as the main fix; compacting ROADMAP rows stays open as
   separate bookkeeping.
3. **Status quo plus a CI size budget on the eager imports** — cheapest and stops further
   growth, but leaves today's load on every request of every session. Rejected as the fix;
   a budget may still be added on top of this decision.

## Consequences

- Every session starts lighter, and the saving repeats on every request it makes.
- A change to a facade or task now depends on the agent honouring a one-line trigger or
  running `issue-start` / `review-pr`. `review-pr` is the backstop: it reads the wire rules
  whenever the diff touches those paths.
- The status questions a session used to answer for free ("is X shipped?") now cost a
  read of `ROADMAP.md`. `session-start` already pays it once per session.
- `validate-context` checks that `CLAUDE.md` has no `@` on the on-demand files and that
  the trigger line exists.
- Implementation, one PR: move the section, edit `CLAUDE.md`, `CONVENTIONS.md` and the
  four skills (`session-start`, `issue-new`, `issue-start`, `review-pr`), plus the
  `validate-context` check. ADR-001's "index of `@docs/*`" now reads "an index whose
  `@` references are the always-on part (ADR-033)".
