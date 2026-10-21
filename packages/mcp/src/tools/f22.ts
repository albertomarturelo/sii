// `f22_status` MCP tool — Declaración Anual de Renta (estado). Thin call into @albertomarturelo/sii-core
// (ADR-003), read-only. SESSION-KEYED (ADR-005): reads the session principal, NO `rut`
// — a represented empresa's F22 needs the empresa's own session. zod input (ADR-011).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  f22Historial,
  f22Observaciones,
  f22Overview,
  f22Status,
  f22Terceros,
  f22TercerosDetalle,
  ValidationError,
  type Runtime,
} from '@albertomarturelo/sii-core';
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
        'El formulario completo de la Declaración Anual de Renta (F22) de un año, sin PII de ' +
        'identidad/banco, agrupado en `grupos`: `ingresos`, `deducciones`, `creditos` ' +
        '(grupo COMBINADO retenciones·PPM·créditos — p.ej. 162 es crédito/retención IUSC de ' +
        'origen, 36/1905 son PPM), `calculo` (subtotales intermedios del IGC/IUSC: 157/158/304, ' +
        'no son resultados finales), `resultado` (desenlaces finales: impuesto/devolución/giro) ' +
        'y `otros` (red de seguridad: cualquier código tributario no-PII aún sin clasificar; ' +
        'vacío = todos clasificados, nunca se oculta nada). La unión de los seis = la grilla ' +
        'completa. Session-keyed: lee tu propia renta; para una empresa, inicia sesión como ella.',
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

  server.registerTool(
    'f22_terceros',
    {
      title: 'F22 información de terceros (DJ de agentes retenedores e informantes)',
      description:
        'Lo que informaron al SII sobre el contribuyente sus agentes retenedores e informantes ' +
        '(empleadores, bancos, AFP, AGF, corredoras) en sus declaraciones juradas, para un año ' +
        'tributario (2026 = ingresos de 2025). Sirve para explicar una observación de la F22 ' +
        '(p. ej. B102) y cuadrar antes de una rectificatoria. Sin `dj`: el resumen por DJ con sus ' +
        'totales, UNA consulta al SII; empieza por ahí. Con `dj`: las filas de esa DJ (todas las ' +
        'páginas de 10, hasta 30; `pagina` lee solo una), cada una con folio, declarante, fecha, ' +
        'estado ("No Observada"…) y `campos` [{columna, valor}] según las columnas de esa DJ. ' +
        'EXPONE DATOS DE TERCEROS: el RUT y el nombre de cada declarante, que puede ser una ' +
        'persona natural (p. ej. un empleador). De las filas se omiten tu RUT y las columnas del ' +
        'partícipe o aportante (tu propia identidad); tu nombre también cuando se reconoce, ' +
        'aunque un informante puede escribirlo a su manera. Session-keyed: lee tu propia ' +
        'información; para una empresa, inicia sesión como ella.',
      inputSchema: {
        anio: z.string(),
        dj: z.string().optional(),
        pagina: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ anio, dj, pagina }) =>
      toolText(async () => {
        if (dj === undefined) {
          if (pagina !== undefined) throw new ValidationError('`pagina` requiere `dj`.');
          return JSON.stringify(await f22Terceros(runtime, { anio }), null, 2);
        }
        const r = await f22TercerosDetalle(runtime, {
          anio,
          dj,
          ...(pagina !== undefined ? { pagina } : {}),
        });
        return JSON.stringify(r, null, 2);
      }),
  );
}
