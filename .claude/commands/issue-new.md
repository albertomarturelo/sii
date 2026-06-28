<!-- Slash command: /issue:new
     Create a self-sufficient unit of work in GitHub Issues.
     Token budget for the full flow: ~1,500–3,000.

     The completeness of this issue determines how cheaply the NEXT
     session starts. Be thorough HERE so you can be cheap THERE. -->

Guide the user through creating a new GitHub issue on `AltumStack/sii`
using the fixed 6-section body template.
Ask, in order, and confirm each answer before moving on:

1. **Type.** `feature` | `fix` | `chore` | `docs` | `spike`
2. **Title.** Imperative mood, ≤80 chars, English. e.g.
   "Add rut parser + Mod-11 DV to @sii/core".
3. **Context.** 2–4 sentences: what is the trigger, what is the
   user-visible outcome.
4. **Target location.** Concrete paths. For net-new, name the package +
   file (e.g. `packages/core/src/rut.ts — new file`).
5. **Reference pattern.** An existing file/module to mirror in shape,
   naming, and conventions. Skip ONLY if no analog exists; flag it.
6. **ADRs to load.** ADR numbers the agent must read before starting.
   At minimum the architectural ones the change touches: `ADR-003` for
   anything crossing the core boundary / ports, `ADR-004` for any SII
   domain code, `ADR-005` for identity/operate, `ADR-006` for auth.
   **If a needed decision isn't an ADR yet, STOP and run `/decision:new`
   first.**
7. **Acceptance criteria (DoD).** Bulleted markdown `[ ]` items.
   Include all three of:
   - **Behavior** — what works at the end (concrete CLI/MCP/plugin output
     or `@sii/core` API).
   - **Tests** — what tests exist (`<module>.test.ts`, vitest); state
     explicitly that fixtures are **synthetic** (no real PII).
   - **Documentation** — which of `CONVENTIONS.md`, `STACK.md`,
     `ARCHITECTURE.md`, `CURRENT_STATUS.md`, a `sii-contract/*.md`, or a
     new ADR is updated.
8. **Reproduction steps.** ONLY for `fix`. Minimal repro to confirm the
   bug (state whether the session was cached or fresh for SII bugs).
9. **Estimated sessions.** `1` | `2–3` | `4+`. If > 1, **propose
   decomposition into sub-issues before continuing.**
10. **Labels.** Type label + scope labels (`core`, `cli`, `mcp`, `auth`,
    `portal`, `identity`, `docs`, `tests`).

Then generate the body using the fixed template (do NOT deviate from
section order or names — `/issue:start` parses by section header):

```markdown
## Context
<step 3>

## Target
- Files / dirs: <step 4>
- Pattern to mirror: <step 5>

## ADRs to load
- ADR-NNN

## Acceptance criteria
- [ ] <step 7>

## Reproduction (fixes only)
<step 8 — OR omit this section entirely if not a fix>

## Estimated sessions
<step 9>
```

Then run:

```bash
gh issue create --repo AltumStack/sii \
  --title "<step 2>" --body "<body above>" \
  --label "<step 1>,<step 10 scopes>"
```

Output the issue URL when done. **English only.**
