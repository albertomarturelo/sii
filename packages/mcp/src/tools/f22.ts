// `f22_status` MCP tool — Declaración Anual de Renta (estado). Thin call into @sii/core
// (ADR-003), read-only. SESSION-KEYED (ADR-005): reads the session principal, NO `rut`
// — a represented empresa's F22 needs the empresa's own session. zod input (ADR-011).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { f22Overview, f22Status, type Runtime } from '@sii/core';
import { toolText } from '../tool-helpers.js';

export function registerF22Tools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    'f22_status',
    {
      title: 'F22 estado (Renta anual)',
      description:
        'Estado de la Declaración Anual de Renta (F22). CON `anio` (YYYY): detalle del año ' +
        '(folio/estado + grilla de códigos curada, sin PII). SIN `anio`: resumen multi-año del estado. ' +
        'Session-keyed: lee tu propia renta; para una empresa, inicia sesión como ella.',
      inputSchema: {
        anio: z.string().optional(),
        folio: z.string().optional(),
        years: z.number().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ anio, folio, years }) =>
      toolText(async () => {
        if (anio === undefined) {
          const ov = await f22Overview(runtime, years !== undefined ? { years } : {});
          return JSON.stringify(ov, null, 2);
        }
        const e = await f22Status(runtime, { anio, ...(folio ? { folio } : {}) });
        return JSON.stringify(e, null, 2);
      }),
  );
}
