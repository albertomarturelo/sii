# ADR-037: A model proposes issues — `proposed` in the repo, a redacted draft over the MCP

## Status

Accepted — 2026-11-20. Builds on ADR-001 (CFD issue rituals), ADR-004 (first-hand observation),
ADR-012 (error kinds), ADR-024 (where a surface goes), ADR-036 (`procedencia`).

## Context

A model meets work worth an issue in two places, and neither has a path today. In a Claude Code
session in this repo it sees a gap outside the current task; `issue-new` cannot help, because it
is the owner's interactive ritual (ten questions to a human, `disable-model-invocation`). A model
using the MCP (Claude Desktop or Code) meets a failing tool or a request no tool covers, and it
cannot see the repo at all: `@albertomarturelo/sii-mcp` ships to npm without `docs/`.

The history names the failures to avoid: of the closed issues, the 4 not planned were duplicates
of work in flight (#141, #142 of #139) or out of scope (#175, #176, a web dashboard). A model adds
its own risks: asserting SII wire facts it never observed (ADR-004), proposing a verb outside
ADR-024, and putting account state or PII into a public artifact (CONVENTIONS, leaked twice). The
MCP model also holds the user's real tax data, so redaction is its main risk.

## Decision

- **`proposed` means "not accepted by the owner yet".** A new label. `/issue-start` refuses an
  issue that carries it; the owner promotes by removing the label, or closes as not planned.
- **Repo channel: the skill `issue-propose`** (`.agents/skills/issue-propose/`), model-invocable.
  - Triggers: the user asks; a gap outside the current task's scope (instead of widening the PR);
    a `/live-check` mismatch.
  - Hard gates, all before `gh issue create`. A failed gate drops the proposal or changes its type:
    1. **Duplicate:** `gh issue list --state all --search` by verb, error kind and ADR; the
       queries run are listed in the body.
    2. **Scope:** ROADMAP non-goals and the « Where a new surface goes » table (ADR-024); a verb
       outside it, or a missing decision, is proposed as « Spike + ADR », never as a feature.
    3. **Evidence:** each claim is `código` (`file:line`), `observado por el mantenedor` (cited),
       or `hipótesis`. A wire hypothesis is only ever a `spike`, with the steps to observe it.
    4. **No account state, no PII:** no RUT, nombre, monto, folio, período or date tied to an
       account; synthetic Mod-11 RUTs only.
  - It creates the issue with `gh issue create --label proposed,<type>,<scopes>` in the fixed
    6-section body, so a promoted issue needs no rewrite. « Why it is worth it », the evidence and
    the searches go inside `## Context`; the section headers `/issue-start` parses stay untouched.
  - At most 3 proposals per session unless the user asks for more.
- **MCP channel: the model only recommends; the user publishes.**
  - The server sets `instructions` (2–3 lines): when a tool returns a reportable kind, or the user
    asks for something no tool does, read `sii://issues/guide` and offer a draft.
  - The resource `sii://issues/guide` classifies **every** `ErrorKind` as `not a sii bug` (the
    user can act: a rejected Clave, a rate limit, no session, the network), `likely bug`
    (`unexpected_response`, `unexpected`) or `suspect`, each with the condition that makes it a
    bug (`sii_error` on an old session was one, #287). The guide's table is the classification.
  - Redaction: a draft describes the SHAPE, never values. It carries the package version, the tool
    name, the `type` and the step; never a RUT, nombre, monto, folio, período, dirección or SII's
    raw body.
  - It ends with two links: a GitHub search (tool + `type`) to rule out a duplicate, and the
    `bug_report` / `feature_request` template, which gain the `proposed` label.
- **One source.** The guide is `packages/mcp/issue-guide.md`, added to the package's `files` and
  read at runtime the way `server.ts` reads `package.json`. `issue-propose` reads the same file and
  adds the repo-only parts (the `gh` searches, the evidence classes, ADR-024, worked examples: #291
  and #237 good, #175 and #141 not). `issue-kinds.ts` classes every kind as a
  `Record<ErrorKind, …>` (a new kind fails the typecheck), and a test keeps the guide's table equal.
- `sii://issues/guide` is a resource, not a verb, so ADR-024's table does not apply. It is
  user-visible: a `CHANGELOG` line, and the release is a MINOR.

## Alternatives Considered

1. **Draft only, the human creates.** Rejected by the owner: a draft in the chat dies with the
   session. The label, and `/issue-start` refusing it, keep a proposal from becoming work.
2. **The model creates freely.** Rejected: indistinguishable from accepted work, and
   `/issue-start` would pick it up.
3. **Run `issue-new` non-interactively.** Rejected: enabling model invocation on the owner's ritual
   lets a model create accepted work units unprompted; the two flows have different owners.
4. **A user-invoked MCP prompt (`report_issue`).** Rejected: the model never offers it, so most
   failures go unreported.
5. **A tool, or an error field, returning a diagnostic redacted in code.** Deferred, not rejected:
   the strongest rail, but it amends ADR-012's error contract. It may layer on this guide later.
6. **A TS constant, or two separate texts.** Rejected: prose in a `.ts` is awkward for the skill;
   two texts drift, and nothing in CI would notice.

## Consequences

- Easier: a gap found mid-task becomes an issue instead of scope creep or a lost note, and a
  Desktop user gets a ready, redacted report instead of « something failed ».
- **Accepted risk:** a `proposed` issue is public the moment it is created, before the owner reads
  it. Gate 4 is the model's own check, not code; GitHub's edit history keeps a scrubbed text, so a
  leak means deleting the issue. Under a harness that asks before `gh issue create`, the user sees
  the body first.
- The MCP channel relies on the model following `instructions`; a client that ignores them gets
  no guidance. The user still reads the draft before publishing it.
- Obligations, two PRs: (1) the label, `issue-guide.md` and its `ErrorKind` test,
  `issue-propose`, the `/issue-start` refusal and the CONVENTIONS line (repo-only, no CHANGELOG);
  (2) the guide in the package's `files`, `instructions`, the resource, the templates' `proposed`
  label and a CHANGELOG line.
