// F29 MCP tools — Declaración Mensual de IVA. Thin calls into @altumstack/sii-core tasks (ADR-003),
// read-only. SESSION-KEYED (ADR-005): reads the session principal, NO `rut` — a represented
// empresa's F29 needs the empresa's own session (the task rejects a representing operate
// pointer). zod input (ADR-011). Fase 1 (robusta, sin GWT-RPC): formulario (propuesta) +
// overview (estado por rango) + status (estado de un mes).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { f29Formulario, f29Overview, f29Status, type Runtime } from '@altumstack/sii-core';
import { toolText } from '../tool-helpers.js';

export function registerF29Tools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    'f29_formulario',
    {
      title: 'F29 formulario (propuesta IVA, agrupado)',
      description:
        'Propuesta de IVA de un período (YYYYMM o YYYY-MM): los códigos del F29 etiquetados con ' +
        'su glosa y agrupados (débitos/ventas, créditos/compras, retenciones·PPM, otros, ' +
        'determinación). `fuente: "propuesta"` — es la sugerencia del SII, no el formulario ' +
        'presentado. Session-keyed: lee tu propio F29; para una empresa, inicia sesión como ella.',
      inputSchema: { periodo: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ periodo }) =>
      toolText(async () => JSON.stringify(await f29Formulario(runtime, { periodo }), null, 2)),
  );

  server.registerTool(
    'f29_overview',
    {
      title: 'F29 overview (posición IVA por mes)',
      description:
        'Posición de IVA por mes en un rango: por cada mes, estado, folio, fecha y el total a ' +
        'pagar declarado ("lo que pagué"). Indica el rango con `desde`/`hasta` (YYYY-MM) o con ' +
        '`anio` (YYYY) para el año completo. Session-keyed: lee tu propio F29.',
      inputSchema: {
        desde: z.string().optional(),
        hasta: z.string().optional(),
        anio: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ desde, hasta, anio }) =>
      toolText(async () => {
        // `anio` is a shortcut for the whole calendar year; else an explicit desde/hasta range.
        const range =
          anio !== undefined
            ? { desde: `${anio}-01`, hasta: `${anio}-12` }
            : { desde: desde ?? '', hasta: hasta ?? desde ?? '' };
        return JSON.stringify(await f29Overview(runtime, range), null, 2);
      }),
  );

  server.registerTool(
    'f29_status',
    {
      title: 'F29 estado (declaraciones del mes)',
      description:
        'Estado de las declaraciones F29 presentadas/guardadas de un período (YYYYMM o YYYY-MM): ' +
        'estado, folio, fecha y total. Vacío = nada presentado. Session-keyed: lee tu propio F29.',
      inputSchema: { periodo: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ periodo }) =>
      toolText(async () => JSON.stringify(await f29Status(runtime, { periodo }), null, 2)),
  );
}
