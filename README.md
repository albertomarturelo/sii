# sii (TypeScript)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

Núcleo TypeScript + CLI + servidor MCP para automatizar interacciones rutinarias
con el SII de Chile, para un usuario sobre su propio RUT y las empresas que está
autorizado a representar. Pensado para usarse en **Claude Code** y **Claude Desktop**,
y también para que un **agente** (un bot, un cron, un CI) opere la cuenta sin nadie al
teclado a través de la CLI ([Uso autónomo](#uso-autónomo-agentes-cron-ci)).

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
(consulta pública), **whoami** y **peticiones administrativas** (SISPAD).

El login de la CLI **no usa navegador**
([ADR-027](docs/decisions/027-http-portal-driver.md)): es un POST directo al formulario
del SII y se guardan solo cookies. La Clave puede venir de cuatro fuentes, siempre
nombradas en la línea de comandos y sin respaldo implícito de una a otra:
- la **consola** (por defecto, Clave oculta);
- el **llavero del sistema** (`--keyring`, la Clave que tú guardaste en Keychain o Secret
  Service; [ADR-025](docs/decisions/025-keyring-secret-store.md));
- una **variable de entorno que nombras** (`--clave-env <VAR>`);
- **stdin** (`--clave-stdin`).

Las dos últimas existen para el uso desatendido (cron, CI, agentes). Las reglas del
login y del bloqueo tras un rechazo están en [Cómo funciona el login](#cómo-funciona-el-login).
La CLI nunca escribe la Clave en ningún lado. El servidor MCP no tiene acceso al llavero ni recibe la Clave: su `auth_login` abre
tu navegador en la página real del SII.

**Carpeta Tributaria**: `carpeta instituciones` lee la lista vigente de instituciones
destinatarias directamente del SII (los códigos cambian, así que no se empaqueta ninguno).
Vive en la plataforma **www2** del SII, que autoriza con una **sesión propia**: un segundo
login cookies-only en el que tecleas la Clave en la página OAuth real del SII, nunca
headless, porque ahí corre reCAPTCHA
([ADR-026](docs/decisions/026-www2-app-session-login.md)). Esa sesión la abre solo el MCP
(`auth_login` con `www2`), así que **la Carpeta es solo MCP**
([ADR-027](docs/decisions/027-http-portal-driver.md)). Ambas sesiones conviven en el mismo
archivo; `auth status` las muestra y `auth logout` cierra las dos.

Primera superficie de **descarga de documentos**: `f29 pdf`, que guarda en disco
el F29 presentado de un mes —el formulario tal como lo imprime el SII y, cuando el
período fue pagado, **su comprobante de pago**— y el Certificado de Declaración.

Primera superficie de **escritura**: `bte emit` (emisión de Boletas de Honorarios
Electrónicas).

**Facturación por el Portal MIPYME** (`sii dte`): prepara una factura (DTE 33/34) con
la Clave —sin certificado digital—, la guarda como **borrador**, te da el PDF de vista
previa, y lee los documentos que una empresa ya emitió por el portal, con sus PDF.
**Solo borradores: la emisión no está implementada a propósito** — la firma ahí es del
lado del servidor, así que la Clave sola bastaría para emitir un documento con validez
legal, y ese paso irreversible queda contigo en la UI del SII
([ADR-023](docs/decisions/023-factura-borradores-only.md)).

**Novedades en 0.11.0:** la CLI ya no usa navegador y puede operar sin teclado (variable
de entorno o stdin, con un bloqueo que protege la cuenta tras un rechazo de Clave). Qué se
decidió y por qué: [Decisiones de 0.11.0](#decisiones-de-0110).

Checklist completo en [`docs/ROADMAP.md`](docs/ROADMAP.md); el historial de
versiones, en [`CHANGELOG.md`](CHANGELOG.md).

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
- **Otros agentes, cron o CI** — usan la CLI con la Clave desde una variable de entorno;
  ver [Uso autónomo](#uso-autónomo-agentes-cron-ci). El MCP no sirve para eso a propósito:
  ningún tool recibe la Clave.

La Clave Tributaria nunca llega a disco en texto plano y ningún tool de MCP recibe
contraseña: el `auth_login` del MCP abre tu navegador en la página real del SII
(cookies-only). Ver
[ADR-006](docs/decisions/006-auth-posture-browser-cookies-host-secrets.md).

## Instalación y uso

Para **usarlo** (sin clonar el repo). Requiere **Node ≥ 20**. Para desarrollar,
ver [Desarrollo](#desarrollo).

```bash
# 1) Instala la CLI y el servidor MCP
npm i -g @albertomarturelo/sii-cli @albertomarturelo/sii-mcp

# 2) Solo si usarás el login del MCP, `bte list` o `sii dte` (Portal MIPYME):
#    el navegador que ejecuta el JS del SII (una sola vez, ~100–150 MB)
npx playwright install chromium

# 3) Inicia sesión: RUT + Clave oculta en la terminal, sin navegador.
#    Se guardan solo cookies; la Clave nunca llega a disco.
sii auth login

#    Alternativa sin tipear: guarda la Clave en el llavero del sistema y usa --keyring
#    secret-tool store --label='SII' service sii username <tu-rut>       # Linux
#    security add-generic-password -s sii -a <tu-rut> -w                  # macOS
#    sii auth login --keyring --rut <tu-rut>                         # un intento, sin re-login automático
#    Desatendido (cron / agentes): la Clave desde una variable que NOMBRAS (ADR-028)
#    sii auth login --rut <tu-rut> --clave-env SII_CLAVE

# 4) Úsalo desde la terminal
sii peticiones list            # ¿tengo trámites detenidos ("en espera de Antecedentes")?
sii rcv summary 2026-05        # resumen del RCV de compras
sii f29 overview 2026          # posición de IVA mes a mes
sii f29 pdf 2026-05            # descarga el PDF del F29 de mayo
sii dte emitidos --empresa <rut>   # documentos emitidos por el Portal MIPYME
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

> **Playwright** es la única dependencia con peso, y ya no es obligatoria
> ([ADR-027](docs/decisions/027-http-portal-driver.md)). El login de la CLI y casi todas
> las lecturas van por HTTP. Chromium solo hace falta para el login del MCP, `bte list`
> y el Portal MIPYME (`sii dte`), donde debe correr el JS del propio SII. El paquete npm
> no descarga navegadores automáticamente.

## Cómo funciona el login

Tres reglas para la CLI. Todo lo demás es detalle. (El `auth_login` del MCP sigue la
regla 2 sin elegir RUT, porque tecleas la Clave en la página del SII, y un login exitoso
ahí levanta el bloqueo de la regla 3.)

1. **`login` crea una sesión a partir de la Clave**, y de dónde sale la Clave se dice
   siempre en el comando (consola, `--keyring`, `--clave-env`, `--clave-stdin`). En disco
   quedan solo cookies.
2. **Si ya hay sesión viva para ese RUT, `login` no envía nada.** Si la sesión viva es de
   otro RUT, es un error: cambiar de cuenta es `logout` y luego `login`.
3. **Si el SII rechaza la Clave, los logins sin persona dejan de intentar.** Se escribe un
   bloqueo local (`~/.sii/login-blocked.json`, por RUT, sin ningún secreto) y desde ahí
   `--clave-env`, `--clave-stdin` y `--keyring` se niegan **sin contactar al SII**. Lo
   levanta una persona, después de corregir la Clave: con un login por consola exitoso o
   con `sii auth unblock` (que se niega sin terminal). Un rechazo nunca se reintenta solo,
   porque cada intento fallido acerca la cuenta al bloqueo del SII.

`sii auth status` muestra las dos cosas que importan: si hay sesión y si hay bloqueo.

| `auth status` dice | Qué significa | Qué hacer |
|---|---|---|
| `authenticated: true` | Hay sesión guardada (`--refresh` la comprueba en el portal) | Operar. |
| `authenticated: false`, `loginBlocked: []` | No hay sesión y la Clave no ha sido rechazada | `sii auth login`. |
| `loginBlocked: [{rut, at, codigo}]` | El SII rechazó la Clave de ese RUT en la fecha `at` | Una persona corrige la Clave y levanta el bloqueo. Hasta entonces el login desatendido de ese RUT se niega. |

Las decisiones detrás: [ADR-027](docs/decisions/027-http-portal-driver.md) (login sin
navegador) y [ADR-028](docs/decisions/028-non-interactive-login.md) (fuentes
desatendidas y bloqueo).

## Uso autónomo (agentes, cron, CI)

Un agente (o un cron) puede iniciar sesión y operar la cuenta sin nadie al teclado,
usando la **CLI**. El MCP no sirve para esto a propósito: ningún tool recibe la Clave.

```bash
npm i -g @albertomarturelo/sii-cli                      # ≥ 0.11.0
# Provisiona SII_CLAVE desde el campo de secretos de la plataforma (enmascarado).
sii auth login --rut 11111111-1 --clave-env SII_CLAVE   # regla 2: con sesión viva no envía nada
sii f29 overview 2026                                   # JSON en STDOUT
```

El ciclo del agente, en cada ejecución:

1. `sii auth status`. Si `loginBlocked` incluye su RUT, **se detiene y avisa a una
   persona**; no intenta nada más.
2. Corre el comando que necesita. Si falla con `session_expired` o `not_authenticated`,
   hace el `auth login` de arriba y reintenta el comando **una vez**.
3. Ante cualquier otro error, **se detiene y avisa**. Ningún error de login se reintenta.

Los errores van por STDERR como un objeto JSON. El agente decide por `type`, nunca por el
texto del mensaje:

```json
{ "error": "<mensaje del SII, tal cual>", "type": "login_rejected", "exitCode": 3,
  "reason": "wrong-clave", "codigo": "<código del SII>" }
```

| `type` | Qué pasó | Salida | El agente |
| --- | --- | --- | --- |
| `not_authenticated` / `session_expired` | No hay sesión, o murió | 2 | `auth login` y reintenta una vez |
| `www2_session_required` | Falta la sesión www2, que solo abre el MCP | 2 | Se detiene: un agente no puede abrirla |
| `login_rejected` | El SII rechazó la Clave; el bloqueo quedó puesto | 3 | Se detiene y avisa: hay que corregir la Clave |
| `login_blocked` | El bloqueo negó el login sin contactar al SII | 3 | Se detiene y avisa; **nunca** `auth unblock` |
| `login_queued` | Sala de espera del SII; la Clave no se evaluó | 3 | Se detiene; lo intentará la próxima ejecución |
| `login_failed` | Otro fallo de login: la variable no existe, Clave vacía, timeout | 3 | Se detiene y avisa |
| `rate_limited` | Límite o bloqueo del SII | 4 | Se detiene; nunca reintenta |
| `validation`, `credential_not_found`, `browser_required` | El comando o la máquina están mal configurados | 1 | Se detiene y avisa |
| `sii_error`, `unexpected_response`, `unexpected` | El SII rechazó la operación, o algo cambió | 1 | Se detiene y avisa |

`reason` y `codigo` solo vienen en los `login_*` (`codigo` es `null` si el SII no imprimió
ninguno). Un `type` desconocido se trata como `unexpected`. Los tipos no cambian de nombre;
la lista completa está en [ADR-012](docs/decisions/012-json-default-output.md).

- **Persiste `~/.sii/`** entre ejecuciones: ahí viven la sesión, el puntero `operate` y
  el bloqueo. Un contenedor efímero haría un login nuevo cada vez.
- **Prohíbele `sii auth unblock` en sus instrucciones.** El comando se niega sin terminal,
  lo que frena a un cron o a un agente que corre comandos por tuberías. Pero muchos
  agentes corren sus comandos en una pseudo-terminal, y ahí la verificación no los frena.
- **Nunca** hagas `echo` de la variable ni teclees la Clave en el chat del agente.
- **Lo que un agente no puede usar:** la Carpeta Tributaria (su sesión www2 exige
  reCAPTCHA en un navegador) y el login del MCP. `bte list` y `sii dte` necesitan
  Chromium instalado en la máquina del agente.
- **Riesgo residual, que aceptas tú:** un agente con control de su máquina puede leer
  cualquier secreto de su proceso. Quien lo comprometa (o le inyecte instrucciones)
  obtiene la Clave Tributaria completa. Úsalo solo con tu propia cuenta.

## Decisiones de 0.11.0

Qué cambió en esta versión y por qué, en corto. El detalle está en
[ADR-027](docs/decisions/027-http-portal-driver.md) y
[ADR-028](docs/decisions/028-non-interactive-login.md).

- **La CLI no usa navegador.** El login es un POST directo al formulario real del SII.
  Una CLI que abre una ventana no sirve en un servidor ni para un agente. Chromium queda
  solo donde tiene que correr el JavaScript del propio SII (`bte list`, `sii dte` y el
  login del MCP).
- **Ningún comando de la CLI necesita a una persona frente a un navegador.** Por eso
  `sii auth login --www2` y `sii carpeta` pasaron al MCP: la sesión www2 exige reCAPTCHA.
  Es el principal cambio incompatible; la lista completa está en el [CHANGELOG](CHANGELOG.md).
- **La Clave sale siempre de una fuente nombrada en el comando, sin respaldo.** Nunca
  `--clave <valor>`, que quedaría en el historial del shell y en la transcripción del
  agente. Nunca una variable con nombre por defecto, que podría tomar un valor olvidado.
  Y `--keyring` nunca recurre a una variable si el llavero falla. La variable se borra del
  entorno apenas se lee.
- **No hay `--if-needed`.** Todo login ya revisaba si había una sesión viva y en ese caso
  no enviaba nada. Lo nuevo es que una sesión viva de **otro** RUT es un error, en vez de
  responder «ya autenticado» con la cuenta equivocada.
- **El bloqueo tras un rechazo lo activa cualquier página de error del SII con código**,
  desde cualquier fuente, también la consola, porque ese intento igual cuenta para el
  bloqueo de la cuenta. No lo activan la sala de espera del SII, un timeout ni un error de
  red: en esos casos el SII nunca evaluó la Clave. `auth status` lo muestra
  (`loginBlocked`), para que el agente lo vea antes de intentar.
- **`sii auth unblock` exige una terminal, y eso no basta.** Frena a un cron o a un agente
  que corre comandos por tuberías, pero no a uno que los corre en una pseudo-terminal.
  Por eso las instrucciones del agente deben prohibírselo.
- **El MCP no gana ninguna fuente de Clave.** Las tareas nuevas viven en el subpath
  exclusivo de la CLI, y un test verifica que el MCP no puede alcanzarlas.
- **Riesgo aceptado:** un agente con control de su máquina puede leer cualquier secreto
  de su proceso, incluida la Clave. Lo que sí se protege es que la Clave no entre en la
  transcripción del agente, que un bucle con una Clave vieja no bloquee la cuenta, y que
  solo se haga login cuando la sesión murió.

## Capacidades

Ambas superficies exponen las mismas operaciones sobre el SII (un solo núcleo):
el **MCP** las ofrece como *tools* a Claude; la **CLI**, como comandos `sii …`.

### Vía MCP (Claude Desktop / Claude Code)

Claude ve las operaciones como herramientas con permiso configurable por
herramienta (lectura vs escritura). Las de **escritura** —iniciar/cerrar sesión,
operar como, guardar un borrador de factura, y **emitir** una BHE— quedan
controladas. Dos son `destructive` y exigen confirmación explícita: `bte_emit`
(irreversible y con validez legal, más el monto en eco) y `dte_borrador_delete`
(borrar un borrador no se deshace). Guardar un borrador **no** lo es: es
reversible y sin efecto legal, así que no pide ceremonia
([ADR-023](docs/decisions/023-factura-borradores-only.md)). **Emitir** una factura
no está expuesto en ninguna herramienta.

Las herramientas que **descargan documentos** (`f29_pdf`, `dte_pdf`, `dte_preview_pdf`) escriben el archivo en tu
disco y devuelven **solo su ruta y tamaño, nunca el contenido**: un F29 lleva razón
social, domicilio y tu posición financiera completa, así que el documento no entra
en la conversación — lo abres tú desde la ruta que indica.

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
- «Descárgame el PDF del F29 de mayo 2026 con su comprobante de pago.» → `f29_pdf`
- «¿Qué documentos tributarios está autorizado a emitir el RUT 77.777.777-7?» → `dte_authorized` (público, sin login)
- «Prepara un borrador de factura a mi cliente por $1.000.000 y muéstrame el PDF de vista previa.» → `dte_borrador_save` + `dte_preview_pdf` (nunca emite)
- «¿Qué documentos emití en agosto por el portal MIPYME? Bájame el PDF del folio 7.» → `dte_emitidos` + `dte_pdf`
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
| `sii auth login [--console\|--keyring\|--clave-env <VAR>\|--clave-stdin]` | Inicia sesión cookies-only, sin navegador (por defecto pide RUT + Clave oculta por terminal; `--keyring` la lee del llavero del SO; `--clave-env` / `--clave-stdin` para uso desatendido, ADR-028) |
| `sii auth unblock [--rut <rut>]` | Levanta el bloqueo de login desatendido tras un rechazo de Clave (local, no contacta al SII; solo desde una terminal) |
| `sii auth status [--refresh]` | Quién soy / a nombre de quién opero / si hay bloqueo de login (`--refresh` lee del portal) |
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
| `sii f29 pdf <periodo> [--tipo] [--out]` | Descarga el PDF del F29 presentado (y su comprobante de pago) |
| `sii bte list <periodo> [--recibidas\|--emitidas]` | Boletas de honorarios de un mes |
| `sii bte emit …` (`--confirm <monto>`) | Emite una BHE — por defecto vista previa; la emisión real exige `--confirm` |
| `sii dte authorized <rut>` | Consulta pública: qué DTE puede emitir un RUT (sin login) |
| `sii dte empresas` | Empresas del Portal MIPYME para las que estás autorizado a facturar |
| `sii dte borrador list\|save\|delete …` | Borradores de factura (33/34) en el Portal MIPYME — crea, actualiza, lista, elimina; **nunca emite** |
| `sii dte preview <json> [--out]` | PDF de vista previa del documento sin emitir ("DOCUMENTO NO VÁLIDO", sin folio) |
| `sii dte emitidos --empresa <rut> [filtros]` | Documentos ya emitidos vía el Portal MIPYME (todos los tipos), con filtros y paginación |
| `sii dte pdf <folio> --empresa <rut> [--out]` | Descarga el PDF de un documento emitido |
| `sii peticiones list [--rut]` | Peticiones administrativas (SISPAD) + su timeline de estados |
| `sii whoami` | Razón social/nombre + correo de la cuenta autenticada |

Las superficies **session-keyed** (`f22`, `f29`, `bte`) leen siempre el principal
de la sesión (sin `--rut`); la **body-RUT** (`rcv`) acepta `--rut` / `operate`
para llegar a una empresa representada (ADR-005); la **empresa-keyed** (`dte` vía Portal MIPYME)
valida `--empresa` contra la lista del propio portal (ADR-023). Cada `--help` abre con su modo
de autenticación (ADR-024).

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
