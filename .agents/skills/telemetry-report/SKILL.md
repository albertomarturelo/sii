---
name: telemetry-report
description: "Build the local agent-telemetry dashboard for this project from the session logs coding agents already keep: tokens per day, task, skill and session, and before/after medians around context changes. On request, publish a counters-only monthly report to the cfd-telemetry branch so a central dashboard can read it. Use when asked about agent usage, token consumption, or whether a context change made sessions cheaper."
argument-hint: "[publish]"
metadata:
  token-budget: "~1,000 (the script runs outside the context; never read it)"
---

Run the bundled script. **Do not read `scripts/telemetry.py` or
`scripts/dashboard.html` into context**: running them costs nothing,
reading them costs ~15,000 tokens.

1. **Build the dashboard:**

   ```bash
   python3 .agents/skills/telemetry-report/scripts/telemetry.py --open
   ```

   If this skill was installed somewhere else (a plugin, a user-level
   skills folder), run `scripts/telemetry.py` from the folder that
   holds this file, and pass the project directory as its argument.
   It writes `.cfd/telemetry/index.html` and prints a summary.

2. **Relay the summary, then the gaps.** Every `note` line is something
   the script could not read or had to infer. Report those as plainly
   as the totals: a format change in an agent shows up there first.

3. **Keep the output per-developer.** If the script warns that
   `.cfd/` is not git-ignored, add `.cfd/` to `.gitignore`.

4. **Publish only when the user asks** (`/telemetry-report publish`):

   ```bash
   python3 .agents/skills/telemetry-report/scripts/telemetry.py --publish
   ```

   This commits `reports/<git user.email>/<YYYY-MM>.json` to the local
   `cfd-telemetry` branch through git plumbing; the checkout is not
   touched. Show the user `git show --stat cfd-telemetry`, state what
   leaves the machine (below), and wait for an explicit yes before
   re-running with `--publish --push`. Never force-push that branch.

   **Never publish from a public repository.** The branch would show
   per-person usage and git identities to everyone. The script refuses
   when the forge reports the repo as public; when it cannot tell (it
   prints a warning), ask the user and do not push until they confirm
   the repo is private. Do not pass `--allow-public` on your own.

## What the data source is, per agent

The skill installs the same way for every agent (`.agents/skills/`,
with `.claude/skills` as a symlink). What differs is where each agent
keeps its numbers:

| Agent | Source | To enable |
|---|---|---|
| Claude Code | `~/.claude/projects/` transcripts | Nothing |
| Codex | `~/.codex/sessions/` rollouts | Nothing |
| Copilot (VS Code) | OpenTelemetry file export | Set `github.copilot.chat.otel.exporterType` to `file` and `github.copilot.chat.otel.outfile` to an absolute path outside the repo. **No adapter ships yet**: enabling it now only starts the history. |
| Gemini CLI | Telemetry `outfile` in `.gemini/settings.json` | No adapter yet |

Any agent can run this skill and report on every agent's sessions:
the script reads logs, it does not ask the running agent for anything.

## What a published report contains

Counters per session: tokens by type, request and turn counts, active
minutes, context size, the day (never the time of day), branch names,
skill names, model names. The developer is the git identity, so a task
shared by several people adds up per person and per agent. Never
prompts, responses, file contents or paths. `--anonymous` replaces the
identity with a random id; forge admins can still see who pushed.
Schema: [references/report-schema.md](references/report-schema.md).

## Rules for reading it

- **Adherence first.** Read "context at first request" and "tokens
  before first edit" before any total. Totals say how much was spent;
  those two say whether the context is doing its job.
- **Before/after rows with fewer than 3 sessions on a side are
  anecdotes.** Say so; do not draw a conclusion from them.
- **Run it at least monthly.** Agents delete their own logs (Claude
  Code after 30 days); the script keeps a local history, but only of
  what it saw.
- **Never rank people.** Per-person numbers explain a task's cost;
  they do not measure the person.
