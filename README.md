# sii (TypeScript)

Núcleo TypeScript + CLI + servidor MCP para automatizar interacciones rutinarias
con el SII de Chile, para un usuario sobre su propio RUT y las empresas que está
autorizado a representar. Pensado para usarse tanto en **Claude Code** como en
**Claude Desktop**.

Reescritura desde cero en TypeScript del `sii-cli` (Python) ya probado: el
conocimiento del SII y los guardrails se **portan**; el código se escribe nuevo.

> ⚠️ En etapa de **scaffolding CFD**: no hay lógica de negocio todavía. Lo que
> existe es la estructura del monorepo, la capa de contexto y las decisiones
> fundacionales (ADRs). Ver [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md).

## Estructura

```text
packages/
  core/   @sii/core   Núcleo de dominio (librería Node). Las superficies llaman solo a sus tasks.
  cli/    @sii/cli     CLI humana (terminal). También lo que Claude Code corre vía Bash.
  mcp/    @sii/mcp     Servidor MCP (stdio). El punto de integración para Claude Code y Claude Desktop.
docs/                  Capa de contexto CFD (ARCHITECTURE, CONVENTIONS, ADRs…).
```

Un solo núcleo (`@sii/core`) respalda ambas superficies, así que todos los
guardrails legales y operativos (throttling, auditoría, manejo de credenciales,
el modelo de identidad operate-céntrico) aplican sin importar la superficie.
Las dependencias externas (driver del portal, secretos, sesión, auditoría,
reloj) viven detrás de *seams* inyectables para que los tests no toquen el SII
real. Ver [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Cómo se usa con Claude

- **Claude Desktop** — conecta el servidor MCP (`sii-mcp`, stdio) vía
  `claude_desktop_config.json`.
- **Claude Code** — conecta el mismo MCP (`.mcp.json` / `claude mcp add`), y/o
  deja que Claude Code use la CLI directamente por Bash.

El Clave Tributaria nunca llega al LLM ni a disco en texto plano: login por
navegador (cookies-only) — ningún tool de MCP recibe contraseña. Ver
[ADR-006](docs/decisions/006-auth-posture-browser-cookies-host-secrets.md).

## Modelo de identidad

Una sola cuenta activa a la vez (cambiar de cuenta = `logout` → `login`). Dentro
de la sesión, una cuenta **persona** usa el puntero `operate` para elegir a
nombre de qué RUT actúa (sí misma por defecto, o una empresa que representa). Las
cuentas **empresa** no representan a nadie. Ver
[ADR-005](docs/decisions/005-single-account-operate-centric-identity.md).

## Desarrollo

```bash
pnpm install         # instalar dependencias
pnpm build           # tsc -b (typecheck + build de todos los paquetes)
pnpm test            # vitest
pnpm lint            # eslint
pnpm format          # prettier
```

## Metodología

El repo corre bajo **Context-First Development (CFD)**: decisiones-antes-de-código
(ADRs), una capa de contexto que cada sesión lee primero, y slash commands en
`.claude/commands/` (`/session:start`, `/session:close`, `/decision:new`,
`/issue:new`, `/issue:start`, `/review-pr`, `/context:validate`). Ver
[ADR-001](docs/decisions/001-adopt-cfd-methodology.md).

## Licencia

Por definir (ADR de release público pendiente). Sin distribución pública aún.
