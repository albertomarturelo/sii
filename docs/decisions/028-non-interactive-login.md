# ADR-028: Non-interactive login — `--clave-env` / `--clave-stdin`, `--if-needed`, a rejection latch

> **Amended 2026-10-18 (#132), at implementation:** `--if-needed` was dropped in favour of the
> RUT-aware live probe every credential login already ran; the latch details were settled. See
> [Amendment](#amendment-2026-10-18-132).

## Status

Accepted — 2026-10-18. Extends ADR-010 and ADR-025 with two input methods for the same
cookies-only session, over ADR-027's HTTP login. Amends the CONVENTIONS secrets rule (an
env var is allowed when named explicitly). ADR-006's MCP rule is untouched. Lineage:
sii-py ADR-019 (only login mints).

## Context

Scheduled and unattended runs (a daily balance, an alert on a problematic document,
run by a hosted AI agent on a Linux VM) must log in with no one at the keyboard:
- `--console` needs a TTY.
- `--keyring` needs a desktop Secret Service, which headless VMs and containers lack.
- Agent platforms supply secrets as **environment variables**, filled from a masked
  field so the value never passes through the chat.

Honest threat model: an agent with full control of its VM can read any secret its
process can. Hiding the Clave from it (another Unix user, sudoers, an encrypted file
with its key on the same disk) does nothing against root. What CAN be protected:
- the value never enters the agent's transcript or command text;
- an unattended loop never locks the account with a stale Clave;
- logins happen only when the session is actually dead.

## Decision

- **Two explicit sources on `sii auth login`.** They are mutually exclusive with each
  other and with `--console` and `--keyring`, and both require `--rut` (there is no
  prompt).
  - `--clave-env <VAR>`
    - The name is required, with no default, and must match `^[A-Z_][A-Z0-9_]*$`.
    - The value is deleted from `process.env` right after the read, so no child
      inherits it.
    - Missing or empty ⇒ an error that names the variable and never the value; nothing
      is sent to SII.
  - `--clave-stdin`
    - Reads one line and strips one trailing `\n`/`\r\n`.
    - Refuses on a TTY (that is `--console`) and refuses an empty value.
- **No implicit fallback.** `--keyring` never reads the environment, and no source is
  tried after another fails. The Clave's origin is always legible on the command line.
- **`--if-needed`** *(superseded by the Amendment: no flag; every credential login does this)*.
  If the stored session is for the same RUT and is live (one Mi SII
  GET, as `auth status --refresh` does), exit 0 with `{ alreadyAuthenticated: true }`,
  sending nothing. A stored session for a DIFFERENT RUT is an error: switching accounts
  stays an explicit logout→login (ADR-005).
- **The rejection latch** needs #124's typed reason on `LoginFailedError`.
  - **Trip:** SII rejects the Clave (wrong Clave or locked account). The CLI writes
    `~/.sii/login-blocked` (`0600`) as `{ rut, at, codigo }`, where `codigo` is SII's
    message code. It holds no secret.
  - **Effect:** while it exists for that RUT, every NON-interactive login
    (`--clave-env`, `--clave-stdin`, `--keyring`) refuses **without contacting SII**.
  - **Clear:** a successful interactive login (`--console`, or the MCP's `auth_login` at
    SII's page; a human typing is the reset) or `sii auth unblock`.
  - **Never trips** on network errors, Queue-it (`LoginQueuedError`) or WAF refusals:
    in those cases SII never judged the Clave.
- **The existing rails are kept.**
  - Mod-11 runs before any request, and each invocation makes ONE attempt, never
    retried (ADR-004).
  - The Clave is memory-only and dropped after the POST; only cookies persist.
  - The audit records `source: env|stdin|keyring|console|browser`, never the value
    (`browser` is the MCP's `auth_login`).
  - The tasks live in the CLI-only `/cli` subpath.
  - **No MCP tool gains any Clave source.**
- **Agent posture, written down.** Unattended use inside an agent's VM is the
  operator's opt-in, for their own account. The docs give the one-liner
  `sii auth login --rut 11111111-1 --clave-env SII_CLAVE` (amended: no `--if-needed`), and
  warn: never `echo` the variable, never type the Clave into the agent's chat, and provision
  it through the platform's masked secret field.

## Amendment (2026-10-18, #132)

Settled while implementing; the Decision above stands except where this says otherwise.

- **No `--if-needed` flag.** `credentialLoginFlow` already probed for a live session on EVERY
  `--console` / `--keyring` login and answered `already_authenticated` without reading or
  sending the Clave (kept that way so a warm session never raises a keyring prompt, review of
  #101). The flag would have done nothing. What it was meant to add now applies to every Clave
  source: **a live session for a DIFFERENT RUT is an error** (`ValidationError`, naming
  logout→login). Before this, `login --rut B` on a live session for A answered "already
  authenticated" as A. The recipe becomes
  `sii auth login --rut 11111111-1 --clave-env SII_CLAVE`, and the result's existing
  `reason: 'already_authenticated'` replaces `{ alreadyAuthenticated: true }`.
- **The probe runs before the latch.** A latched RUT whose session is still alive keeps
  answering: the probe is a cookie GET, and no Clave is submitted.
- **Latch file and shape.** The file is `~/.sii/login-blocked.json` (the store seam's naming,
  `0600`). It holds one `{ rut, at, codigo }` entry PER RUT, so tripping a second account never
  silently lifts the first's latch. `sii auth unblock [--rut]` lifts one RUT or all.
- **What trips it: any SII error page with a código, from any Clave source.** That includes
  `--console`, because the attempt counted toward the lock. `reason: 'wrong-clave'` alone was
  not enough: the locked-account page has its own código, still unobserved (`login-error.ts`).
  Errors with no código (Queue-it, a WAF refusal, a timeout, a network error) never trip it.
  A refusal is `LoginBlockedError` (a `LoginFailedError`, exit code 3) carrying the latched
  `codigo` / `reason`.
- **What clears it:** a FRESH successful `--console` or browser (MCP `auth_login`) login for
  that RUT. An `already_authenticated` answer does not clear it, since no Clave was verified.
- **`unblock` is CLI-only** (the `/cli` subpath) **and needs a terminal**: it refuses when
  stdin is not a TTY. The latch exists so an unattended caller cannot retry a stale Clave;
  if that same caller could lift it, it would protect nothing. So the reset is a human's act
  by construction, not by a line in the agent's instructions. An agent with full control of
  its VM could still fake a TTY; the gate stops the accidental case, not a determined one
  (the residual risk above).
- **Audit:** every `auth_login` receipt carries `source`, and a latch refusal is
  `result: 'blocked'`. The new sources' `reason` values are `env_login` / `stdin_login`.

## Alternatives Considered

1. **`--keyring` falls back to `SII_CLAVE` when there is no keyring.** Rejected: a silent
   fallback changes what the flag guarantees. A broken keyring would quietly become a
   login with whatever the variable holds, which is a real attempt toward lockout.
2. **A default variable name (`--env` reads `SII_CLAVE`).** Rejected: an implicit source
   can pick up a leftover value. Naming it costs one word.
3. **`--clave-file <path>`.** Rejected: `--clave-stdin < path` does the same with one
   mechanism fewer.
4. **`--clave <value>` / a positional argument.** Rejected, as in ADR-010: it is visible
   in `ps` and shell history, and it lands in the agent's transcript.
5. **Isolating the Clave from the agent (separate user, sudo helper).** Rejected as
   theatre against an agent that controls the VM. The mitigations target what can
   actually be protected.

## Consequences

- **Easier:** one idempotent line for cron, CI and agents, with no TTY and no keyring,
  and no login on every run.
- **Residual risk (accepted by the operator):** whoever compromises or prompt-injects
  the agent gets the full Clave Tributaria. That means reading everything, issuing
  documents (behind ADR-017's `--confirm` echoes) and changing the Clave. SII offers no
  lesser credential for a persona natural.
- **Env vs file:** an environment variable is inherited by whatever the agent launches
  (e.g. an `npm` `postinstall`) until the CLI deletes it from its own process. That is
  accepted because platforms offer only environment variables; the latch and the
  live-session probe bound the damage.
- **Obligations:** #124 lands first. Document the agent recipe in the CLI README. Add
  fake-`fetch` / fake-stdin / fake-env tests for every refusal path.
