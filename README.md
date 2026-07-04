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
observaciones / historial), **F29** (Fase 1), **BTE/BHE**, **DTE autorizados**
(consulta pública), **whoami** y **peticiones administrativas** (SISPAD). Primera
superficie de **escritura**: `bte emit` (emisión de Boletas de Honorarios
Electrónicas). Ver el detalle en
[`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md) y el checklist completo en
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## Estructura

```text
packages/
  core/   @albertomarturelo/sii-core   Núcleo de dominio (librería Node). Las superficies llaman solo a sus tasks.
  cli/    @albertomarturelo/sii-cli     CLI humana (terminal). También lo que Claude Code corre vía Bash.
  mcp/    @albertomarturelo/sii-mcp     Servidor MCP (stdio). El punto de integración para Claude Code y Claude Desktop.
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

## Instalación y uso

Para **usarlo** (sin clonar el repo). Requiere **Node ≥ 20**. Para desarrollar,
ver [Desarrollo](#desarrollo).

```bash
# 1) Instala la CLI y el servidor MCP
npm i -g @albertomarturelo/sii-cli @albertomarturelo/sii-mcp

# 2) Instala el navegador que usa el login (una sola vez, ~100–150 MB)
npx playwright install chromium

# 3) Inicia sesión — abre tu navegador en la página REAL del SII;
#    tecleas tu RUT + Clave ahí. La Clave nunca llega al modelo ni a disco.
sii auth login

# 4) Úsalo desde la terminal
sii peticiones list            # ¿tengo trámites detenidos ("en espera de Antecedentes")?
sii rcv summary 2026-05        # resumen del RCV de compras
sii f29 overview 2026          # posición de IVA mes a mes
```

### Conectar el MCP a Claude

El servidor es **stdio** (no requiere hosting): Claude lo lanza como un proceso.

**Claude Desktop** — añade a `claude_desktop_config.json` y reinicia la app
(macOS: `~/Library/Application Support/Claude/`; Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "sii": { "command": "sii-mcp" }
  }
}
```

**Claude Code** — un comando:

```bash
claude mcp add sii -- sii-mcp
```

Luego pídele en lenguaje natural (p. ej. «¿cuál es el estado de mi sesión?» o
«muéstrame el RCV de compras de 2026-05»). Si aún no iniciaste sesión, corre
`sii auth login` primero (o pídele a Claude la herramienta `auth_login`, que abre
tu navegador). Los tools de lectura no cambian nada; emitir una BHE exige
confirmación explícita.

> **Playwright** es la única dependencia con peso: `sii` lo usa para el login por
> navegador (cookies-only, ADR-006). Por eso el paso 2 (`npx playwright install
> chromium`) es obligatorio la primera vez; el paquete npm no descarga navegadores
> automáticamente.

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
- «Dame **todos** los documentos del RCV de compras de 2026-05 en una sola tabla.» → `rcv_all`
- «¿Cómo quedó mi declaración de renta (F22) del año tributario 2025?» → `f22_status` / `f22_formulario`
- «¿Tengo observaciones en el F22 de 2025?» → `f22_observaciones`
- «¿Cuál es mi posición de IVA mes a mes en el F29 durante 2026?» → `f29_overview`
- «Dame la propuesta del F29 de mayo 2026, agrupada por línea.» → `f29_formulario`
- «¿Qué documentos tributarios está autorizado a emitir el RUT 77.777.777-7?» → `dte_authorized` (público, sin login)
- «Lista las boletas de honorarios que **recibí** en junio 2026.» → `bte_list`
- «¿Tengo peticiones administrativas detenidas ante el SII (en espera de antecedentes)?» → `peticiones_list`
- «¿A nombre de quién estoy registrado — razón social y correo?» → `whoami`
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
| `sii rcv list <periodo> [--compra\|--venta] [--rut]` | Detalle de documentos de UN tipo del RCV |
| `sii rcv all <periodo> [--venta] [--rut]` | Detalle de TODOS los tipos del RCV en una tabla plana (una sola sesión) |
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
| `sii peticiones list [--rut]` | Peticiones administrativas (SISPAD) + su timeline de estados |
| `sii whoami` | Razón social/nombre + correo de la cuenta autenticada |

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
