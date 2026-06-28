<!-- Slash command: /issue:start <issue-number>
     Pick up a GitHub issue as the focus of THIS session.
     Token budget: ~2,000–4,000 (issue + ADRs + 1 reference file).

     Repo slug: AltumStack/sii. -->

The user passes an issue number. If they don't, ask which (or list open
issues via `gh issue list --repo AltumStack/sii --state open`).

1. **Fetch the issue:** `gh issue view <n> --repo AltumStack/sii`

2. **Parse the 6 fixed sections:** `Context`, `Target`, `ADRs to load`,
   `Acceptance criteria`, `Reproduction` (fixes only),
   `Estimated sessions`. If any required section is missing, **STOP** and
   tell the user the issue is malformed — propose editing it before
   starting. Don't infer.

3. **For each ADR listed in `ADRs to load`**, read the file in
   `docs/decisions/`. These set the constraints the implementation must
   satisfy.

4. **Read the file in `Pattern to mirror` ONCE for shape.** Skim, don't
   study.

5. **Do NOT read the files listed in `Target` yet** — they are where the
   work goes, not where context comes from.

6. **Create the branch:** `git switch -c <type>/GH-<n>-<slug>` where
   `<type>` matches the issue's type label and `<slug>` is a short
   kebab-case summary.

7. **Summarize for the user**, exactly:
   - **Objective** (one line, from `Context`).
   - **Acceptance checklist** (verbatim — this is the DoD; copy to the PR
     description on submit).
   - **ADRs loaded** and what each constrains.
   - **Target paths** (the files you'll write to).
   - **Pattern to mirror**.
   - **Branch created**: `<type>/GH-<n>-<slug>`.

8. Ask: **"Ready to start?"**

If `Estimated sessions` > 1, remind the user the issue should have been
decomposed and ask whether to split it now via `/issue:new`.

**Token discipline:** do NOT scan target files or neighboring modules at
this step. The issue body + ADRs are the spec. Code reading happens when
implementation starts, not during orientation.
