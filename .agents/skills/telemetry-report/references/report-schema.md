<!-- Token budget: ~650. Read only when building or debugging a reader of the published reports. -->

# Report schema: `cfd-telemetry/1`

Published by `scripts/telemetry.py --publish` to the orphan branch
`cfd-telemetry` of each repository. A central dashboard reads that
branch from every repository it tracks; nothing else is needed.

The branch names people and what they spent. It belongs in private
repositories only: the script refuses to publish from a public one.

## Layout

```
reports/<developer-id>/<YYYY-MM>.json   one file per developer and month
reports/<developer-id>/status.json      heartbeat of the last publish
```

`<developer-id>` is the lower-cased git `user.email`, or `anon-<hex>`
when published with `--anonymous`. One file per person and month means
two people never write the same file, so the branch never conflicts.
The same person on two machines merges by session key.

## Month file

```json
{
  "schema": "cfd-telemetry/1",
  "repo": "github.com/owner/name",
  "developer": {"id": "ana@example.com", "name": "Ana", "email": "ana@example.com"},
  "month": "2026-10",
  "sessions": {
    "<agent>:<session-id>": {
      "row": { ... },
      "buckets": [ ... ],
      "runs": [ ... ]
    }
  }
}
```

A session belongs to the month of its first day. Month files carry no
generation timestamp: an unchanged month is byte-identical.

### `row`: one session

| Field | Meaning |
|---|---|
| `a` | Agent: `claude`, `codex`, `copilot-cli` (later `copilot` for Copilot Chat in VS Code, `gemini`) |
| `d`, `start` | First day of the session (`YYYY-MM-DD`); no time of day is published |
| `active` | Active minutes; gaps over 5 minutes do not count |
| `turns` | Human turns (approximate) |
| `n`, `sub` | Model requests; how many of them ran in subagents |
| `models`, `branches` | Model ids and git branches seen, in order |
| `o`, `f`, `r` | Output tokens; fresh input (uncached input + cache writes); cache-read tokens |
| `ctx0`, `ctxmax` | Context size of the first request, and of the largest |
| `orient`, `edit_min` | Output + fresh input, and active minutes, before the first file edit; `null` if the session edited nothing |

### `buckets`: the session split by day and branch

`{"d": day, "b": branch, "n": requests, "i": uncached input, "o": output, "r": cache read, "w": cache write}`

Sum buckets, not rows, for totals by day or by task. The task is the
branch; an issue number is whatever digits the branch name carries.

### `runs`: stretches attributed to a skill

`{"d": day, "a": agent, "k": skill, "n": requests, "o": output, "f": fresh input, "r": cache read}`

Only agents that attribute requests to skills produce runs (Claude
Code today).

### Per agent

`copilot-cli` fills every `row` field. Its `turns` counts distinct
main-agent turn indexes; `orient` and `edit_min` start at the first
file edited with `apply_patch`, `edit` or `create`; it produces no
`runs`.

## `status.json`

`updated` (day of the last publish), `first_day`, `last_day`,
`sessions`, `agents`, and `health` (what the adapters could not read)
for the machine that published last. It changes once per day of
publishing even with no new session: a stale `updated` means "has not
reported", which is different from "did not use an agent".

## Readers

`scripts/central.py` is the reader shipped with the skill. It takes
local clones or git URLs, reads this branch from each, skips files
whose major version it does not know, and renders the dashboard with
the repository and the contributor as filters. A developer whose
`status.json` is older than `--stale-days` is shown as not reporting.

## Rules for readers

- Totals are additive across developers, repositories and agents in
  tokens. Money is not: price per provider, outside this schema.
- Reject a file whose `schema` major version you do not know.
- Aggregate by repository, task and week by default. Per-person rows
  explain a task's cost; they are not a ranking.
