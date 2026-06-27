# ADR-001: Adopt Context-First Development (CFD) for this repo

## Status

Accepted — 2026-06-27

## Context

This repo is a ground-up TypeScript rewrite of a Python `sii-cli` that matured
under Context-First Development (CFD): a context layer (`CLAUDE.md` + `docs/`),
Architecture Decision Records, GitHub Issues as fixed-shape work units, and
slash commands that keep each session cheap to start and each decision durable.
That discipline is the main reason the Python project stayed coherent across
30 ADRs; we want it from line one here, not retrofitted.

## Decision

Run this repo under CFD from the start:

- **Context layer:** `CLAUDE.md` is an INDEX of `@docs/*` references (target
  ≤150 lines), not prose. The encyclopedia lives in `docs/ARCHITECTURE.md`,
  `STACK.md`, `CONVENTIONS.md`, `ROADMAP.md`, `CURRENT_STATUS.md`.
- **ADRs:** every significant decision gets an ADR under `docs/decisions/`
  BEFORE implementation, following `TEMPLATE.md`, ≤100 lines, listed in
  `_index.md`. Status starts `Accepted` unless explicitly `Proposed`.
- **Work units:** GitHub Issues with a fixed 6-section body (Context, Target,
  ADRs to load, Acceptance criteria, Reproduction, Estimated sessions).
- **Slash commands** in `.claude/commands/`: `session-start`, `session-close`,
  `decision-new`, `issue-new`, `issue-start`, `review-pr`, `validate-context`.
- **Corrections become conventions** (ADR-007 lineage): fix a pattern twice →
  write it into `CONVENTIONS.md` in the same commit.
- **CI enforces context integrity:** ADR index integrity, ADR completeness,
  PII guard, and the no-third-party-SII guard run on every PR.

## Alternatives Considered

1. **Start coding, document later.** Rejected — the Python project's coherence
   came precisely from decisions-before-code; deferring it reintroduces the
   re-litigation and context drift CFD exists to prevent.
2. **Lighter docs (README only).** Rejected — a README can't carry per-decision
   rationale; future sessions (human or AI) re-derive or contradict it.

## Consequences

- Easier: any session (or agent) orients in ~1k tokens via `/session:start`;
  decisions survive with their rationale; reviews check the diff against the
  context, not just the code.
- Obligation: discipline tax up front — write the ADR before the code, keep
  `CURRENT_STATUS.md` fresh, ship `docs/` changes in the same commit as code.
- This ADR is self-referential: it records the methodology the rest of the
  repo assumes. The CFD methodology itself:
  <https://github.com/albertomarturelo/context-first-development>.
