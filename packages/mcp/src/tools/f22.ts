// `f22_status` MCP tool — Declaración Anual de Renta (estado). Thin call into @sii/core
// (ADR-003), read-only. SESSION-KEYED (ADR-005): reads the session principal, NO `rut`
// — a represented empresa's F22 needs the empresa's own session. zod input (ADR-011).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  f22Historial,
  f22Observaciones,
  f22Overview,
  f22Status,
  ValidationError,
  type Runtime,
} from '@sii/core';
import { toolText } from '../tool-helpers.js';

export function registerF22Tools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    'f22_status',
    {
      title: 'F22 estado (Renta anual)',
      description:
        'Estado de la Declaración Anual de Renta (F22). CON `anio` (YYYY): detalle del año ' +
        '(folio/estado + grilla de códigos curada, sin PII de identidad/banco). SIN `anio`: ' +
        'resumen multi-año del estado. Para el formulario completo agrupado usa `f22_formulario`. ' +
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
          // `folio` selects a declaración within a year; meaningless for the overview.
          if (folio !== undefined) {
            throw new ValidationError('`folio` requiere indicar `anio` (YYYY).');
          }
          const ov = await f22Overview(runtime, years !== undefined ? { years } : {});
          return JSON.stringify(ov, null, 2);
        }
        const e = await f22Status(runtime, { anio, ...(folio ? { folio } : {}) });
        return JSON.stringify(e, null, 2);
      }),
  );

  server.registerTool(
    'f22_formulario',
    {
      title: 'F22 formulario completo (Renta anual)',
      description:
        'El formulario completo de la Declaración Anual de Renta (F22) de un año, agrupado en ' +
        'ingresos / deducciones / retenciones·PPM·créditos / resultado (+ otros) en `grupos`, ' +
        'sin PII de identidad/banco. Session-keyed: lee tu propia renta; para una empresa, ' +
        'inicia sesión como ella.',
      inputSchema: {
        anio: z.string(),
        folio: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ anio, folio }) =>
      toolText(async () => {
        const e = await f22Status(runtime, { anio, full: true, ...(folio ? { folio } : {}) });
        return JSON.stringify(e, null, 2);
      }),
  );

  server.registerTool(
    'f22_observaciones',
    {
      title: 'F22 observaciones (inconsistencias)',
      description:
        'Observaciones/inconsistencias de la Declaración Anual de Renta (F22) de un año: ' +
        'código (B102, G37…), glosa y URL de ayuda del SII para corregir. Session-keyed: ' +
        'lee tu propia renta; para una empresa, inicia sesión como ella.',
      inputSchema: {
        anio: z.string(),
        folio: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ anio, folio }) =>
      toolText(async () => {
        const r = await f22Observaciones(runtime, { anio, ...(folio ? { folio } : {}) });
        return JSON.stringify(r, null, 2);
      }),
  );

  server.registerTool(
    'f22_historial',
    {
      title: 'F22 historial (eventos de Renta anual)',
      description:
        'Historial de eventos de la Declaración Anual de Renta (F22) de un año: la línea de ' +
        'tiempo (declaración recibida, devolución autorizada, giros de Tesorería, ' +
        'rectificatorias) con fecha y glosa verbatim del SII, más reciente primero. Por ' +
        'defecto cubre todos los folios del año; `folio` acota a uno. Session-keyed: lee tu ' +
        'propia renta; para una empresa, inicia sesión como ella.',
      inputSchema: {
        anio: z.string(),
        folio: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ anio, folio }) =>
      toolText(async () => {
        const r = await f22Historial(runtime, { anio, ...(folio ? { folio } : {}) });
        return JSON.stringify(r, null, 2);
      }),
  );
}
