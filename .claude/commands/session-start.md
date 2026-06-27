<!-- Slash command: /session:start (alias: /project:status)
     Invoke at the BEGINNING of every working session.
     Token budget: ~500–1,500. -->

Read the following files in order, then produce a brief summary:

1. `docs/CURRENT_STATUS.md` — what is in progress, what is blocked, what
   is next.
2. `docs/decisions/_index.md` — any recent decisions that might affect
   current work.

Then state:

- What was being worked on at the last session close.
- What is currently blocked and why.
- What should be the focus of THIS session.

Do **NOT** read source code files yet. The point of this command is to
orient yourself in O(1k) tokens, not O(50k). Source code reading happens
after the focus is chosen.

If `docs/CURRENT_STATUS.md` was last updated more than 1 working day ago,
warn the user that the context may be stale before proceeding.
