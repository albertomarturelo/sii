# ADR-028: Non-interactive login — `--clave-env` / `--clave-stdin`, `--if-needed`, a rejection latch

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
- **`--if-needed`.** If the stored session is for the same RUT and is live (one Mi SII
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
  `sii auth login --rut 11111111-1 --clave-env SII_CLAVE --if-needed`, and warn: never
  `echo` the variable, never type the Clave into the agent's chat, and provision it
  through the platform's masked secret field.

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
  accepted because platforms offer only environment variables; the latch and
  `--if-needed` bound the damage.
- **Obligations:** #124 lands first. Document the agent recipe in the CLI README. Add
  fake-`fetch` / fake-stdin / fake-env tests for every refusal path.
