# Contributing

Thanks for your interest. This is a personal open-source project (MIT — see
[`LICENSE`](LICENSE) and [ADR-018](docs/decisions/018-public-release-mit-license.md)).
Contributions are welcome; please read the context layer first — it is not
boilerplate, it is how the project stays coherent.

## Read first

- [`CLAUDE.md`](CLAUDE.md) — the project's critical rules (they override defaults).
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the non-negotiable realities of
  SII and the two-surfaces-one-core design.
- [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) — code style, architecture patterns,
  SII domain rules, security & PII rules. **This file is the source of the rules;
  everything below points at it rather than restating it.**
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what is shipped, in progress, or planned,
  plus the "Where a new surface goes" placement table.
- [`docs/decisions/`](docs/decisions/) — the ADRs. Decisions are recorded *before*
  code (Context-First Development, ADR-001).

## The CFD ceremony

This repo runs under **Context-First Development** ([ADR-001](docs/decisions/001-adopt-cfd-methodology.md)):
the context layer is read before code is written, and every step of the workflow
has a written procedure. Those procedures live in [`.claude/commands/`](.claude/commands/)
as slash commands.

**You do not need Claude Code to contribute.** Each command is a plain markdown
file describing steps you can follow by hand. The checklists in those files are
the contract; the slash command is only the convenience that runs them for you.

Run them in this order:

1. **`/session:start`** — orient: `ROADMAP.md`, the ADR index, open issues. Produces
   a ~1k-token picture of what moved last and what is blocked. *Optional, but it is
   how you avoid duplicating work already in flight.*
2. **`/issue:new`** — the unit of work, written in the fixed **6-section body**
   (`Context`, `Target`, `ADRs to load`, `Acceptance criteria`, `Reproduction`
   (fixes only), `Estimated sessions`). Produces the GitHub issue. *Mandatory —
   `/issue:start` parses that body by section header, so a free-form issue cannot
   be picked up. Open the issue before you write code.*
3. **`/issue:start <n>`** — loads the issue and **its listed ADRs before touching
   code**, then creates the branch. Produces the branch + the acceptance checklist
   you will paste into the PR. *Mandatory — the ADRs named in the issue are the
   constraints your implementation has to satisfy.*
4. **`/decision:new`** — run this **before implementing any decision that has no
   ADR yet**: adding a dependency, moving a layer boundary, choosing between two
   plausible patterns, or naming a new surface. Produces `docs/decisions/NNN-*.md`
   (≤100 lines, 5 mandatory sections) plus its `_index.md` row. *Mandatory for such
   changes, and the **ADR lands in the same PR as the code — never after**.*
5. **`/context:validate`** — the same guards CI runs (ADR index integrity, ADR
   completeness, the core boundary, third-party SII, PII), plus context-layer
   health. Produces a PASS/WARN/FAIL checklist. *Run it before every push.*
6. **`/review-pr <n>`** — **self-review against the ADRs + `CONVENTIONS.md` + your
   issue's acceptance criteria, BEFORE opening the PR**, and again after every
   push. Produces the structured report below. *Mandatory. The maintainer runs the
   identical command on your PR, so a clean self-review is what makes the
   maintainer's review a confirmation instead of a first pass.*
7. **`/session:close`** — close out: tick the `ROADMAP.md` row, fold any correction
   into `CONVENTIONS.md`, propose an ADR for anything decided informally. Produces a
   session summary you can paste into the PR description. *Run it when you stop
   working, not only when you finish.*

## The PR checklist

This is [`.claude/commands/review-pr.md`](.claude/commands/review-pr.md) in
checklist form. **The checklist is the contract**; run it by hand if you do not use
Claude Code. Every item cites the rule it enforces.

### GitHub workflow

- [ ] Branch matches `<type>/GH-<issue>-<slug>` (`type` ∈ `feature` / `fix` /
      `chore` / `docs` / `spike`).
- [ ] PR body contains `Closes #<issue>`.
- [ ] PR title is Conventional Commits, subject ≤72 chars; every commit likewise.
- [ ] **No AI attribution** anywhere — commits, title, body, comments, branch
      names, code comments, docs. Any occurrence blocks the merge.
- [ ] English everywhere.

### Architecture (ADR-002 / ADR-003 / ADR-016)

- [ ] `packages/cli` and `packages/mcp` import only `@albertomarturelo/sii-core`'s
      **task layer** (plus `/node`, and `/cli` from the CLI only) — never a
      portal/DTE facade. Reaching past tasks bypasses the throttling, audit and
      credential rails.
- [ ] The core's **pure main barrel** imports no `node:*` and no Playwright at
      import time; Node-only code lives behind the `./node` subpath or a seam.
- [ ] **No hard-coded SII hostnames** outside the core config module (grep the diff
      for `sii.cl`, `palena`, `zeusr`, `misiir`).
