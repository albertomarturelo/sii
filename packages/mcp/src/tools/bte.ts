// `bte_*` MCP tools — Boletas de Honorarios Electrónicas. Thin calls into @altumstack/sii-core tasks
// (ADR-003), read-only. zod input schemas (ADR-011). SESSION-KEYED (ADR-005): reads the
// session principal; no `rut` argument.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bteList, type BteSide, type Runtime } from '@altumstack/sii-core';
import { toolText } from '../tool-helpers.js';

const sideOf = (recibidas?: boolean): BteSide => (recibidas ? 'RECIBIDAS' : 'EMITIDAS');

export function registerBteTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    'bte_list',
    {
      title: 'BHE/BTE — boletas de honorarios',
      description:
        'Lista las boletas de honorarios electrónicas de un período (YYYYMM/YYYY-MM). ' +
        'EMITIDAS por defecto; recibidas=true para las RECIBIDAS. SESSION-KEYED: lee SIEMPRE el ' +
        'titular de la sesión (no acepta otro RUT; para las BHE de una empresa, inicia sesión como ella).',
      inputSchema: { periodo: z.string(), recibidas: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ periodo, recibidas }) =>
      toolText(async () =>
        JSON.stringify(await bteList(runtime, { periodo, side: sideOf(recibidas) }), null, 2),
      ),
  );
}
