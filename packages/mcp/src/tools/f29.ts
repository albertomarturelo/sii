// F29 MCP tools — Declaración Mensual de IVA. Thin calls into @albertomarturelo/sii-core tasks (ADR-003).
// Read-only, except f29_submit_preview (writes a borrador) and f29_submit (files; ADR-029). SESSION-KEYED (ADR-005): reads the session principal, NO `rut` — a represented
// empresa's F29 needs the empresa's own session (the task rejects a representing operate
// pointer). zod input (ADR-011). Fase 1 (robusta, sin GWT-RPC): formulario (propuesta) +
// overview (estado por rango) + status (estado de un mes).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  f29Formulario,
  f29Overview,
  f29Pdf,
  f29Status,
  f29Submit,
  f29SubmitPreview,
  F29_PDF_TIPO_ARGS,
  type Runtime,
} from '@albertomarturelo/sii-core';
// The default destination lives in the `./node` subpath (the pure core cannot know $HOME —
// ADR-016/ADR-022); the SURFACE applies it.
import { documentosDir } from '@albertomarturelo/sii-core/node';
import { join } from 'node:path';
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
        '`anio` (YYYY) para el año completo; sin argumentos, el año en curso a la fecha. ' +
        'Session-keyed: lee tu propio F29.',
      inputSchema: {
        desde: z.string().optional(),
        hasta: z.string().optional(),
        anio: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ desde, hasta, anio }) =>
      // Range semantics live in the task (one policy for CLI + MCP): `anio` → whole
      // year; `desde` alone → that month; nothing → current calendar year to date.
      toolText(async () =>
        JSON.stringify(await f29Overview(runtime, { desde, hasta, anio }), null, 2),
      ),
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

  server.registerTool(
    'f29_pdf',
    {
      title: 'F29 PDF (descargar la declaración presentada)',
      description:
        'Descarga a un archivo local el PDF de la declaración F29 presentada de un período ' +
        '(YYYYMM o YYYY-MM). `tipo`: "compacto" (el formulario tal como lo imprime el SII; es ' +
        'ADEMÁS el comprobante de pago cuando el período fue pagado — su timbre dice "RECIBIDA ' +
        'Y PAGADA POR INTERNET"), "solemne" (el Certificado de Declaración) o "ambos". ' +
        'Devuelve SOLO la ruta y el tamaño del archivo, NO su contenido: el documento lleva ' +
        'datos tributarios personales (razón social, domicilio, posición financiera) y no debe ' +
        'entrar en la conversación — ábrelo tú desde la ruta indicada. `directorio` elige la ' +
        'carpeta destino (por defecto documentos/f29 bajo $SII_HOME, o ~/.sii). `folio` apunta a una declaración ' +
        'concreta cuando el período tiene varias; por defecto, la vigente. ' +
        'Session-keyed: descarga tu propio F29; para una empresa, inicia sesión como ella.',
      inputSchema: {
        periodo: z.string(),
        tipo: z.enum(F29_PDF_TIPO_ARGS).optional(),
        directorio: z.string().optional(),
        folio: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ periodo, tipo, directorio, folio }) =>
      // readOnly at SII: it fetches a document and writes it locally; nothing changes at SII.
      toolText(async () =>
        JSON.stringify(
          await f29Pdf(runtime, {
            periodo,
            ...(tipo !== undefined ? { tipo } : {}),
            directorio: directorio ?? join(documentosDir(), 'f29'),
            ...(folio !== undefined ? { folio } : {}),
          }),
          null,
          2,
        ),
      ),
  );

  // --- submit (FILES a legally-binding declaración, ADR-029) ---
  server.registerTool(
    'f29_submit_preview',
    {
      title: 'F29 — vista previa de la presentación',
      description:
        'Vista previa de presentar el F29 de un período (YYYYMM o YYYY-MM) con la propuesta de SII ' +
        'tal cual: la propuesta agrupada, lo que calculan las fórmulas de SII, el TOTAL A PAGAR ' +
        '(código 91) que SII valida y cada desacuerdo entre el borrador validado y la propuesta ' +
        '(si hay alguno, no se puede presentar). NO presenta nada, pero ESCRIBE en SII: deja un ' +
        'borrador «Guardada» (sin efecto legal). La propuesta de SII puede estar incompleta (PPM, ' +
        'retenciones, documentos fuera del RCV): muéstrasela al usuario antes de presentar. ' +
        'Session-keyed: tu propio F29; para una empresa, inicia sesión como ella.',
      inputSchema: { periodo: z.string() },
      // It writes a borrador at SII (no readOnlyHint), but a reversible, legally inert one (no
      // destructiveHint) — ADR-029 amendment, ADR-023's line for borradores.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ periodo }) =>
      toolText(async () => JSON.stringify(await f29SubmitPreview(runtime, { periodo }), null, 2)),
  );

  server.registerTool(
    'f29_submit',
    {
      title: 'F29 — PRESENTAR la declaración (acto legal)',
      description:
        'PRESENTA el F29 del período ante el SII: una DECLARACIÓN CON VALOR LEGAL que crea la ' +
        'obligación de pagar el total y solo se corrige con una rectificatoria. Presenta la ' +
        'propuesta de SII tal cual, y esa propuesta puede estar incompleta (PPM, retenciones, ' +
        'documentos fuera del RCV). Llama primero a f29_submit_preview, muéstrale al usuario la ' +
        'propuesta y el total, y presenta solo con su aprobación. DEBES pasar confirmar=true y ' +
        'total = el TOTAL A PAGAR de la vista previa; si SII calcula otro total o el borrador no ' +
        'coincide con la propuesta, se rechaza sin presentar. Nunca reintentes: si el resultado ' +
        'queda sin confirmar, revisa f29_status. No paga: devuelve folio, estado y total, y el ' +
        'pago lo hace el usuario en SII. Session-keyed.',
      inputSchema: {
        periodo: z.string(),
        confirmar: z.literal(true),
        total: z.number().int().nonnegative(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    ({ periodo, total }) =>
      toolText(async () => JSON.stringify(await f29Submit(runtime, { periodo, total }), null, 2)),
  );
}
