# ADR-006: Auth posture — browser cookies-only default + keyring fallback

## Status

Accepted — 2026-06-27. Lineage: sii-py ADR-025 (browser login), ADR-019 (only
login mints), ADR-018 (keyring credential path). Built on the ADR-003 seams
(`SecretStore` / `SessionStore` / `PortalDriver`).

## Context

The portal auth is RUT + Clave Tributaria; the account locks after repeated
failures. The Clave is the user's most sensitive credential and MUST NOT reach
the LLM (the MCP surface) or land in plaintext on disk. The three surfaces have
different capabilities: the CLI can prompt (hidden input), the MCP server cannot
prompt at all (and is adjacent to the LLM, so it must never carry the Clave).

## Decision

- **Browser cookies-only login is the default and the only MCP-safe path.** A
  visible browser opens at SII's real login page; the user types the Clave INTO
  SII. We read only the resulting cookies (a cookies-only session) via the
  `SessionStore` port. We never fill the form, never see the password, never
  persist it. The MCP login tool NEVER accepts a password argument — it delegates
  to this flow, so the Clave goes user→SII and never reaches the chat/LLM.
- **Optional credential path for one primary account (CLI only).** The CLI may
  prompt (hidden input) and store the Clave in the OS keyring via the
  `SecretStore` seam, enabling unattended re-mint for long-running processes.
  This path is never exposed over MCP.
- **Only the login task mints a session** (lineage ADR-019). Domain tasks
  consume a valid session or raise `NotAuthenticated`; they never mint as a
  side-effect. Login is idempotent on a warm session; an expired cookies-only
  session recovers by reopening the browser (or re-minting from a stored
  credential if one exists).
- **Session detection is URL-based** (`zeusr.sii.cl` ⇒ not authenticated). The
  authoritative session RUT comes from the portal post-login (`DatosCntrNow`),
  not from a submitted credential.
- **Secrets via seams.** No surface reads a secret store directly; all secret +
  session access goes through the `SecretStore` / `SessionStore` seams, so tests
  substitute in-memory fakes without touching core logic or the real keyring.

## Alternatives Considered

1. **Prompt for the Clave over MCP.** Rejected — impossible to do without the
   Clave passing through the LLM/chat; violates the core security rule.
2. **Always store the Clave in a keyring (no browser path).** Rejected — makes
   the LLM-adjacent MCP surface depend on a stored copy of the most sensitive
   secret, and there is no MCP-safe way to capture it in the first place.
   Browser cookies-only avoids storing it at all.
3. **Persist sessions with the Clave for convenience.** Rejected — cookies-only
   is sufficient; storing the Clave only saves a re-type on expiry and widens
   the blast radius.

## Consequences

- Easier: the Clave never reaches the LLM and, on the default path, never lands
  on disk at all; the same login flow works across the CLI and MCP via the
  seams.
- Obligation: implement the default `SessionStore` / `SecretStore` adapters +
  fakes; cookies-only sessions expire and must recover gracefully; the browser
  flow needs a headed Playwright driver behind the `PortalDriver` seam.
- Open item: the cert/.pfx auth method for DTE writes is a separate future ADR.
