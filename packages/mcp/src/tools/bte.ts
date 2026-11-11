// `bte_*` MCP tools — Boletas de Honorarios Electrónicas. Thin calls into @albertomarturelo/sii-core tasks
// (ADR-003) with zod input schemas (ADR-011). SESSION-KEYED (ADR-005): uses the
// session principal; no `rut` argument.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  bteAnular,
  bteEmit,
  bteEmitPreview,
  bteList,
  type BteEmitArgs,
  type BteRetiene,
  type BteSide,
  type Runtime,
} from '@albertomarturelo/sii-core';
import { toolText } from '../tool-helpers.js';

const sideOf = (recibidas?: boolean): BteSide => (recibidas ? 'RECIBIDAS' : 'EMITIDAS');
const folioAnulacion = z.number().int().positive().max(9_999_999_999);
const motivoAnulacion = z.union([z.literal(1), z.literal(2), z.literal(3)]);

// Shared emit input fields (zod raw shape). The emisor fields are read from the live form; the
// caller supplies only receptor + líneas + fecha + who-withholds.
const emitFields = {
  receptor: z.string(),
  nombre: z.string(),
  domicilio: z.string(),
  region: z.number().int(),
  comuna: z.number().int(),
  lineas: z
    .array(z.object({ glosa: z.string(), monto: z.number().int().positive() }))
    .min(1)
    .max(4),
  fecha: z
    .object({ dia: z.number().int(), mes: z.number().int(), anio: z.number().int() })
    .optional(),
  retiene: z.enum(['receptor', 'emisor']),
  mostrarDetalle: z.boolean().optional(),
};

type EmitInput = {
  receptor: string;
  nombre: string;
  domicilio: string;
  region: number;
  comuna: number;
  lineas: { glosa: string; monto: number }[];
  fecha?: { dia: number; mes: number; anio: number } | undefined;
  retiene: 'receptor' | 'emisor';
  mostrarDetalle?: boolean | undefined;
};

const toArgs = (i: EmitInput): BteEmitArgs => ({
  receptor: i.receptor,
  receptorNombre: i.nombre,
  receptorDomicilio: i.domicilio,
  region: i.region,
  comuna: i.comuna,
  lineas: i.lineas,
  retiene: (i.retiene === 'emisor' ? 'EMISOR' : 'RECEPTOR') as BteRetiene,
  ...(i.fecha ? { fecha: i.fecha } : {}),
  ...(i.mostrarDetalle !== undefined ? { mostrarDetalle: i.mostrarDetalle } : {}),
});

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

  server.registerTool(
    'bte_anular_preview',
    {
      title: 'BHE — vista previa de anulación',
      description:
        'SESSION-KEYED: consulta una boleta emitida por el titular. ' +
        'Con motivo 1 (no pago), 2 (no prestación) o 3 (error de digitación), abre la revisión del SII. ' +
        'La vista previa no anula la boleta.',
      inputSchema: {
        folio: folioAnulacion,
        periodo: z.string(),
        motivo: motivoAnulacion.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      const result = await bteAnular(runtime, input);
      const response = {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
      switch (result.EstadoEjecucion012) {
        case 0:
          return response;
        case 1:
          return response;
        case 2:
          return { ...response, isError: true };
      }
    },
  );

  server.registerTool(
    'bte_anular',
    {
      title: 'BHE — ANULAR boleta de honorarios (acto legal)',
      description:
        'SESSION-KEYED: solicita la ANULACIÓN de una boleta emitida por el titular. ' +
        'Muestra primero la revisión de bte_anular_preview y pide confirmación al usuario. ' +
        'Requiere motivo, confirmar=true y folioConfirmacion igual al folio. ' +
        'Si el resultado queda indeterminado, consulta las emitidas antes de otro intento.',
      inputSchema: {
        folio: folioAnulacion,
        periodo: z.string(),
        motivo: motivoAnulacion,
        confirmar: z.literal(true),
        folioConfirmacion: folioAnulacion,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ folio, periodo, motivo, folioConfirmacion }) => {
      const result = await bteAnular(runtime, {
        folio,
        periodo,
        motivo,
        confirm: folioConfirmacion,
      });
      const response = {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
      switch (result.EstadoEjecucion012) {
        case 0:
          return response;
        case 1:
          return response;
        case 2:
          return { ...response, isError: true };
      }
    },
  );

  // --- emit preview (does NOT issue) — safe to call freely ---
  server.registerTool(
    'bte_emit_preview',
    {
      title: 'BHE — vista previa de emisión (NO emite)',
      description:
        'Calcula una boleta de honorarios (total, retención de PPM y líquido) SIN EMITIRLA. Usa ' +
        'esto para cotizar/preparar antes de emitir. Recibe: receptor (RUT), nombre, domicilio, ' +
        'region+comuna (códigos SII), lineas [{glosa, monto bruto}] (1–4), retiene ' +
        '("receptor"|"emisor"), fecha opcional. SESSION-KEYED: emite como el titular de la sesión.',
      inputSchema: emitFields,
      annotations: { readOnlyHint: true },
    },
    (input) =>
      toolText(async () => JSON.stringify(await bteEmitPreview(runtime, toArgs(input)), null, 2)),
  );

  // --- emit (ISSUES a legally-binding boleta) — destructive, requires explicit confirmation ---
  server.registerTool(
    'bte_emit',
    {
      title: 'BHE — EMITIR boleta de honorarios (acto legal)',
      description:
        'EMITE una boleta de honorarios electrónica: un DOCUMENTO CON VALOR LEGAL, reportado al SII ' +
        'y que solo se revierte con una anulación posterior. Llama primero a bte_emit_preview y ' +
        'muéstrale al usuario el total/retención/líquido. Para emitir DEBES pasar confirmar=true y ' +
        'montoTotalConfirmacion = la suma exacta de los montos brutos (doble verificación). ' +
        'Devuelve el código de barras (folio) + el PDF. SESSION-KEYED. Opcional: enviarA (email).',
      inputSchema: {
        ...emitFields,
        confirmar: z.literal(true),
        montoTotalConfirmacion: z.number().int(),
        enviarA: z.string().optional(),
        copiaEmisor: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (input) =>
      toolText(async () => {
        const total = input.lineas.reduce((s, l) => s + l.monto, 0);
        if (input.montoTotalConfirmacion !== total) {
          throw new Error(
            `montoTotalConfirmacion (${input.montoTotalConfirmacion}) no coincide con la suma de ` +
              `los montos brutos (${total}). Repite el total exacto para emitir.`,
          );
        }
        const args: BteEmitArgs = {
          ...toArgs(input),
          ...(input.enviarA ? { enviarA: input.enviarA } : {}),
          ...(input.copiaEmisor !== undefined ? { copiaEmisor: input.copiaEmisor } : {}),
        };
        return JSON.stringify(await bteEmit(runtime, args), null, 2);
      }),
  );
}
