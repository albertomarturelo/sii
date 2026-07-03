# @albertomarturelo/sii-mcp

**MCP (Model Context Protocol) server** — over stdio — that exposes Chile's **SII**
(Servicio de Impuestos Internos) to **Claude Desktop** and **Claude Code**.
Authenticated **reads** — RCV, F22, F29, boletas de honorarios (BHE),
DTE-authorized (public), peticiones administrativas, whoami — as `readOnly` tools,
plus a `destructive`, confirm-gated BHE **emit**. A thin surface over
[`@albertomarturelo/sii-core`](https://www.npmjs.com/package/@albertomarturelo/sii-core);
all the guardrails live in the core, and **no tool ever receives your password**
(login delegates to a browser flow — ADR-006).

> ⚠️ **Unofficial.** Not affiliated with or endorsed by the SII. Provided "as is"
> (MIT, no warranty). You are responsible for the SII's terms of service and
> Chilean law.

## Install

```bash
npm i -g @albertomarturelo/sii-mcp @albertomarturelo/sii-cli
# the browser login needs Chromium once (~100–150 MB):
npx playwright install chromium
```

Requires **Node ≥ 20**. (The `sii` CLI is handy for the first `sii auth login`;
the login can also run through the `auth_login` tool.)

## Connect to Claude

**Claude Desktop** — add to `claude_desktop_config.json` and restart the app
(macOS: `~/Library/Application Support/Claude/`; Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "sii": { "command": "sii-mcp" }
  }
}
```

**Claude Code**:

```bash
claude mcp add sii -- sii-mcp
```

Then ask in natural language — e.g. «muéstrame el RCV de compras de 2026-05» or
«¿tengo peticiones administrativas detenidas?». Read tools change nothing; issuing
a BHE (`bte_emit`) requires an explicit confirmation + amount echo.

Tools, resources, prompts, and the identity model are documented in the
[project README](https://github.com/albertomarturelo/sii#readme).

## License

[MIT](./LICENSE) © Alberto Marturelo Lorenzo.
