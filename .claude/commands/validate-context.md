<!-- Slash command: /context:validate
     Invoke periodically (weekly recommended) to check context integrity.
     Token budget: ~2,000–5,000. -->

Validate the CFD context in this project. Check, in order, and output a
checklist with PASS / WARN / FAIL per item:

1. **`CLAUDE.md` size**: WARN if >150 lines, FAIL if >300.
2. **`CLAUDE.md` content shape**: should be mostly `@references`, not
   paragraphs of prose. FAIL if any section has >10 lines of inlined
   content where an `@docs/...` reference would do.
3. **`docs/CURRENT_STATUS.md` freshness**: run
   `git log -1 --format=%ar -- docs/CURRENT_STATUS.md`. WARN if older
   than 2 working days; FAIL if older than 1 week.
4. **ADR index integrity**: every file matching
   `docs/decisions/[0-9]*.md` must be listed in
   `docs/decisions/_index.md`, and every row in `_index.md` must point to
   a file that exists. FAIL on mismatch.
5. **ADR completeness**: every ADR has Status, Context, Decision,
   Alternatives Considered, Consequences sections. FAIL on any ADR
   missing one.
6. **Convention coverage**: spot-check 3 random source files. Do their
   patterns match `docs/CONVENTIONS.md`? If not, propose updates to
   CONVENTIONS.md (do not auto-apply).
7. **Surface boundary (ADR-003)**: spot-check that `packages/cli` and
   `packages/mcp` import only `@sii/core`'s task layer (+ port
   interfaces), never a portal/dte/auth/storage facade directly. Flag any
   reach-past — it bypasses the throttling / audit / credential rails.
8. **Language check**: any `docs/**/*.md` file written in a non-English
   language? WARN per file.

Output the checklist and propose concrete fixes for any failures.
Do NOT auto-apply fixes — the user reviews first.
