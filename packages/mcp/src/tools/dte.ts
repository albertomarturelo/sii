// `dte_*` MCP tools — Documentos Tributarios Electrónicos. Thin calls into @altumstack/sii-core
// tasks (ADR-003), read-only. zod input schemas (ADR-011) — the SDK derives the protocol
// JSON Schema. `dte_authorized` is the PUBLIC, login-free consulta (ADR-014): no session,
// any RUT — it is not gated by an operate pointer and takes no `rut` override concept.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { dteAuthorized, type Runtime } from '@altumstack/sii-core';
import { toolText } from '../tool-helpers.js';

export function registerDteTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    'dte_authorized',
    {
      title: 'DTE autorizados (consulta pública)',
      description:
        'Consulta PÚBLICA (sin login) de los tipos de DTE que un RUT está autorizado a emitir. ' +
        'Funciona para CUALQUIER RUT (no requiere sesión, no toca ninguna cuenta). Devuelve el ' +
        'detalle curado (razón social, resolución, documentos autorizados) o, si el RUT no es ' +
        'emisor, autorizado=false con el mensaje verbatim del SII.',
      inputSchema: { rut: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ rut }) =>
      toolText(async () => JSON.stringify(await dteAuthorized(runtime, { rut }), null, 2)),
  );
}
