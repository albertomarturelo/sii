<!-- Slash command: /review-pr <PR-number>
     Review a PR against the project's CONTEXT (ADRs + CONVENTIONS +
     linked issue AC) WITHOUT scanning full files. Token budget: ≤6,000.
     English-only output.

     Repo slug: AltumStack/sii. -->

The user passes a PR number. If not provided, infer from the current
branch (`gh pr status --repo AltumStack/sii --json number --jq '.currentBranch.number'`).
If still none, ask.

## 1. Fetch PR metadata + diff (do FIRST)

```bash
gh pr view <n> --repo AltumStack/sii \
  --json baseRefName,headRefName,title,body,labels,commits,closingIssuesReferences
gh pr diff <n> --repo AltumStack/sii
git log <base>..<head> --pretty=format:%s
```

## 2. Load context indices (do NOT read full source files)

- `CLAUDE.md`, `docs/CONVENTIONS.md`, `docs/decisions/_index.md`.
- The **linked issue body** (`gh issue view <n>`) — extract the AC
  checklist + the "ADRs to load" list.
- **Each ADR named in the issue** under `docs/decisions/NNN-*.md`.

Token cost so far ~2–4k. **Still no full source-file reads.**

## 3. Cross-check the diff against this checklist

### GitHub workflow
- Branch name matches `<type>/GH-<issue>-<slug>` (type ∈ feature/fix/chore/docs).
- PR body references `Closes #<issue>` when there is a linked issue.
- PR title is Conventional Commits, subject ≤72 chars; all commits the same.
- **No AI attribution** anywhere (commits, title, body, comments). Block on any.
- English everywhere.

### Architecture (ADR-002 / ADR-003)
- The CLI / MCP packages import ONLY `@albertomarturelo/sii-core`'s task layer (+ seam
  interfaces). **No reaching past tasks** into a portal/dte facade.
- **`packages/core/src` imports NO Node-only module** (`node:*`, `fs`,
  `playwright`, a keyring lib). Side-effects go through ports. Grep the diff.
- **No hard-coded SII hostnames** outside the core config module. Grep the diff
  for `sii.cl` / `palena` / `zeusr` / `misiir` literals.
- Adapters are injected at a surface composition root — no service-locator /
  global singletons reaching into the core.

### SII contract (ADR-004)
- **No third-party SII libraries.** Grep the diff for `cl-sii`, `libredte`,
  `python-sii`, `dansanti`, or any SII-domain package. Any hit blocks merge.
- Every selector / endpoint / payload constant added carries an **observation
  citation** (`// observed at <URL> on <YYYY-MM-DD>`). Missing = block.
- Auth detection is **URL-based** (`zeusr.sii.cl` ⇒ not authenticated), not
  DOM-marker based. No retry after a login failure / rate-limit block.

### Identity & secrets (ADR-005 / ADR-006)
- Only the login task mints a session; domain tasks consume or raise
  `NotAuthenticated`. No implicit minting in a domain path.
- No MCP tool accepts a password argument. Secrets/sessions reached only via the
  `SecretStore` / `SessionStore` ports.
- Operate selects-never-mints; the operating RUT is validated against the
  operable set; the `operating as:` header / status visibility is present when
  operating ≠ self.

### Credentials & PII
- No hard-coded credentials, RUTs, passwords, cookies, tokens. Anything matching
  a Chilean RUT (`\b\d{1,8}-[\dKk]\b`) in source/fixtures must be synthetic
  (`11111111-1`, `12345670-K`).
- No real customer PII in fixtures. `.gitignore` still blocks `*.pfx`, `*.p12`,
  `.env`, `.sii/`.

### TypeScript correctness
- `strict` honored: no `any` without an inline justification; `unknown` +
  narrowing at boundaries. ESM, named exports.
- No blocking patterns in async paths; no `console.log` in `@albertomarturelo/sii-core` (use the
  injected logger/audit) — `console` only in surface user-facing output.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean.

### Testing
- New logic has vitest tests (`<module>.test.ts`); fixtures synthetic.
- Tests must NOT hit production SII (no real Playwright/HTTP in CI).
- Every new conditional branch / error path in `@albertomarturelo/sii-core` is exercised.

### Documentation (CFD — ADR-001)
- New convention → `CONVENTIONS.md` updated in the SAME commit.
- New decision → new ADR BEFORE the implementation; superseded ADRs updated.
- `CURRENT_STATUS.md` reflects what shipped; `STACK.md` updated if deps changed;
  `ARCHITECTURE.md` updated if the module map changed; a new SII surface adds a
  `sii-contract/*.md`.

## 4. Output a structured report

```text
## Critical (must fix before merge)
- <file:line> — <issue> — <concrete one-line fix> (cites ADR-NNN | CONVENTIONS)
## Suggestions (should fix)
## Nits
## Summary
- Verdict: BLOCK | APPROVE WITH SUGGESTIONS | APPROVE
- AC items: <m/n> implemented
- Architecture compliance / Test coverage / Tokens: ~<n>k (target ≤6k)
```

## 5. Do NOT auto-fix. Report only.

## Hard rules
- **NO full-file reads by default.** If the diff is too narrow, NAME the file
  you need and explain WHY before reading. Silent scope expansion is forbidden.
- **English only** in the report, even when the conversation is in Spanish.
