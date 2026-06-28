<!-- Keep this template's sections — `/review-pr` parses them. English only. -->

## Summary

<!-- 1-3 sentences: what the PR changes and why. -->

## Linked issue

Closes #<!-- N -->

<!-- If no linked issue, replace this section with a justification.
     Most work should track an issue. -->

## Acceptance criteria

<!-- Copy verbatim from the issue body. Tick boxes as items land. -->

- [ ] <!-- behavior -->
- [ ] <!-- tests -->
- [ ] <!-- documentation -->

## ADRs touched

<!-- List the ADRs this PR depends on, supersedes, or amends.
     If you introduced a new decision, link the new ADR file.
     If none, write "none". -->

- ADR-NNN

## Test plan

<!-- Concrete commands a reviewer can run to validate locally.
     For SII flows, state explicitly whether tests hit live SII
     (they should NOT — recorded fixtures / synthetic data only,
     per CONVENTIONS.md). -->

```bash
pnpm install
pnpm build      # tsc -b (strict)
pnpm lint
pnpm test       # vitest — synthetic fixtures, no live SII
pnpm format:check
```

## Notes for the reviewer

<!-- Anything non-obvious in the diff, decisions deferred to a
     follow-up issue, observation sources for new selectors, etc. -->
