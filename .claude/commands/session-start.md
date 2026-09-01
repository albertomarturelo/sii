<!-- Slash command: /session:start (alias: /project:status)
     Invoke at the BEGINNING of every working session.
     Token budget: ~500–1,500. -->

Read the following files in order, then produce a brief summary:

1. `docs/ROADMAP.md` — the surface checklist: what is shipped (✅), in
   progress (🚧), blocked (🔒) and planned (📋).
2. `docs/decisions/_index.md` — any recent decisions that might affect
   current work.
3. `git log --oneline -10` + `gh issue list --state open` — what actually
   moved last, and what is still open.

Then state:

- What was being worked on at the last session close.
- What is currently blocked and why.
- What should be the focus of THIS session.

Do **NOT** read source code files yet. The point of this command is to
orient yourself in O(1k) tokens, not O(50k). Source code reading happens
after the focus is chosen.

Derive "what was last worked on" from the recent commits and open issues,
not from a status file: `docs/CURRENT_STATUS.md` is NOT versioned (untracked
since #79) and may be absent or stale. If the last commit is more than a few
days old, say so — the context may have moved on outside this repo.
