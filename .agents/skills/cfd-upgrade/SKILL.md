---
name: cfd-upgrade
description: "Upgrade this project's CFD artifacts: read the installed version from the skills and the scaffold, fetch the CFD changelog, show what changed since, and apply each release's Upgrade steps in order after the user approves. Invoke explicitly; it changes committed files."
disable-model-invocation: true
metadata:
  cfd-version: "0.4.0"
  token-budget: "~1,500 plus the changelog entries read (~300 each)"
---

Upgrade the CFD skills and scaffold of this repository to the latest
release, one changelog entry at a time. Nothing is changed before the
user approves the plan.

1. **Installed version.** Run:

   ```bash
   grep -h '^  cfd-version:' .agents/skills/*/SKILL.md | sort | uniq -c
   grep -h 'CFD version:' CLAUDE.md .claude/hooks/*.sh .github/workflows/*.yml 2>/dev/null | sort | uniq -c
   ```

   One version everywhere is the installed version. Several versions
   mean a partial upgrade: the installed version is the lowest. No
   stamp at all means a release older than 0.3.0: treat it as 0.2.0 if
   `.agents/skills/` exists, 0.1.0 if procedures live in
   `.claude/commands/`.

2. **Latest version and changelog.** Fetch:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/albertomarturelo/context-first-development/main/.claude-plugin/plugin.json | grep '"version"'
   curl -fsSL https://raw.githubusercontent.com/albertomarturelo/context-first-development/main/CHANGELOG.md
   ```

   If both versions match, say so and stop. Otherwise keep only the
   entries newer than the installed version.

3. **Show the plan, then wait.** For each pending entry, oldest first:
   its version, its Added/Changed/Removed lines, and its Upgrade steps
   verbatim. Flag every step that touches a file this project has
   edited since installing it (`git log --oneline -- <path>` shows
   commits other than the install). Ask for an explicit yes before
   step 4.

4. **Apply, oldest entry first.** Run each Upgrade step as written.
   Three rules override any step:
   - `CLAUDE.md`, `AGENTS.md` and `docs/` are the project's own
     context: apply the described edit by hand, never overwrite them.
   - A hook, workflow or skill the project edited: show the diff
     against the new template and let the user choose per file.
   - Skills installed through the Claude Code plugin (`/cfd:*`) or
     `npx skills add` are updated by their installer, as the entry
     says; apply only the scaffold steps here.

5. **Verify and commit.** The checks from step 1 must print one
   version, the latest. Then run `/validate-context`. Commit the
   upgrade on its own, with the versions crossed and the entries
   applied in the message, and no code changes mixed in.

Do not skip an intermediate entry: a later release assumes the earlier
Upgrade steps ran. Do not downgrade. If the changelog cannot be fetched,
stop and say so; do not guess the steps.
