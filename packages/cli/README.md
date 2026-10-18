# @albertomarturelo/sii-cli

Command-line interface for Chile's **SII** (Servicio de Impuestos Internos), for a
single user acting on their own RUT plus the empresas they represent. Authenticated
**reads** — RCV, F22, F29, boletas de honorarios (BHE), DTE-authorized (public),
peticiones administrativas, whoami — plus a confirm-gated BHE **emit**. A thin
surface over [`@albertomarturelo/sii-core`](https://www.npmjs.com/package/@albertomarturelo/sii-core);
all the legal/operational guardrails live in the core.

> ⚠️ **Unofficial.** Not affiliated with or endorsed by the SII. Provided "as is"
> (MIT, no warranty). You are responsible for the SII's terms of service and
> Chilean law. The account locks after repeated failed logins — never retry after
> a block.

## Install

```bash
npm i -g @albertomarturelo/sii-cli
# only `bte list` and the MIPYME `dte` commands run SII's page JS and need Chromium once:
npx playwright install chromium
```

Requires **Node ≥ 20**. Login needs no browser (ADR-027): you type your RUT + Clave
in the terminal (hidden), and only the session cookies are stored. The Clave never
reaches disk in plaintext (ADR-006).

## Usage

```bash
sii auth login                 # RUT + hidden Clave in the terminal; cookies-only
sii auth login --keyring       # the Clave you stored in the OS keyring (service "sii")
sii auth status                # who am I / operating as whom
sii peticiones list            # administrative requests + their state timeline
sii rcv summary 2026-05        # RCV (compras) summary for a period
sii rcv all 2026-05            # RCV (compras) — every doc type in one flat table
sii f29 overview 2026          # month-by-month IVA position
sii dte authorized 77777777-7  # public consulta — no login
sii bte emit … --confirm <monto>   # issue a BHE (defaults to a safe preview)
```

Output is **JSON by default** (pipe to `jq`); add `--human` for a readable render.
The `operando como …` header goes to STDERR. Full command list, the identity model
(`operate`), and the MCP server are documented in the
[project README](https://github.com/albertomarturelo/sii#readme).

## Unattended use (cron, CI, agents)

For runs with no one at the keyboard, the Clave can come from an environment variable
you **name** on the command line, or from stdin (ADR-028):

```bash
sii auth login --rut 11111111-1 --clave-env SII_CLAVE   # deleted from the env after the read
sii auth login --rut 11111111-1 --clave-stdin < clave.txt
```

- **Idempotent.** If a live session for that RUT exists, nothing is sent. A live session
  for another RUT is an error: switch with `sii auth logout` first.
- **One attempt, never retried.** If SII rejects the Clave, a latch
  (`~/.sii/login-blocked.json`, no secret inside) makes every later `--clave-env`,
  `--clave-stdin` or `--keyring` login refuse **without contacting SII**, so a stale
  Clave in a loop can't lock your account. Fix the Clave, then run
  `sii auth login --console` or `sii auth unblock` (which needs a terminal, so an
  unattended caller can't lift its own latch).
- **Drive it by exit code:** `0` ok; `2` not authenticated or session expired → run the
  login line above and retry the command **once**; `3` login failed or latched → stop
  and tell a human, never retry; `4` SII rate limit → stop. Errors are
  `{"error": "<SII's message verbatim>"}` on STDERR.
- **Persist `~/.sii/`** across runs (session, `operate` pointer, latch). An ephemeral
  container would log in afresh every time.
- **For AI agents:** provision `SII_CLAVE` through the platform's masked secret field.
  Never `echo` the variable and never type the Clave into the agent's chat. The agent
  can't lift the latch (`unblock` refuses without a TTY); that is a human's job. An agent
  that controls its machine can read any secret its process can. Use this only for
  your own account, and accept that risk knowingly.

## License

[MIT](./LICENSE) © Alberto Marturelo Lorenzo.
