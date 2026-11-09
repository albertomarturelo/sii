# Conventions

This file grows as real work surfaces patterns (ADR-007: corrections become
conventions). It starts with the load-bearing rules ported from the proven
Python `sii-cli`, adapted to TypeScript.

## Code style

- TypeScript `strict` everywhere, plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. No `any` without an inline justification; prefer
  `unknown` + narrowing at boundaries.
- ESLint + Prettier are authoritative. Format before commit.
- Comments explain WHY, not WHAT — non-obvious constraints, SII quirks, subtle
  invariants. Never restate the code.
- ESM only (`"type": "module"`). Named exports; avoid default exports.
- **NodeNext modules: relative imports end in `.js`** (e.g. `from './rut/index.js'`)
  so the compiled output runs directly on Node; bare specifiers (`@albertomarturelo/sii-core`,
  `commander`) stay extensionless. `tsc` errors on a missing extension. (ADR-009)

## Architecture patterns

- **Single-env (prod) is the contract.** No `SII_ENV` switch. Hostnames are
  constants in `@albertomarturelo/sii-core` config; never hard-code a SII hostname anywhere else.
- **Surfaces call `@albertomarturelo/sii-core` tasks only.** CLI and MCP never reach past the
  task layer into a portal/DTE facade — that bypasses throttling, audit log, and
  credential handling. (ADR-003)