- [ ] Adapters are injected at a surface composition root — no global singletons
      reaching into the core.

### SII contract (ADR-004)

- [ ] **No third-party SII libraries** (`cl-sii`, `libredte`, `python-sii`,
      `dansanti`, …). Any hit blocks the merge.
- [ ] Every selector / endpoint / payload constant added carries an observation
      citation: `// observed at <URL> on <YYYY-MM-DD>`. Missing = blocked.
- [ ] Auth detection is **URL-based** (`zeusr.sii.cl` ⇒ not authenticated), never
      DOM-marker based. **No retry after a login failure or a rate-limit block.**
- [ ] A new surface ships its wire contract under `docs/sii-contract/`.

### Identity & secrets (ADR-005 / ADR-006)

- [ ] Only the login task mints a session; domain tasks consume one via
      `withSession` or raise `NotAuthenticated`.
- [ ] No MCP tool accepts a password argument. Secrets and sessions are reached
      only through the `SecretStore` / `KeyValueStore` seams.
- [ ] `operate` selects and never mints; a `--rut` override is validated against the
      operable set; the operating RUT stays visible.
- [ ] The surface's auth mode (session-keyed / body-RUT / empresa-keyed / public) is
      declared on the first line of its `--help` (ADR-024).

### Credentials & PII

- [ ] No hard-coded credentials, RUTs, passwords, cookies or tokens. Any RUT in
      source or fixtures is **synthetic and Mod-11-valid** (`11111111-1`,
      `12345670-K`, `20000042-0`).
- [ ] No real PII in fixtures, tests, comments, commit messages or the PR body.
- [ ] `.gitignore` still blocks `*.pfx`, `*.p12`, `.env`, `.sii/`.
- [ ] A payload whose non-curated fields are PII exposes **no `raw`** — prefer
      dropping `raw` over a denylist whenever the own-PII field set cannot be proven
      complete.

### TypeScript

