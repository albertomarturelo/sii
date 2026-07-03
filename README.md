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
  core/   @albertomarturelo/sii-core   Núcleo de dominio (librería Node). Las superficies llaman solo a sus tasks.
  cli/    @sii/cli     CLI humana (terminal). También lo que Claude Code corre vía Bash.
  mcp/    @sii/mcp     Servidor MCP (stdio). El punto de integración para Claude Code y Claude Desktop.
docs/                  Capa de contexto CFD (ARCHITECTURE, CONVENTIONS, ADRs…).
```

Un solo núcleo (`@albertomarturelo/sii-core`) respalda ambas superficies, así que todos los
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

## Capacidades

Ambas superficies exponen las mismas operaciones sobre el SII (un solo núcleo):
el **MCP** las ofrece como *tools* a Claude; la **CLI**, como comandos `sii …`.

### Vía MCP (Claude Desktop / Claude Code)

Claude ve las operaciones como herramientas con permiso configurable por
herramienta (lectura vs escritura). Las de **escritura** —iniciar/cerrar sesión,
operar como, y **emitir** una BHE— quedan controladas: `bte_emit` es la única
`destructive` y exige confirmación explícita.

![Herramientas del conector `sii` en Claude Desktop — 13 de lectura + 4 de escritura/borrado](docs/assets/mcp-tools-claude-desktop.png)

**Ejemplos de prompts** (lenguaje natural; Claude elige la herramienta):

- «¿Cuál es el estado de mi sesión y a nombre de qué RUT estoy operando?» → `auth_status`
- «Muéstrame el resumen del RCV de **compras** del período 2026-05.» → `rcv_summary`
- «Lista el detalle de ventas del RCV de 2026-05.» → `rcv_list`
- «¿Cómo quedó mi declaración de renta (F22) del año tributario 2025?» → `f22_status` / `f22_formulario`
- «¿Tengo observaciones en el F22 de 2025?» → `f22_observaciones`
- «¿Cuál es mi posición de IVA mes a mes en el F29 durante 2026?» → `f29_overview`
- «Dame la propuesta del F29 de mayo 2026, agrupada por línea.» → `f29_formulario`
- «¿Qué documentos tributarios está autorizado a emitir el RUT 76.192.083-9?» → `dte_authorized` (público, sin login)
- «Lista las boletas de honorarios que **recibí** en junio 2026.» → `bte_list`
- «Simula una boleta de honorarios de $500.000 a un cliente (sin emitir).» → `bte_emit_preview`
- «Cambia a operar como la empresa que represento.» → `operate`

> Emitir una BHE de verdad (`bte_emit`) **no** ocurre por un prompt suelto: es una
> herramienta `destructive` que pide confirmación explícita + el monto en eco
> (ADR-017). El login abre tu navegador en la página real del SII — la Clave nunca
> llega al modelo.

### Vía CLI (`sii`)

Salida **JSON por defecto** (pipeable a `jq`); `--human` para lectura. El header
`operando como …` va a STDERR.

| Comando | Qué hace |
|---|---|
| `sii auth login [--console]` | Inicia sesión (navegador cookies-only; `--console` pide la Clave por terminal) |
| `sii auth status [--refresh]` | Quién soy / a nombre de quién opero (`--refresh` lee del portal) |
| `sii auth logout` | Cierra sesión (cierre server best-effort + wipe local) |
| `sii operate <rut> \| --self \| --list` | Elige el RUT a nombre del cual actuar / lista el set operable |
| `sii rcv summary <periodo>` | Resumen del Registro de Compras y Ventas |
| `sii rcv list <periodo> [--compra\|--venta] [--rut]` | Detalle de documentos del RCV |
| `sii f22 status [año]` | Estado de la Renta anual (F22); sin año → overview multi-año |
| `sii f22 formulario <año>` | Formulario F22 completo, agrupado (ingresos/deducciones/retenciones/resultado) |
| `sii f22 observaciones <año> [--folio]` | Observaciones/inconsistencias del F22 |
| `sii f22 historial <año> [--folio]` | Línea de tiempo de eventos del F22 (devoluciones, giros, rectificatorias) |
| `sii f29 formulario <periodo>` | Propuesta de IVA (F29) etiquetada + agrupada |
| `sii f29 overview <desde> <hasta> \| <año>` | Posición de IVA mes a mes en un rango |
| `sii f29 status <periodo>` | Estado del F29 de un mes |
| `sii bte list <periodo> [--recibidas\|--emitidas]` | Boletas de honorarios de un mes |
| `sii bte emit …` (`--confirm <monto>`) | Emite una BHE — por defecto vista previa; la emisión real exige `--confirm` |
| `sii dte authorized <rut>` | Consulta pública: qué DTE puede emitir un RUT (sin login) |

Las superficies **session-keyed** (`f22`, `f29`, `bte`) leen siempre el principal
de la sesión (sin `--rut`); la **body-RUT** (`rcv`) acepta `--rut` / `operate`
para llegar a una empresa representada (ADR-005).

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
