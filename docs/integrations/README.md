# Integrations

Ready-to-use material for running this project inside someone else's agent: prompts,
knowledge bases and routines that drive the `sii` CLI. Nothing here is code. Each integration
consumes the published packages through the same public contract as any user:

- the **CLI**, with JSON on STDOUT and a JSON error with a stable `type` on STDERR (ADR-012);
- the **rules of the unattended login** (ADR-028): the Clave comes from a named source, a
  live session is reused, and a rejected Clave latches until a person lifts it.

The guardrails stay in the core (ADR-003). An integration can only add restrictions on top,
never remove one.

| Integration | What it is | Files |
| --- | --- | --- |
| [Contador bot](contador-bot/README.md) | An autonomous Chilean accountant agent (written for Grok, works with any agent that has a shell, a scheduler and memory): F29 deadline reminders, a monthly borrador, and a submit protocol gated on the user's explicit approval | `README.md` (setup), `prompt.md` (what to paste), `skill-init.md` (initialization), `skill-sii.md` (the knowledge base) |

## Keeping an integration current

An integration's knowledge base describes CLI commands, flags and error kinds. When a PR
changes one of those, it updates the affected `skill-*.md` **in the same PR**, so the file
published under a release tag always matches that release's binary. The bots read the file
at the tag of the version they have installed (see each integration's update routine).
