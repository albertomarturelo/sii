---
name: telemetry-report
description: "Build the local agent-telemetry dashboard for this project from the session logs coding agents already keep: tokens per day, task, skill and session, and before/after medians around context changes. On request, publish a counters-only monthly report to the cfd-telemetry branch so a central dashboard can read it. Use when asked about agent usage, token consumption, or whether a context change made sessions cheaper."
argument-hint: "[publish | team]"
metadata:
  cfd-version: "0.4.0"
  token-budget: "~1,500 (the scripts run outside the context; never read them)"
---

Run the bundled scripts. **Do not read `scripts/telemetry.py`,
`scripts/central.py` or `scripts/dashboard.html` into context**: running
them costs nothing, reading them costs ~21,000 tokens.

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

5. **Team view, only when the user asks** (`/telemetry-report team`):

   ```bash
   python3 .agents/skills/telemetry-report/scripts/central.py <repo> [<repo> ...]
   ```

   Each `<repo>` is a local clone or a git URL whose `cfd-telemetry`
   branch holds published reports. It writes `.cfd/team/index.html`:
   the same dashboard with contributor and repository filters, and a
   footer naming who has not reported in `--stale-days` (14). The page
   names people: keep it out of git and do not paste per-person figures
   into issues or PRs. Contributors appear alphabetically; never order
   or compare them by consumption
   ([agent-telemetry-from-local-logs](https://github.com/albertomarturelo/context-first-development/blob/main/adrs/ai-workflow/agent-telemetry-from-local-logs.md), rule 7).

## What the data source is, per agent

The skill installs the same way for every agent (`.agents/skills/`,
with `.claude/skills` as a symlink). What differs is where each agent
keeps its numbers:

| Agent | Source | To enable |
|---|---|---|
| Claude Code | `~/.claude/projects/` transcripts | Nothing |
| Codex | `~/.codex/sessions/` rollouts | Nothing |
| Copilot CLI | `~/.copilot/session-store.db`, its usage table only | Nothing. Versions that record no usage (the summary says so) need a CLI update; their earlier sessions stay uncounted. Never open the store or `session-state/` yourself: they hold prompts and responses. |
| Copilot (VS Code) | OpenTelemetry file export | Ask the developer to set three VS Code user settings (never change them yourself): `github.copilot.chat.otel.enabled` to `true`, `github.copilot.chat.otel.exporterType` to `file`, `github.copilot.chat.otel.outfile` to an absolute path outside any repo; reload the window; run one short agent-mode session in a git repo with a GitHub remote, one turn editing a file; report the outfile path back. **The script finds that export and says whether one exists, but does not read it yet**: this starts the history. |
| Gemini CLI | Telemetry `outfile` in `.gemini/settings.json` | No adapter yet |

Any agent can run this skill and report on every agent's sessions:
the script reads logs, it does not ask the running agent for anything.
Copilot CLI and Copilot Chat are separate agents (`copilot-cli`,
`copilot`); `COPILOT_OTEL_FILE_EXPORTER_PATH` is shared by both, so the
script never attributes an export to Copilot Chat through it.

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
