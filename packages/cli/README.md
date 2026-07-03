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
# the browser login needs Chromium once (~100–150 MB):
npx playwright install chromium
```

Requires **Node ≥ 20**. Login opens your real browser on the SII page — you type
your RUT + Clave there; the password never reaches disk in plaintext (cookies-only,
ADR-006).

## Usage

```bash
sii auth login                 # browser, cookies-only (--console for a terminal prompt)
sii auth status                # who am I / operating as whom
sii peticiones list            # administrative requests + their state timeline
sii rcv summary 2026-05        # RCV (compras) summary for a period
sii f29 overview 2026          # month-by-month IVA position
sii dte authorized 77777777-7  # public consulta — no login
sii bte emit … --confirm <monto>   # issue a BHE (defaults to a safe preview)
```

Output is **JSON by default** (pipe to `jq`); add `--human` for a readable render.
The `operando como …` header goes to STDERR. Full command list, the identity model
(`operate`), and the MCP server are documented in the
[project README](https://github.com/albertomarturelo/sii#readme).

## License

[MIT](./LICENSE) © Alberto Marturelo Lorenzo.
