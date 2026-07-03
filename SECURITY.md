# Security Policy

This project automates interactions with Chile's tax authority (SII) and handles
authentication material and personal tax data. Security and privacy are core to
its design (see [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) §"Security, secrets &
PII" and [ADR-006](docs/decisions/006-auth-posture-browser-cookies-host-secrets.md)).

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting — the **"Report a vulnerability"**
button under the repository's **Security** tab — or email
**amarturelo@gmail.com** with:

- a description of the issue and its impact,
- steps to reproduce (a minimal proof of concept if possible),
- affected version / commit.

Please allow a reasonable window to investigate and ship a fix before any public
disclosure. This is a personal open-source project, so responses are best-effort
rather than bound by an SLA.

## Scope

In scope: the `@albertomarturelo/sii-core` library, the `@albertomarturelo/sii-cli`, and the `@albertomarturelo/sii-mcp`
server in this repository — in particular anything touching credential handling,
session storage, the audit log, or PII exposure across a surface.

Out of scope: the SII's own systems and any third-party service. Do **not** test
against production SII in a way that could lock an account or violate the SII's
terms — see the disclaimer in the README.

## Handling secrets and PII (contributors)

These rules are enforced conventions, not suggestions:

- **Never commit** real credentials or PII — no `*.pfx` / `*.p12` / `.env`, nothing
  under `.sii/`, no real RUT, Clave Tributaria, session cookie, name, address,
  email, or audit-log line. `.gitignore` blocks the obvious paths; re-verify before
  every `git add`.
- **Tests use synthetic, Mod-11-valid RUTs only** and recorded fixtures with
  synthetic data. Tests must never hit production SII.
- The Clave Tributaria never reaches an LLM and never lands on disk in plaintext:
  login is either the user typing into SII's real page (browser, cookies-only) or a
  value in the OS keyring behind the `SecretStore` seam. No MCP tool accepts a
  password argument (ADR-006).
- The audit log is a receipt: keys whose name contains
  `password|clave|cookie|secret|token` are dropped before a line is written, and
  PII values (counterparty, amount, free text) are never logged.

If you find real PII or a secret committed anywhere in the tree or history, report
it privately as above rather than opening a public issue.
