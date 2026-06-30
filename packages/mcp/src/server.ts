// The `sii` MCP stdio server (ADR-003): every Resource/Tool is a thin call into a
// @altumstack/sii-core task — it never reaches past the task layer. The Clave NEVER crosses
// this boundary: auth_login delegates to the browser flow and takes no password
// argument (ADR-006). consoleLogin is deliberately unreachable here — it lives in
// the CLI-only `@altumstack/sii-core/cli` subpath, which this package never imports.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  HOSTS,
  Rut,
  authStatus,
  formatOperableEntry,
  listOperable,
  login,
  logout,
  operate,
  operateSelf,
  operatingStatus,
  statusRefresh,
  type OperatingContext,
  type Runtime,
} from '@altumstack/sii-core';
import { toolText } from './tool-helpers.js';
// Domain read surfaces — each module owns a tools/<mod>.ts register fn (append-only).
import { registerRcvTools } from './tools/rcv.js';
import { registerF22Tools } from './tools/f22.js';
import { registerF29Tools } from './tools/f29.js';
import { registerDteTools } from './tools/dte.js';
import { registerBteTools } from './tools/bte.js';

const fmt = (canonicalRut: string): string => Rut.parse(canonicalRut).formatted;

function describeOperating(ctx: OperatingContext): string {
  if (ctx.isSelf) return `Operando como tú mismo: ${fmt(ctx.operatingRut)}.`;
  return `Operando como ${fmt(ctx.operatingRut)}${ctx.razonSocial ? ` (${ctx.razonSocial})` : ''}.`;
}

const jsonResource = (uri: URL, value: unknown) => ({
  contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }],
});

/** Build the MCP server over an injected Runtime (tests pass fakes; no SII). */
export function buildServer(runtime: Runtime): McpServer {
  const server = new McpServer({ name: 'sii', version: '0.0.0' });

  // --- Resources: read-only context the model reads to orient (ROADMAP) ---
  server.registerResource(
    'session',
    'sii://session',
    {
      title: 'Sesión SII',
      description: 'Estado LOCAL de la sesión (autenticado, RUT, fuente). No toca el portal.',
      mimeType: 'application/json',
    },
    async (uri) => jsonResource(uri, await authStatus(runtime)),
  );

  server.registerResource(
    'operating',
    'sii://operating',
    {
      title: 'Operando como',
      description:
        'RUT operativo actual (tú mismo o una empresa representada). null si no hay sesión.',
      mimeType: 'application/json',
    },
    async (uri) => jsonResource(uri, await operatingStatus(runtime)),
  );

  server.registerResource(
    'operable',
    'sii://operable',
    {
      title: 'Conjunto operable',
      description:
        'RUT que la cuenta puede operar (tú mismo + empresas representadas). null si no hay sesión.',
      mimeType: 'application/json',
    },
    async (uri) => jsonResource(uri, await listOperable(runtime)),
  );

  server.registerResource(
    'config',
    'sii://config',
    {
      title: 'Configuración SII',
      description: 'Hostnames de producción del SII (única fuente de verdad, ADR-004).',
      mimeType: 'application/json',
    },
    async (uri) => jsonResource(uri, HOSTS),
  );

  // --- Tools: actions, each a thin call into a @altumstack/sii-core task ---
  // NOTE: auth_login can block up to the browser-login budget (~180s) while the
  // user types the Clave into SII's page. Some MCP clients enforce a shorter
  // tool-call timeout — confirm/tune the budget when live-validating in Claude
  // Desktop (a credential-free, CLI-only fast path stays out of MCP by design).
  server.registerTool(
    'auth_login',
    {
      title: 'Iniciar sesión (navegador)',
      description:
        'Abre el navegador en la página del SII para que el usuario escriba su Clave Tributaria. ' +
        'NUNCA recibe la Clave como argumento (ADR-006); persiste solo cookies. Idempotente sobre una sesión viva.',
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    () =>
      toolText(async () => {
        const r = await login(runtime);
        return r.reason === 'already_authenticated'
          ? `Ya tienes una sesión activa como ${fmt(r.rut)}.`
          : `Sesión iniciada como ${fmt(r.rut)}.`;
      }),
  );

  server.registerTool(
    'auth_status',
    {
      title: 'Estado de sesión',
      description:
        'Lectura LOCAL de la sesión (quién soy, operando-como). refresh=true lee la identidad desde el portal (requiere sesión viva).',
      inputSchema: { refresh: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ refresh }) =>
      toolText(async () => {
        if (refresh) {
          const id = await statusRefresh(runtime);
          return `RUT: ${fmt(id.rut)}\nNombre: ${id.nombre ?? '—'}\nTipo: ${id.accountType}`;
        }
        const s = await authStatus(runtime);
        if (!s.authenticated || !s.rut) return 'No autenticado. Usa la tool auth_login.';
        const ctx = await operatingStatus(runtime);
        const op = ctx && !ctx.isSelf ? `\n${describeOperating(ctx)}` : '';
        return `Autenticado (sesión local) como ${fmt(s.rut)}.${op}`;
      }),
  );

  // logout carries NO secret (best-effort server close + local cookie wipe), so
  // ADR-006 does not bar it from MCP — switching accounts is logout→login (ADR-005).
  server.registerTool(
    'auth_logout',
    {
      title: 'Cerrar sesión',
      description:
        'Cierra la sesión: intenta cerrarla en el servidor (mejor esfuerzo) y borra las cookies locales. ' +
        'No recibe argumentos. Para cambiar de cuenta: auth_logout y luego auth_login.',
      // Touches SII: the best-effort server-side close is a real portal call (like auth_login).
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    () =>
      toolText(async () => {
        const r = await logout(runtime);
        if (!r.loggedOut) return 'No había sesión activa.';
        return r.serverClosed ? 'Sesión cerrada (servidor y local).' : 'Sesión cerrada (local).';
      }),
  );

  server.registerTool(
    'operate',
    {
      title: 'Operar como',
      description:
        'Selecciona el RUT bajo el que operas: una empresa representada (rut) o tú mismo (self=true). ' +
        'list=true LISTA los RUT que puedes operar (tú mismo + empresas representadas). ' +
        'Validado contra el conjunto operable. Sin argumentos, reporta el contexto actual.',
      inputSchema: {
        rut: z.string().optional(),
        self: z.boolean().optional(),
        list: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    ({ rut, self, list }) =>
      toolText(async () => {
        if (list) {
          const result = await listOperable(runtime);
          if (!result) return 'No hay sesión activa. Usa la tool auth_login.';
          return result.operable.map((e) => formatOperableEntry(e, result.operatingRut)).join('\n');
        }
        if (self) {
          const r = await operateSelf(runtime);
          return `Operando como tú mismo: ${fmt(r.context.selfRut)}.`;
        }
        if (rut) return describeOperating((await operate(runtime, rut)).context);
        const ctx = await operatingStatus(runtime);
        return ctx ? describeOperating(ctx) : 'No hay sesión activa. Usa la tool auth_login.';
      }),
  );

  // --- domain read surfaces (one register call per module — append-only) ---
  registerRcvTools(server, runtime);
  registerF22Tools(server, runtime);
  registerF29Tools(server, runtime);
  registerDteTools(server, runtime);
  registerBteTools(server, runtime);

  return server;
}
