# ADR-010: CLI console login — headless form-fill to a cookies-only session

## Status

Accepted — 2026-06-28. Refines ADR-006: adds a CLI-only console **input method**
for the same cookies-only session. It does NOT adopt the keyring credential-store
path (that stays optional and deferred under ADR-006; ADR-008's keyring-lib defer
is untouched). Lineage: sii-py ADR-019 (only login mints).

## Context

The default login is the headed browser (ADR-006): the user types the Clave into
SII's real page and we keep only cookies. The user wants a faster, keyboard-only
alternative on the CLI — type RUT + Clave in the console and get the SAME
cookies-only session, without opening a browser. The 2026-06-28 login-form spike
(`docs/sii-contract/auth-login.md`) confirmed the form has no CAPTCHA and no CSRF
token and that the page JS derives the hidden `rut`/`dv` from `#rutcntr`, so a
headless fill-and-submit is viable. This is distinct from — and simpler than —
the keyring credential path ADR-006 contemplated for unattended re-mint: here the
Clave is used once and discarded; only cookies persist.

## Decision

- **Add a CLI-only console login as a peer to the browser login**, both producing
  the same cookies-only session (`~/.sii/session.json`, `0600`, no secret).
  Browser stays the DEFAULT and the only MCP-safe path.
- **Input:** prompt the RUT, then the Clave with **hidden input** (no echo). The
  RUT may also come from a flag/arg; the **Clave is ALWAYS prompted — never a
  flag, env var, or MCP argument** (no shell-history / argv / process-list leak).
- **Mechanism:** `PortalDriver.credentialLogin` — headless Chromium, fill
  `#rutcntr` + `#clave`, click `#bt_ingresar`, and let SII's own JS derive
  `rut`/`dv`/`referencia` and POST (no hand-built POST). On success read
  `DatosCntrNow`, persist `storageState` (cookies-only), then **discard the Clave
  from memory immediately**. Reuses the Playwright seam (ADR-003); shares the
  identity-read + persist with the browser path.
- **The Clave lives only transiently in CLI process memory for one attempt** —
  never on disk, never in the audit log, never over MCP.
- **One-attempt / no-retry lock policy** (ADR-004): a failed console login (lands
  back on `zeusr.sii.cl`) surfaces SII's Spanish message verbatim and stops. No
  retry — a mistype is a real attempt and counts toward account lockout.
- **No keyring, no stored credential, no new dependency.** The keyring-backed
  unattended re-mint stays a separate, still-deferred option (ADR-006).

## Alternatives Considered

1. **Keyring-stored Clave for unattended re-mint** (this ADR's first draft) —
   not what's needed: the user wants an input method, not persistence. Storing the
   Clave widens the blast radius for no current benefit; remains deferred.
2. **Hand-built HTTP POST to `CAutInicio.cgi`** — rejected: the page JS owns the
   `rut`/`dv` split and `referencia`; headless fill is robust and reuses the seam.
3. **Clave via CLI flag / env var** — rejected: leaks into shell history, argv,
   and process listings; always prompt with hidden input.
4. **Console login over MCP** — rejected: ADR-006, the Clave must never reach the
   LLM. This path is CLI-only.

## Consequences

- Easier: a fast keyboard-only CLI login with the SAME at-rest envelope as the
  browser flow (cookies-only, no secret stored). No new dependency or ADR-008
  keyring decision needed.
- Trade-off (made explicit): unlike the browser flow — where only SII's page sees
  the Clave — the CLI process now handles the plaintext Clave transiently to fill
  the headless form. Acceptable: CLI-only (never LLM-adjacent), memory-only,
  single-use; strictly LESS exposure than the keyring path ADR-006 already allows.
- Obligation: implement `PortalDriver.credentialLogin` (headless fill+submit) + a
  fake; a hidden-input prompt in `@sii/cli`; the one-attempt policy; reuse the
  `DatosCntrNow` read + cookies-only persist already built for the browser path.
- Open item: the server-side failure response (wrong-Clave vs locked account) is
  NOT yet observed — deliberately, since a wrong-Clave submit risks lockout
  (ADR-004). Both currently map to "stop, surface verbatim"; refine if/when a
  genuine mistype reveals the distinction.
