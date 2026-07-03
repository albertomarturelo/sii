# sii (TypeScript)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

Núcleo TypeScript + CLI + servidor MCP para automatizar interacciones rutinarias
con el SII de Chile, para un usuario sobre su propio RUT y las empresas que está
autorizado a representar. Pensado para usarse tanto en **Claude Code** como en
**Claude Desktop**.

Reescritura desde cero en TypeScript del `sii-cli` (Python) ya probado: el
conocimiento del SII y los guardrails se **portan**; el código se escribe nuevo.

> ⚠️ **Herramienta no oficial.** Este proyecto **no está afiliado al SII ni
> respaldado por él**. Se entrega "tal cual" (ver [LICENSE](LICENSE)), sin garantía
> de ningún tipo. Cada usuaria/o es responsable de cumplir los términos de servicio
> del SII y la legislación chilena. Automatiza el portal de un ente público: úsalo
> con criterio (la cuenta se bloquea tras intentos fallidos; nunca reintentar tras
> un bloqueo).

## Estado

Superficies de **lectura** operativas y validadas en vivo: autenticación
(`auth`), representación (`operate`), **RCV**, **F22** (status / formulario /
observaciones / historial), **F29** (Fase 1), **BTE/BHE** y **DTE autorizados**
(consulta pública). Primera superficie de **escritura**: `bte emit` (emisión de
Boletas de Honorarios Electrónicas). Ver el detalle en
[`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md) y el checklist completo en
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## Estructura

```text
packages/
  core/   @altumstack/sii-core   Núcleo de dominio (librería Node). Las superficies llaman solo a sus tasks.
  cli/    @sii/cli     CLI humana (terminal). También lo que Claude Code corre vía Bash.
  mcp/    @sii/mcp     Servidor MCP (stdio). El punto de integración para Claude Code y Claude Desktop.
docs/                  Capa de contexto CFD (ARCHITECTURE, CONVENTIONS, ADRs…).
```

Un solo núcleo (`@altumstack/sii-core`) respalda ambas superficies, así que todos los
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

Requiere Node `>=20` y el pnpm fijado en `packageManager` (`package.json`).

## Metodología

El repo corre bajo **Context-First Development (CFD)**: decisiones-antes-de-código
(ADRs), una capa de contexto que cada sesión lee primero, y slash commands en
`.claude/commands/` (`/session:start`, `/session:close`, `/decision:new`,
`/issue:new`, `/issue:start`, `/review-pr`, `/context:validate`). Ver
[ADR-001](docs/decisions/001-adopt-cfd-methodology.md).

## Seguridad

Nunca subas secretos ni PII real (RUT, Clave, cookies, nombres, montos). Para
reportar una vulnerabilidad y ver la postura de seguridad, lee
[`SECURITY.md`](SECURITY.md).

## Contribuir

Las contribuciones son bienvenidas — parte por [`CONTRIBUTING.md`](CONTRIBUTING.md)
y la capa de contexto en [`docs/`](docs/).

## Licencia

[MIT](LICENSE) © 2026 Alberto Marturelo Lorenzo. Ver
[ADR-018](docs/decisions/018-public-release-mit-license.md).
