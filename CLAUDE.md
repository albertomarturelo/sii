<!-- ~80–120 tokens loaded at session start. Keep it an INDEX, not an encyclopedia. -->

# Project: sii — TypeScript core + CLI + MCP for SII Chile

## What This Project Does

A TypeScript monorepo that automates routine interactions with Chile's tax
authority (SII — Servicio de Impuestos Internos) for a single user acting on
their own RUT, plus the empresas that user is authorized to represent. One
shared domain core (`@albertomarturelo/sii-core`) backs two surfaces: a human **CLI** and an
**MCP** server. The MCP server (stdio) is the integration point for both
**Claude Code** and **Claude Desktop**; the CLI serves the terminal and is also
what Claude Code can drive via Bash. The core holds every legal and operational
guardrail, so those rails apply regardless of which surface is in front.

This is a ground-up TypeScript rewrite of the proven Python `sii-cli`; the
hard-won SII wire knowledge and guardrails are PORTED, the code is not.

## Architecture

@docs/ARCHITECTURE.md

## Tech Stack

@docs/STACK.md

## Conventions

@docs/CONVENTIONS.md

## Current Status

@docs/CURRENT_STATUS.md

## Roadmap

@docs/ROADMAP.md

## Key Decisions

@docs/decisions/_index.md

## Build & Run

- Install: `pnpm install`
- Build all packages: `pnpm build` (`tsc -b`)
- Typecheck: `pnpm typecheck`
- Test: `pnpm test` (vitest)
- Lint / format: `pnpm lint` / `pnpm format`
- One package: `pnpm --filter @albertomarturelo/sii-core <script>`

## Critical Rules

- **Never hard-code a SII hostname.** Read from `@albertomarturelo/sii-core` config. Prod is the
  only target; there is no env switch (ported from sii-py ADR-016). (ADR-004)
- **Surfaces call `@albertomarturelo/sii-core` tasks only.** The CLI and MCP NEVER reach past the
  task layer into the portal/DTE facades — that bypasses throttling, the audit
  log, and credential handling. (ADR-003)
- **External dependencies go through injectable seams.** The SII portal driver,
  secret store, session store, audit sink, and clock are interfaces with Node
  default implementations, so unit tests substitute fakes and never touch the
  real SII / keyring / clock. The core is a Node library otherwise. (ADR-003)
- **Secrets never touch disk in plaintext and never reach the LLM.** The Clave
  Tributaria is typed by the user into SII's real page (browser login,
  cookies-only) or held in the OS keyring (CLI only). No password ever crosses
  an MCP tool argument. Never commit `*.pfx`, `*.p12`, `.env`, or anything under
  `.sii/`. (ADR-006)
- **No third-party SII libraries.** Every selector, endpoint, and payload shape
  is derived from first-hand observation of the live SII surface and cited in a
  code comment. (ADR-004)
- **Decisions get an ADR BEFORE implementation.** About to add a dependency,
  move a layer boundary, or pick between plausible patterns? Run
  `/decision:new` first. (ADR-001 / CFD)
- **Corrections become conventions.** Fix the same pattern twice → write it into
  `docs/CONVENTIONS.md` in the same commit.
- **Identity is single-account + operate-centric.** One live session at a time
  (switch by logout→login); within it, a persona account's `operate` pointer
  selects which RUT it acts as (self by default; an empresa it represents).
  Empresa accounts cannot represent anyone. (ADR-005)
- **Absolute rule — no AI attribution anywhere.** Claude, GPT, Copilot, or any
  AI tool must NEVER appear as co-author, generator, or reference in commits,
  PR titles/bodies/comments, issues, branch names, code comments, docs, or any
  artifact that lands in git or on GitHub. Authorship is the human owner.

<!--
This file is the INDEX, not the encyclopedia. Adding paragraphs here? Move them
to a docs/*.md file and @reference it. Target ≤150 lines.
Slash commands live in .claude/commands/ — run /session:start at the start of a
session and /session:close before ending one.
-->
