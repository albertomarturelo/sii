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
  SII domain rules, security & PII rules.
- [`docs/decisions/`](docs/decisions/) — the ADRs. Decisions are recorded *before*
  code (Context-First Development, ADR-001).

## Ground rules

- **Decisions get an ADR before implementation.** Adding a dependency, moving a
  layer boundary, or choosing between plausible patterns? Propose an ADR first.
- **Surfaces call `@albertomarturelo/sii-core` tasks only.** The CLI and MCP never reach
  past the task layer into a portal/DTE facade — that bypasses the guardrails
  (ADR-003). CI enforces this boundary.
- **No third-party SII libraries.** Every selector, endpoint, and payload constant
  is derived from first-hand observation of the live SII surface and cited in a code
  comment (ADR-004).
- **Security & PII.** Never commit secrets or real PII; tests use synthetic
  Mod-11-valid RUTs and recorded fixtures, and must never hit production SII. See
  [`SECURITY.md`](SECURITY.md).
- **No AI attribution** in any commit, PR, branch, comment, or doc. Authorship is
  the human contributor.

## Workflow

1. Open an issue describing the change (bug / feature / work-unit templates exist).
2. Branch from `main`.
3. Keep **one topic per commit** and **one work-unit per PR**. Use
   [Conventional Commits](https://www.conventionalcommits.org/) subjects
   (`feat(scope): …`, ≤72 chars), in English.
4. Ship `docs/` updates in the same commit as the code that motivated them;
   `CURRENT_STATUS.md` / `ROADMAP.md` bookkeeping goes in a separate commit.
5. Open a PR against `main`; CI must be green (typecheck, lint, format, tests, and
   the ADR-003 boundary guard).

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
Please run `pnpm build`, `pnpm test`, `pnpm lint`, and `pnpm format` before opening
a PR.
