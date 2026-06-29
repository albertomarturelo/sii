// F29 MCP tools — Declaración Mensual de IVA. Thin calls into @sii/core tasks (ADR-003),
// read-only. SESSION-KEYED (ADR-005): reads the session principal, NO `rut` — a represented
// empresa's F29 needs the empresa's own session (the task rejects a representing operate
// pointer with an actionable message). zod input (ADR-011).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { f29Draft, f29Status, type Runtime } from '@sii/core';
import { toolText } from '../tool-helpers.js';

export function registerF29Tools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    'f29_draft',
    {
      title: 'F29 propuesta (IVA mensual)',
      description:
        'Propuesta de IVA: el borrador del F29 prellenado por el SII para un período ' +
        '(YYYYMM o YYYY-MM). Devuelve los códigos tributarios propuestos (`codigos`) y los ' +
        'administrativos 91xx (`codigosAdministrativos`), sin PII de identidad/financiera. ' +
        'Session-keyed: lee tu propio F29; para una empresa, inicia sesión como ella.',
      inputSchema: { periodo: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ periodo }) =>
      toolText(async () => JSON.stringify(await f29Draft(runtime, { periodo }), null, 2)),
  );

  server.registerTool(
    'f29_status',
    {
      title: 'F29 estado (IVA mensual)',
      description:
        'Estado del F29 presentado/guardado de un período (YYYYMM o YYYY-MM): las ' +
        'declaraciones que el SII tiene (estado, folio, fecha). Vacío = nada presentado. ' +
        'No expone el monto (PII financiera). Session-keyed: lee tu propio F29; para una ' +
        'empresa, inicia sesión como ella.',
      inputSchema: { periodo: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ periodo }) =>
      toolText(async () => JSON.stringify(await f29Status(runtime, { periodo }), null, 2)),
  );
}
