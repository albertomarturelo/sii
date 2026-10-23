# ADR-001: Adopt Context-First Development (CFD) for this repo

> **Amended 2026-10-22:** the procedures moved from slash commands to Agent Skills in
> `.agents/skills/`. See the [Amendment](#amendment-2026-10-22).

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
- **Slash commands** in `.claude/commands/` *(superseded by the Amendment: Agent Skills)*:
  `session-start`, `session-close`, `decision-new`, `issue-new`, `issue-start`, `review-pr`, `validate-context`.
- **Corrections become conventions** (ADR-007 lineage): fix a pattern twice →
  write it into `CONVENTIONS.md` in the same commit.
- **CI enforces context integrity:** ADR index integrity, ADR completeness,
  PII guard, and the no-third-party-SII guard run on every PR.

## Amendment (2026-10-22)

Follows the upstream CFD catalog ADR `agent-skills-as-procedures`, which supersedes its
`slash-commands-vs-skills`. The Decision above stands except for where the procedures live.

- **Agent Skills, one copy.** Each procedure is `.agents/skills/<name>/SKILL.md` (the open
  Agent Skills format: `name` + `description` frontmatter). `.claude/skills` is a symlink to
  that directory, never a copy. `.claude/commands/` is gone. Codex, Copilot and Gemini CLI
  read `.agents/skills`, so a non-Claude agent finds the same procedures.
- **Names are the folder names**, invoked as `/session-start`, `/issue-start`,
  `/new-decision`, … The `/session:start` style in the old docs never matched a file, and
  `decision-new` above was never the file's name: it stays `new-decision`, as upstream.
- **Rituals stay manual.** `session-start`, `session-close`, `issue-new` and `issue-start`
  set `disable-model-invocation: true` and ship `agents/openai.yaml` with
  `allow_implicit_invocation: false`. `new-decision`, `review-pr` and `validate-context` may
  be picked up by the agent on its own; their descriptions say when.
- **Token budgets** move from the old header comments to `metadata.token-budget`.
- **No plugin channel.** The skills are vendored in the repo; installing the upstream `cfd`
  plugin on top would list every procedure twice.

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