- **The core is the data layer; surfaces present. JSON is the default output.**
  `@albertomarturelo/sii-core` tasks return plain, JSON-serializable objects (no `Date`/`Map`/`Set`,
  no human formatting) — that is the library/integration contract. The MCP surface
  emits `JSON.stringify`; the CLI emits JSON by DEFAULT (`--human` for the readable
  rendering, `--json` is the explicit default). A command computes its result object
  ONCE and renders it through the shared `emit(data, humanFn)` — never bare `out()`
  for a result. STDOUT carries only the result (JSON pipeable to `jq`); the
  `operating as:` header + diagnostics go to STDERR and are human-mode-only. (ADR-012)
  **A JSON error is `{ error, type, exitCode, reason?, codigo? }` on STDERR** (the MCP's
  tool error is the same object, minus `exitCode`). `error` is the verbatim message. `type`
  is a stable kind from the core's `classifyError` (`login_rejected`, `session_expired`, …),
  never a class name. A consumer branches on `type`, never on the text. The CLI's exit code
  is derived from `type`. A new error class either maps to an existing kind or gets a new
  kind through an ADR-012 amendment. Kinds are never renamed. (ADR-012 amendment, #134)
- **External dependencies sit behind injectable seams.** `PortalDriver`,
  `SecretStore`, `SessionStore`, `AuditSink`, `Clock` are interfaces in
  `@albertomarturelo/sii-core` with Node default implementations; tests inject fakes so they
  never touch the real SII / keyring / clock. The core is otherwise a normal
  Node library (it may use Node APIs directly). (ADR-003)
- **The default `portal` is HTTP; a JS engine is an explicit, optional capability
  (ADR-027).** `HttpPortalDriver` (Node `fetch` + an in-house cookie jar) backs every
  `request*` primitive, and its `goto` is a redirect-following GET. Its `evaluate` throws
  `BrowserRequiredError`.
  - A surface may ask for the browser (`withSession(…, { engine: 'browser' })`) ONLY when
    SII's own page JS must COMPUTE the data: a JS-built form or an in-page validator
    (MIPYME `validaFacEx`). Data the page writes as literals is parsed from the HTML (the
    next bullet, and the inline-JS-map rule in `conventions/sii-wire.md`; ADR-027
    amendment, #222).
  - In the CLI that browser is ALWAYS headless. **No CLI command may need a human at a
    browser window**, so the headed login and `--www2` are MCP-only.
  - If the data ships as a JSON literal in the HTML (e.g. `DatosCntrNow`), extract and
    `JSON.parse` it, zod-validated. Never request the browser for that, and never
    upgrade to it silently.
  - **A text body is decoded the way a browser decodes it (#224).** The header's charset
    wins; without one, an HTML body's `<meta>` charset (first 1024 bytes); else UTF-8
    (`charsetOfBody`, every decode site in both Node drivers). `loa.sii.cl` sends a bare
    `text/html` and declares `iso-8859-1` only in the HTML, so the header alone turned
    every ñ into U+FFFD. A move from the browser to HTTP is validated on a value with an
    accent, or by counting U+FFFD in the decoded body: "every field present" hid this.
    **A rule that matches SII's TEXT is checked against the live value, not the contract's
    transcription (#245).** SII's own `SGPE` `valor` carries three U+001A where the « í » of
    « Categoría » goes (in the body: a `TextDecoder` never yields U+001A), while the contract had
    recorded the accented word. The strict pattern never matched and the rule stayed off, with no
    error. Match only the load-bearing part, tolerate what stands for an accent, and confirm the
    match live (a boolean, never the value) before the PR.
- **A seam only ONE surface may use is wired in THAT surface's composition root, never
  as a `createNodeRuntime` default.** Both surfaces build from `createNodeRuntime()`, so a
  default there hands the capability to the MCP server too. Keeping a task off the main
  barrel controls which TASK the model can reach; it does NOT control which SEAM the
  runtime carries — every barrel task receives `runtime`. The OS keyring is the template:
  `packages/cli/src/main.ts` passes `secrets: new KeyringSecretStore()` explicitly,
  `createNodeRuntime().secrets` is asserted `undefined` in both packages, and the type on
  `Runtime` is the READ half only (`SecretReader`). "The MCP never reads the keyring" must
  be true by construction, not because no code happens to call it. (ADR-006 / ADR-025)
- **Authentication is an explicit verb, not a side-effect.** Domain tasks never
  mint a session; they consume a valid one or raise `NotAuthenticated`. Only the
  login task mints. (ported sii-py ADR-019)
- **Domain tasks reach SII through `withSession`, never a bespoke restore.** The
  `auth/session.ts` primitive restores the cookies-only session into a live
  `PortalSession`, resolves the operating/body RUT (override > pointer > self — a
  `--rut` override is validated against the operable set HERE, the single
  enforcement point, via the same `resolveOperableTarget` the `operate` command
  uses), hands both to the callback, and always closes the session — raising
  `NotAuthenticated` when there is none. It does NOT eagerly probe liveness — the
  first SDI POST IS the liveness test: the `requestJson` seam detects the login-wall
  response (a dead jar bounced to HTML / `LOGIN_HOST`) and raises `SessionExpiredError`
  (actionable "re-login"), so facades must let `NotAuthenticated` propagate instead of
  wrapping it as their domain error. NEVER retries after a block. New read surfaces
  (rcv/f29/bte) wrap their facade call in it. (ADR-003 / ADR-005)
- **Identity is single-account + operate-centric.** One live session at a time;
  switch accounts by logout→login. Within a session, a persona's `operate`
  pointer chooses which RUT it acts as (self by default, or a represented
  empresa). `operate` SELECTS, never mints, and is validated against the cached
  operable set. Empresa accounts have no operate capability. The active operating
  RUT is ALWAYS visible (status + an `operating as:` header). (ADR-005)
- **Per-call `--rut` overrides the operate pointer** for one operation; it is the
  same value-domain (the operable set), not a separate concept.
- **Validate external inputs at the boundary with `zod` (ADR-011).** MCP tool
  inputs (the SDK derives the protocol JSON Schema from the zod shape) and, later,
  SII wire payloads in `@albertomarturelo/sii-core`. Validation stays at the boundary — internal
  domain invariants are plain TypeScript types, never zod.

## SII domain rules

In [`conventions/sii-wire.md`](conventions/sii-wire.md), loaded on demand (ADR-033): read it
before changing `packages/core/src/portal/`, `packages/core/src/tasks/` or
`docs/sii-contract/`, and before a write against the live SII. A new SII wire rule goes there.

## Security, secrets & PII

- **The Clave never reaches the LLM and never lands in plaintext.** Login is
  either the user typing into SII's real page (browser, cookies-only) or a value
  in the OS keyring behind the `SecretStore` seam. No MCP tool accepts a
  password argument. (ADR-006)
- **The Clave never arrives as a flag VALUE or an argument, and every source is named
  explicitly.** The sources are:
  - the hidden prompt (`--console`, ADR-010);
  - the OS keyring (`--keyring`, ADR-025);
  - an environment variable **named on the command line** (`--clave-env <VAR>`: no
    default name, deleted from `process.env` after the read);
  - stdin (`--clave-stdin`, refused on a TTY).

  The last two come from ADR-028. There is never a fallback from one source to another,
  and never a `--clave <value>`, which would leak through argv, shell history and agent
  transcripts. The Clave is held in memory for one attempt, then discarded; only
  cookies persist.
  - Every Clave-taking task (`consoleLogin`, `keyringLogin`, the ADR-028 ones) is
    exported from the CLI-only `@albertomarturelo/sii-core/cli` subpath, NOT the main
    barrel, so the MCP server cannot wire it.
  - A non-interactive login honours the rejection latch (`~/.sii/login-blocked.json`, one
    entry per RUT): after SII rejects a Clave, unattended logins refuse without contacting
    SII until a human logs in or runs `sii auth unblock`, which refuses without a TTY. A
    safety rail an agent must not undo is enforced in code AND stated in the agent's
    instructions, and the docs say honestly what the code check misses (here: a harness
    that runs commands in a pseudo-terminal passes a TTY check).
    (ADR-006 / ADR-010 / ADR-028)
  - **Every credential login probes for a live session first and is RUT-aware.** A live
    session for the same RUT answers `already_authenticated` without reading the Clave; one
    for ANOTHER RUT is an error, never a silent "already authenticated" as the wrong account
    (switching is logout→login, ADR-005). There is no `--if-needed` flag (ADR-028 amendment).
  - **An error that may carry a secret never echoes the user's input.** `--clave-env` given a
    non-name refuses WITHOUT repeating it: the likeliest mistake is passing the Clave itself.
- **Never commit** `*.pfx`, `*.p12`, `.env`, or anything under `.sii/`. Sessions
  are cookies-only; `.gitignore` blocks them — re-verify before any `git add`.
- **Audit every state-touching op** via the `AuditSink` port: `{ts, action, rut,
  result, durationMs?, ...extra}`. Keys whose lowercased name contains
  `password|clave|cookie|secret|token` are dropped before the line is written.
  The log is a receipt, never a gatekeeper — write failures degrade silently.
- **PII hygiene.** Real PII (nombre, RUT, dirección, email, teléfono, DoB) never
  lands in a tracked file — including CI guard denylists (hold those in a repo
  secret). Tests use synthetic, Mod-11-valid RUTs only. A task that surfaces the
  user's own PII carries an explicit opt-in name and states the exposure in its
  CLI help + MCP description; PII values never go to the audit log.
- **No account state in a public artifact.** A live validation is written up as WHAT was
  confirmed (fields, an anulada, the sums' rule, an empty month parsed), never as the
  owner's account activity: which períodos are filed or empty, which months had boletas,
  how many rows, start of activities, plans tied to the filing calendar. This covers the
  ADRs, `sii-contract/*.md`, ROADMAP, commit bodies, issues and PR bodies. A squash body
  and GitHub's edit history keep what was written, so it is caught in review, before the
  merge. Leaked twice: a #179 comment, then #226's ADR + contract (scrubbed in #229).

## Testing

- Tests must NOT hit production SII. Default mode is recorded fixtures with
  synthetic data; any live test is gated behind an explicit env var.
- Reproduce CI conditions before pushing (env stripped of any credential vars).

## Naming

- Files: kebab-case `.ts` modules. Tests: `<module>.test.ts` (vitest).
- Domain terms stay in Spanish where they are Spanish (`boletaHonorarios`,
  `propuestaF29`, `carpetaTributaria`). Don't anglicize SII terminology.
- User-facing surfaces (CLI verbs, MCP tool names) are English where no
  entrenched Spanish term exists (`status`, `login`, `profile`), Spanish where
  one does (`rcv`, `f29`, `bte`).
- Form/document codes stay numeric (`F29`, `F22`, DTE `33`/`39`).
- **Surfaces are named by SII artifact (ADR-024).** The top-level CLI verb / MCP prefix
  is the tax artifact (`f29`, `rcv`, `dte`, `bte`…) — never the portal or transport
  (`mipyme`, `sdi`), and never a document subclass of an artifact that already has a verb
  (`factura` is DTE 33 ⇒ `dte`). Document types are numeric parameters (`--tipo 61`), not
  verbs. Two transports for one artifact share the verb and differ by prerequisites in
  `--help`. Portal-layer files are `portal/<artifact>-<transport>.ts` (`dte-public`,
  `dte-mipyme`). **The first line of every surface's `--help` declares its auth mode**
  (session-keyed / body-RUT / empresa-keyed / public). A verb not in ROADMAP's
  "Where a new surface goes" table needs an ADR before it lands.

## Commits & PRs

- One topic per commit. Conventional Commits subject (`feat(scope): …`),
  ≤72 chars. English everywhere (commits, branches, PRs).
- **One feature / work-unit per PR.** Don't bundle two distinct features even on
  the same branch — when a second feature emerges mid-branch, give it its own
  branch/PR (stacked if it depends on the first). Split BEFORE opening the PR.
  For a FORK PR, "stacked" means SEQUENCED AFTER the first merge: the dependent
  feature waits, then branches off the updated `main` — never two in one branch.
  **Merging a same-repo stack:** retarget the dependent PR to `main` (`gh pr edit --base main`)
  BEFORE merging its base with `--delete-branch`. Deleting the base branch CLOSES the
  dependent PR instead of retargeting it (#226 was closed this way and had to be reopened).
  After the base's squash, rebase the dependent `--onto origin/main <old base tip>` and gate
  its merge on CI for the new head.
  **Two sessions in one checkout move each other's HEAD.** A branch created while another
  session had its own branch checked out started on that session's commit, and a later commit
  landed on `main` (#244's work; caught before any push). Check `git branch --show-current`
  right before committing whenever another session may be in the repo, or work in a separate
  worktree (ask the owner before creating one).
- **Status docs go in a SEPARATE commit from feature code.** `ROADMAP.md`
  bookkeeping is its own commit; the feature commit carries code
  plus its tightly-coupled docs only (the ADR + any `sii-contract/*.md`).
- **Run `/review-pr` on a PR before asking for its merge, including your own.** A fresh review
  found two correctness gaps in #223 and a wrong promise in ADR-031 (#232); #232 was offered
  for merge before it ran, and the owner had to ask.
- **When an issue's last criterion is a release, the PR says `Refs #N`, never `Closes`.** GitHub
  closes the issue on ANY `Closes #N` in the body, even mid-sentence ("Closes #230 after
  release"), so the issue would close before the version ships. Check
  `gh pr view <n> --json closingIssuesReferences` is empty; close the issue by hand once npm
  serves the release.
- **A squash merge's subject must carry the PR number.** Every commit on `main` ends with
  `(#N)` — that is how a commit is traced back to its review. GitHub appends it automatically
  only when it composes the subject itself; passing `gh pr merge --squash --subject "…"`
  suppresses that, so **write the `(#N)` into the subject yourself**. The ≤72-char limit is on
  the subject you author; the appended reference may push the final line past it, as the existing
  history shows. (Learned by getting it wrong twice on the 0.10.0 work — ADR-007.)
- **No AI attribution anywhere** — no `Co-Authored-By`, no "Generated with",
  no `🤖`, in any artifact that lands in git or on GitHub. Authorship is the
  human owner.
- `docs/` updates ship in the SAME commit as the code that motivated them.
- **Agent knowledge bases follow the CLI.** `docs/integrations/*/skill-*.md` describe CLI
  commands, flags and error kinds to third-party agents, which read them at the release tag of
  the binary they run. A PR that changes any of those updates the affected skill file in the
  same PR, so a tag's skill always matches that tag's binary.
- **A user-visible PR writes its line under `## Unreleased` in the root `CHANGELOG.md`
  (ADR-021 amendment).** One line, in the feature commit (it is the change's own doc, like the
  ADR, not status bookkeeping). "User-visible" means anything an installed package does
  differently: a CLI verb, flag or output field, an MCP tool or its result, an error kind, a
  core export. Repo-only changes (CI, docs, skills) get no line. A change that breaks a caller
  starts with **Breaking** and says what to do instead. The release commit moves the list into
  the version's sections.
- **Pre-1.0, the bump follows the changelog (ADR-021 amendment).** A PATCH carries `Fixed`,
  `Security` and non-breaking `Changed` only. Anything `Added` (a verb, flag, tool, result field,
  export), `Removed` or **Breaking** makes it a MINOR. `release.yml` refuses a patch tag whose
  sections say otherwise, and any tag while `## Unreleased` still holds an entry. 0.12.2 shipped
  an `Added` field in a patch; the rule applies from 0.15.0.
