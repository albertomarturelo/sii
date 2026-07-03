---
name: Work unit (maintainer)
about: Internal maintainer work unit. Contributors — use Bug report or Feature request instead.
title: ""
labels: []
---

<!-- Fixed 6-section body. `/issue:start` parses by section header — do NOT
     rename or reorder. If a section truly does not apply (e.g. Reproduction on
     a feature), remove ONLY that section. See .claude/commands/issue-new.md. -->

## Context

<!-- 2–4 sentences: what is the trigger, what is the user-visible outcome. -->

## Target

- Files / dirs: <!-- concrete paths; mark `new file` if net-new (e.g. `packages/core/src/rcv/rcv.ts — new file`) -->
- Pattern to mirror: <!-- existing module the implementation should mirror in shape/naming -->

## ADRs to load

<!-- ADR numbers the agent must read before starting — at minimum the
     architectural ones the change touches (ADR-003 core boundary/seams,
     ADR-004 SII domain, ADR-005 identity/operate, ADR-006 auth).
     If a needed decision isn't an ADR yet, STOP and run /decision:new first. -->

- [ADR-NNN](docs/decisions/NNN-*.md)

## Acceptance criteria

<!-- Definition of Done. The PR description reuses these verbatim. -->

- [ ] <!-- Behavior: concrete CLI/MCP output or @albertomarturelo/sii-core API that works at the end -->
- [ ] <!-- Tests: which `<module>.test.ts` (vitest) exist; SII flows use SYNTHETIC fixtures (no real PII) -->
- [ ] <!-- Documentation: which of CONVENTIONS / STACK / ARCHITECTURE / CURRENT_STATUS / ROADMAP / sii-contract / new ADR is updated -->

## Reproduction (fixes only)

<!-- ONLY for `fix` issues. Minimal repro the agent can run, with expected vs.
     actual output. For SII bugs state whether the session was cached or fresh.
     Remove this section entirely if not a fix. -->

## Estimated sessions

<!-- 1 | 2–3 | 4+. If > 1, decompose into sub-issues before starting. -->

1
