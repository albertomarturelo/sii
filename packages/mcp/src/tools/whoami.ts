// `whoami` MCP tool — the authenticated account's own identity. Thin call into the
// @albertomarturelo/sii-core `whoami` task (ADR-003), read-only. EXPOSES the user's OWN PII
// (razón social/nombre + email) TO THE MODEL — the description declares it (ADR-006 /
// CONVENTIONS: a PII-surfacing task states its exposure). Session-keyed: the login
// principal, not the operate pointer. The audit records the read (rut), never the values.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { whoami, type Runtime } from '@albertomarturelo/sii-core';
import { toolText } from '../tool-helpers.js';

export function registerWhoamiTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    'whoami',
    {
      title: 'Cuenta autenticada (whoami)',
      description:
        'Muestra la cuenta con la que estás autenticado en el SII: RUT, tipo (persona/empresa), ' +
        'razón social o nombre, y email. Útil para saber con qué cuenta se está trabajando. ' +
        'EXPONE PII PROPIA del usuario (nombre/razón social + email) al modelo. Lectura en vivo ' +
        'del principal de la sesión (ignora el puntero operate). No recibe argumentos.',
      // readOnly, but it DOES touch SII (a live session restore + portal read), like auth_logout.
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => toolText(async () => JSON.stringify(await whoami(runtime), null, 2)),
  );
}