- [ ] `strict` honored (plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`):
      no `any` without an inline justification; `unknown` + narrowing at boundaries.
- [ ] ESM, named exports, `.js` on relative imports (NodeNext — ADR-009).
- [ ] No `console.log` in `@albertomarturelo/sii-core`; `console` belongs to surface
      output only.
- [ ] `pnpm build`, `pnpm lint`, `pnpm format:check` are clean.

### Testing

- [ ] New logic has vitest tests (`<module>.test.ts`) with **synthetic** fixtures.
- [ ] Tests never hit production SII; any live check is gated behind an explicit
      env var.
- [ ] Every new conditional branch and error path in the core is exercised.

### Documentation (ADR-001)

- [ ] A new convention → `CONVENTIONS.md` updated **in the same commit**.
- [ ] A new decision → its ADR **before** the implementation, in the same PR;
      superseded ADRs updated.
- [ ] `ARCHITECTURE.md` updated if the module map changed; `STACK.md` if a
      dependency was pinned or a TBD resolved.
- [ ] `ROADMAP.md` reflects what shipped — **in its own commit** (see below).

## Workflow rules

- **Open an issue first**, in the 6-section body. It is the spec the PR is measured
  against.
- **Branch as `<type>/GH-<n>-<slug>`** — e.g. `feature/GH-77-rcv-all`,
  `docs/GH-94-contributing`. **Open the branch under its final name.** Renaming a
  branch that already has an open PR **closes that PR**: GitHub does not repoint an
  existing PR's HEAD, so the work has to be reopened under a new number and the
  review history is lost. This is what happened to the repo's first outside
  contribution.
- **`Closes #<n>` in the PR body**, so the issue closes on merge.
- **Conventional Commits**, subject ≤72 chars, one topic per commit.
- **One feature per PR — and here is the mechanism when a second one appears.** A
  second feature that *depends* on the first **waits for the first to merge**, then
  goes up on its own branch cut from the updated `main`. It is never bundled into
  the first PR, and it is never cherry-picked onto today's `main` to dodge the wait.
  "It conflicts with `main` today" is not a reason to bundle — it is the reason the
  sequencing exists. (`CONVENTIONS.md` calls this "stacked"; for a fork PR, stacked
  means *sequenced after the first merge*, not two features in one branch.)
- **English everywhere** — commits, branches, PR titles and bodies, code comments,
  docs. Spanish stays only where it is the domain term (`boletaHonorarios`,
  `propuestaF29`) and in the user-facing `README.md`.
- **No AI attribution in any artifact** that lands in git or on GitHub — no
  `Co-Authored-By`, no "Generated with", no 🤖, in commits, PR titles/bodies/comments,
  issues, branch names, code comments or docs. Authorship is the human contributor.
- **Status docs go in their own commit.** `ROADMAP.md` bookkeeping is never bundled
  with feature code; the feature commit carries the code plus its tightly-coupled
  docs (the ADR, any `sii-contract/*.md`).
- **A rename PR gates on a prose residue search, not only on `typecheck`.** Renaming
  a verb, a flag or a module means grepping every old name across **code, comments,
  docs, help text and error strings** before committing — `tsc` cannot see a verb
  inside a string literal, and a rename has already shipped with stale error text
  that told the user to run a command that no longer existed.

## Where new code goes

- **Layout and dependency direction** ([ADR-007](docs/decisions/007-modular-core-layout.md)):
  `config` / `rut` / `errors` / `seams` are leaves; `audit` / `auth` / `identity` /
  `portal/*` depend on leaves and seams; `tasks/` composes them and is the public
  API the surfaces call. **A domain module never imports another domain module's
  internals** — cross-module composition happens only in `tasks/`.
- **Adding a surface is mostly new files:** `portal/<surface>/*`, `tasks/<mod>.ts`,
  `cli/src/commands/<mod>.ts` (`register<Mod>`), `mcp/src/tools/<mod>.ts`
  (`register<Mod>Tools`). The only shared edit is **one append-only line** in each
  registry — that is what keeps parallel branches from colliding.
- **Naming** ([ADR-024](docs/decisions/024-surfaces-named-by-artifact.md)): the
  top-level CLI verb / MCP prefix is the **SII artifact** (`f29`, `rcv`, `dte`,
  `bte`), never the portal or the transport (`mipyme`, `sdi`), and never a document
  subclass of an artifact that already has a verb. Document types are numeric
  parameters (`--tipo 61`), not verbs. `ROADMAP.md` § "Where a new surface goes" is
  the placement table — **a verb that is not in it needs an ADR before it lands.**
- **MCP/CLI parity:** a new capability ships both surfaces in the same PR unless
  there is an explicit reason for a CLI-only carve-out (an interactive prompt, or a
  task that takes a Clave). Put the logic in the task layer and both surfaces get it.

## What CI checks — and what it does not check on your fork

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs two jobs on every PR:

- **Build + Lint + Format + Test** — `pnpm build` (`tsc -b`), `pnpm lint`,
  `pnpm format:check`, `pnpm test`.
- **Validate context** — ADR index integrity, ADR completeness (the 5 mandatory
  sections), the ADR-003 surface boundary guard, the no-third-party-SII guard, and
  the PII guard.

**The PII guard self-skips on fork PRs.** Its denylist of real RUT digit-bodies
lives in a repo secret (`PII_RUT_DENYLIST`) precisely because the workflow file is
public, and GitHub does not expose repo secrets to workflows running from a fork. So
on your PR that step prints `skipping` and passes **without having checked
anything**. The maintainer runs it before merge. Do not read a green check as
confirmation that your diff is PII-clean — that remains your responsibility, and
`CONVENTIONS.md` § "Security, secrets & PII" is the standard.

### What "live-validated" must mean in a PR body

Most of this project cannot be verified against a fixture alone: the SII portal is
the source of truth and it changes without notice. If your PR body says a path was
live-validated, it must say **which paths ran against production SII, which are
covered by fakes only, and on what date** — for example: "*`dte emitidos` +
`dte pdf` live-validated 2026-09-08 against a real empresa RUT; the malformed-row
parser is fake-only.*" An unqualified "tested" is not reviewable.

If you write a script to probe the live portal:

- **Scrub every error.** Wrap the top level in `try` / `catch` and print only a
  redacted `message` — **never the error object**. Playwright attaches the request
  headers to its errors, and those headers carry the live session cookies (`TOKEN`,
  `CSESSIONID`, the `NETSCAPE_LIVEWIRE.*` set). The repo's `AuditSink` drops keys
  matching `password|clave|cookie|secret|token`; an ad-hoc probe has no such guard,
  and one has already leaked cookies to a terminal.
- **Redact RUTs and names before output**, in the script itself.
- **Never paste raw probe output into an issue, a PR or a commit.**
- `sii auth status` reads the **local** session file; `sii auth status --refresh` is
  the actual liveness check against the portal.
- Probes are throwaway: they belong in a scratch directory, never in the repo.

## Local development

```bash
pnpm install          # install dependencies
pnpm build            # tsc -b (typecheck + build all packages)
pnpm test             # vitest
pnpm lint             # eslint
pnpm format           # prettier --write

# one package only
pnpm --filter @albertomarturelo/sii-core test
```

Node `>=20` and the pinned pnpm from `package.json` `packageManager` are required.
Run `pnpm build`, `pnpm test`, `pnpm lint` and `pnpm format` before opening a PR —
and walk [the PR checklist](#the-pr-checklist) while you are at it.

## Security

Never commit secrets or real PII (RUT, Clave, cookies, names, amounts). To report a
vulnerability, read [`SECURITY.md`](SECURITY.md) — please do not open a public issue
for one.
