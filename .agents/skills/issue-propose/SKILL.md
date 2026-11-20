---
name: issue-propose
description: "Propose a GitHub issue on albertomarturelo/sii, labelled `proposed`, after four gates (duplicate, scope, evidence, no PII or account state). Use when the user asks for an issue to be proposed, when work outside the current task's scope turns up, or when a /live-check finds a mismatch. Never for work the owner already asked to start (that is issue-new)."
metadata:
  cfd-version: "0.4.0"
  token-budget: "~2,000–4,000 (guide + searches + body)"
---

A model's path to an issue (ADR-037). The issue is public the moment it exists, so every gate
runs BEFORE `gh issue create`. A `proposed` issue is not accepted work: `/issue-start` refuses it
until the owner removes the label.

**Budget:** at most 3 proposals per session unless the user asks for more. When the gap turned up
mid-task, propose it and go back to the task: never widen the current PR instead.

## 0. Read the shared rubric

Read `packages/mcp/issue-guide.md`: what is worth an issue, the error-kind classes, the
non-goals and the redaction rule. The MCP serves the same file, so both channels judge alike.

## 1. Name the candidate

One line: what is wrong or missing, and what triggered it (the user, a gap mid-task, a
`/live-check` mismatch). If you cannot say who benefits, drop it.

## 2. Gate — duplicate

Run at least two searches over open AND closed issues, by different terms (the verb or tool, the
error kind or file, the ADR):

```bash
gh issue list --repo albertomarturelo/sii --state all --search "<terms>" --limit 20 \
  --json number,title,state,stateReason
```

Also read the matching `docs/ROADMAP.md` row. An open issue that covers it: stop and point the
user to it. One closed as not planned: stop, unless you hold evidence it did not have, and then
say what is new. Keep the queries: they go into the body.

## 3. Gate — scope

- A non-goal in the guide or in ROADMAP « Where we're going »: drop it.
- A new verb or MCP prefix not in ROADMAP « Where a new surface goes » (ADR-024), or a choice
  between plausible patterns with no ADR: the type is `spike` and the title starts
  « Spike + ADR: ». Never a `feature`.

## 4. Gate — evidence

Tag every claim in the body with its class:

- **código**: `file:line` you read in this session;
- **observado por el mantenedor**: cited from a `sii-contract/*.md`, an ADR or a scenario with
  `por: 'mantenedor'` (ADR-036);
- **hipótesis**: anything else.

A hipótesis about SII's wire (an endpoint, a field, a código, a behaviour) makes the issue a
`spike`, with the steps the owner would follow to observe it. Never probe the live SII to
"check": live observation is the owner's (`/live-check`). A `fix` needs a reproduction from code
or a synthetic test.

## 5. Gate — no PII, no account state, no attribution

Apply the guide's redaction rule plus CONVENTIONS « No account state in a public artifact »:
no RUT but synthetic Mod-11 ones, no nombre, monto, folio, período or date tied to an account,
no « which months were filed ». No AI attribution (CLAUDE.md absolute rule): never name an AI
tool as the author, generator or source of the proposal. Naming the MCP client a bug happened in
is an environment fact, not attribution. Re-read the final body for this gate alone before creating.

## 6. Size

`Estimated sessions` > 1: propose the first slice only and name the rest in `## Context`.

## 7. Create

Use the fixed 6-section body of `issue-new` (`/issue-start` parses it by header; do not add
sections). The proposal's own reasoning goes inside `## Context`:

```markdown
## Context
<2–4 sentences: trigger and user-visible outcome>

- **Worth it:** <who benefits, what it unblocks>
- **Evidence:** <claim> (código `path:line`) · <claim> (hipótesis)
- **Searched:** `<query 1>`, `<query 2>` — <closest existing issue, or none>

## Target
## ADRs to load
## Acceptance criteria
## Reproduction (fixes only — omit the section otherwise)
## Estimated sessions
```

Show the body to the user, then:

```bash
gh issue create --repo albertomarturelo/sii --title "<imperative, ≤80 chars, English>" \
  --body-file <a temporary file> --label "proposed,<type>,<scopes>"
```

Output the URL and how the owner promotes it: `gh issue edit <n> --remove-label proposed`.

## Never

Remove `proposed`, assign, set a milestone, edit or comment on another issue, close anything, or
start work on the proposal.
