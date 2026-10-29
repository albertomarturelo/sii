# @albertomarturelo/sii-cli

Command-line interface for Chile's **SII** (Servicio de Impuestos Internos), for a
single user acting on their own RUT plus the empresas they represent. Authenticated
**reads** — RCV, F22, F29, boletas de honorarios (BHE), DTE-authorized (public),
peticiones administrativas, bienes raíces, whoami — plus a confirm-gated BHE **emit**. Runs
unattended too (cron, CI, agents), with no browser and no keyboard. A thin
surface over [`@albertomarturelo/sii-core`](https://www.npmjs.com/package/@albertomarturelo/sii-core);
all the legal/operational guardrails live in the core.

> ⚠️ **Unofficial.** Not affiliated with or endorsed by the SII. Provided "as is"
> (MIT, no warranty). You are responsible for the SII's terms of service and
> Chilean law. The account locks after repeated failed logins — never retry after
> a block.

## Install

```bash
npm i -g @albertomarturelo/sii-cli
# only the MIPYME `dte` commands run SII's page JS and need Chromium once:
npx playwright install chromium
```

Requires **Node ≥ 20**. Login needs no browser (ADR-027): you type your RUT + Clave
in the terminal (hidden), and only the session cookies are stored. The Clave never
reaches disk in plaintext (ADR-006).

## Usage

```bash
sii auth login                 # RUT + hidden Clave in the terminal; cookies-only
sii auth login --keyring       # the Clave you stored in the OS keyring (service "sii")
sii auth login --rut <rut> --clave-env SII_CLAVE   # unattended: the Clave from a NAMED env var
sii auth status                # who am I / operating as whom / is unattended login blocked
sii auth unblock               # lift the block after fixing the Clave (terminal only)
sii peticiones list            # administrative requests + their state timeline
sii bienes-raices list         # predios you pay contribuciones for + unpaid cuotas
sii rcv summary 2026-05        # RCV (compras) summary for a period
sii rcv all 2026-05            # RCV (compras) — every doc type in one flat table
sii f29 overview 2026          # month-by-month IVA position
sii dte authorized 77777777-7  # public consulta — no login
sii bte emit … --confirm <monto>   # issue a BHE (defaults to a safe preview)
```

`sii auth login --www2` and `sii carpeta` left the CLI in 0.11.0: the www2 session needs
SII's OAuth page, where reCAPTCHA runs. Both remain in the MCP server.

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

Three rules govern every login: the Clave's source is always named; a live session for
that RUT means nothing is sent; and after SII rejects a Clave, unattended logins refuse
**without contacting SII** until a person fixes the Clave and lifts the latch
(`sii auth login --console`, or `sii auth unblock`, which refuses without a terminal). `sii auth status`
reports both the session and the latch (`loginBlocked`), so check it first.

The agent's loop: `auth status` → stop and tell a human if `loginBlocked` names its RUT →
run the command → on `type` `session_expired` / `not_authenticated` (exit `2`), log in and
retry once → on any other error, stop. Errors go to STDERR as `{ error, type, exitCode, reason?,
codigo? }`: branch on `type`, never on the Spanish text (the kinds are listed in ADR-012). Persist
`~/.sii/` across runs. Forbid `sii auth unblock` in the agent's instructions: its TTY check
stops a cron or a plain-pipe agent, but many harnesses run commands in a pseudo-terminal. Provision `SII_CLAVE` through the platform's masked secret field,
never `echo` it, never type it into the agent's chat, and use this only for your own
account: an agent that controls its machine can read any secret its process can. The
full guide, with the state table, is in the
[project README](https://github.com/albertomarturelo/sii#cómo-funciona-el-login).

## License

[MIT](./LICENSE) © Alberto Marturelo Lorenzo.
