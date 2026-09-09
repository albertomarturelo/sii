// `dte_*` MCP tools — Documentos Tributarios Electrónicos, the whole artifact (ADR-024):
// `dte_authorized` (PUBLIC, login-free, ADR-014) + the Portal MIPYME surface (empresa-keyed,
// ADR-023). Thin calls into @albertomarturelo/sii-core tasks (ADR-003), zod inputs (ADR-011).
//
// BORRADORES ONLY (ADR-023). There is deliberately NO emit/sign tool: the model can draft,
// list, preview and delete drafts, but cannot produce a legally-binding document.
//
// PII: a factura carries both parties' identity, so every tool's description declares the
// exposure, and the preview tool returns a FILE PATH — never the PDF bytes (ADR-006 / ADR-022).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  MAX_ITEMS,
  dteAuthorized,
  dteBorradorDelete,
  dteBorradorList,
  dteBorradorSave,
  dteEmitidos,
  dteEmpresas,
  dtePdf,
  dtePreviewPdf,
  type DteBorradorArgs,
  type FormaPago,
  type Runtime,
} from '@albertomarturelo/sii-core';
import { DOCUMENTOS_DIR } from '@albertomarturelo/sii-core/node';
import { join } from 'node:path';
import { toolText } from '../tool-helpers.js';

const documentoFields = {
  empresa: z.string().describe('RUT de la empresa emisora (de `dte_empresas`).'),
  tipoDte: z.number().int().optional().describe('33 factura afecta (por defecto), 34 exenta.'),
  fechaEmision: z.string().optional().describe('YYYY-MM-DD; por defecto hoy.'),
  ciudadEmisor: z
    .string()
    .describe('Ciudad del emisor. El SII la exige y NO la trae precargada en el formulario.'),
  receptor: z.object({
    rut: z.string(),
    razonSocial: z.string(),
    direccion: z.string(),
    comuna: z.string(),
    ciudad: z.string(),
    giro: z.string(),
    contacto: z.string().optional(),
  }),
  items: z
    .array(
      z.object({
        nombre: z.string(),
        descripcion: z.string().optional(),
        cantidad: z.number().positive(),
        unidad: z.string().optional(),
        precioUnitario: z.number().int().positive(),
        descuentoPct: z.number().min(0).max(99).optional(),
      }),
    )
    .min(1)
    .max(MAX_ITEMS),
  formaPago: z.enum(['contado', 'credito', 'sin_costo']).optional(),
  borradorId: z.string().optional().describe('Actualiza/previsualiza ESTE borrador.'),
};

type DocInput = {
  empresa: string;
  tipoDte?: number | undefined;
  fechaEmision?: string | undefined;
  ciudadEmisor: string;
  receptor: {
    rut: string;
    razonSocial: string;
    direccion: string;
    comuna: string;
    ciudad: string;
    giro: string;
    contacto?: string | undefined;
  };
  items: {
    nombre: string;
    descripcion?: string | undefined;
    cantidad: number;
    unidad?: string | undefined;
    precioUnitario: number;
    descuentoPct?: number | undefined;
  }[];
  formaPago?: 'contado' | 'credito' | 'sin_costo' | undefined;
  borradorId?: string | undefined;
};

const toArgs = (i: DocInput): DteBorradorArgs => ({
  empresa: i.empresa,
  ciudadEmisor: i.ciudadEmisor,
  receptor: {
    rut: i.receptor.rut,
    razonSocial: i.receptor.razonSocial,
    direccion: i.receptor.direccion,
    comuna: i.receptor.comuna,
    ciudad: i.receptor.ciudad,
    giro: i.receptor.giro,
    ...(i.receptor.contacto !== undefined ? { contacto: i.receptor.contacto } : {}),
  },
  items: i.items.map((it) => ({
    nombre: it.nombre,
    cantidad: it.cantidad,
    precioUnitario: it.precioUnitario,
    ...(it.descripcion !== undefined ? { descripcion: it.descripcion } : {}),
    ...(it.unidad !== undefined ? { unidad: it.unidad } : {}),
    ...(it.descuentoPct !== undefined ? { descuentoPct: it.descuentoPct } : {}),
  })),
  ...(i.tipoDte !== undefined ? { tipoDte: i.tipoDte } : {}),
  ...(i.fechaEmision !== undefined ? { fechaEmision: i.fechaEmision } : {}),
  ...(i.formaPago !== undefined ? { formaPago: i.formaPago as FormaPago } : {}),
  ...(i.borradorId !== undefined ? { borradorId: i.borradorId } : {}),
});

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

  server.registerTool(
    'dte_emitidos',
    {
      description:
        'Empresa-keyed (--empresa validado contra el Portal MIPYME). Documentos tributarios ya EMITIDOS por una empresa en el Portal MIPYME (facturas,  ' +
        'Sólo lo emitido vía el Portal MIPYME, con acceso a su PDF; para el REGISTRO del SII de ' +
        'todo lo emitido por cualquier software, usa rcv_list.' +
        'notas de crédito/débito, guías…). Sólo lectura: no emite ni firma nada. Expone datos ' +
        'del RECEPTOR (RUT y razón social), folio y montos — PII de terceros.',
      inputSchema: {
        empresa: z.string(),
        tipoDoc: z.number().int().optional().describe('33, 34, 61, 52, …'),
        estado: z.enum(['emitido', 'preview']).optional(),
        folio: z.number().int().positive().optional(),
        receptor: z.string().optional(),
        desde: z.string().optional().describe('YYYY-MM-DD'),
        hasta: z.string().optional().describe('YYYY-MM-DD'),
        pagina: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      toolText(async () =>
        JSON.stringify(
          await dteEmitidos(runtime, input as Parameters<typeof dteEmitidos>[1]),
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    'dte_pdf',
    {
      description:
        'Empresa-keyed (--empresa validado contra el Portal MIPYME). Descarga el PDF de un documento ya EMITIDO, por folio. Devuelve la RUTA del archivo, ' +
        'nunca su contenido: el documento es PII densa (identidad de ambas partes y montos) y ' +
        'no debe entrar al contexto del modelo. Sólo lectura: no emite ni firma nada.',
      inputSchema: {
        empresa: z.string(),
        folio: z.number().int().positive(),
        directorio: z
          .string()
          .optional()
          .describe('Carpeta destino; por defecto ~/.sii/documentos/factura.'),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ empresa, folio, directorio }) =>
      toolText(async () =>
        JSON.stringify(
          await dtePdf(runtime, {
            empresa,
            folio,
            directorio: directorio ?? join(DOCUMENTOS_DIR, 'dte'),
          }),
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    'dte_empresas',
    {
      description:
        'Empresa-keyed. Empresas para las que el usuario está autorizado a facturar en el Portal MIPYME del ' +
        'SII. Es la lista viva del portal — su propio dominio de valores, distinto del puntero ' +
        '`operate`. Expone razón social (PII) de las empresas del usuario.',
      inputSchema: { tipoDte: z.number().int().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ tipoDte }) =>
      toolText(async () =>
        JSON.stringify(
          await dteEmpresas(runtime, { ...(tipoDte !== undefined ? { tipoDte } : {}) }),
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    'dte_borrador_list',
    {
      description:
        'Empresa-keyed (--empresa validado contra el Portal MIPYME). Borradores de factura guardados de una empresa en el Portal MIPYME. Devuelve los de ' +
        'TODOS los tipos de DTE (`tipoDte` va en cada fila); `tipoDte` aquí sólo indica con qué ' +
        'tipo se abre el portal, NO filtra. Expone datos del RECEPTOR (RUT y razón social) y ' +
        'los montos de cada borrador — PII de terceros.',
      inputSchema: { empresa: z.string(), tipoDte: z.number().int().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ empresa, tipoDte }) =>
      toolText(async () =>
        JSON.stringify(
          await dteBorradorList(runtime, {
            empresa,
            ...(tipoDte !== undefined ? { tipoDte } : {}),
          }),
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    'dte_borrador_save',
    {
      description:
        'Empresa-keyed (--empresa validado contra el Portal MIPYME). Guarda una factura como BORRADOR en el Portal MIPYME (crea uno nuevo, o actualiza el ' +
        'indicado en `borradorId`). NO emite ni firma: el borrador no es un documento ' +
        'tributario, no tiene folio y no tiene efecto legal. El SII valida el documento y sus ' +
        'mensajes se devuelven textuales.',
      inputSchema: documentoFields,
      // A borrador is reversible (dte_borrador_delete) and never legally binding, so it is
      // NOT destructive — unlike `bte_emit`. It is still a write, so not readOnly either.
      annotations: { idempotentHint: false },
    },
    async (input) =>
      toolText(async () =>
        JSON.stringify(await dteBorradorSave(runtime, toArgs(input as DocInput)), null, 2),
      ),
  );

  server.registerTool(
    'dte_borrador_delete',
    {
      description:
        'Empresa-keyed (--empresa validado contra el Portal MIPYME). Elimina un borrador de factura del Portal MIPYME. Irreversible: el borrador no se ' +
        'puede recuperar. Requiere `confirmar: true`. `tipoDte` es opcional — se resuelve del ' +
        'propio borrador.',
      inputSchema: {
        empresa: z.string(),
        borradorId: z.string(),
        tipoDte: z.number().int().optional(),
        confirmar: z.literal(true).describe('Debe ser true: confirma el borrado irreversible.'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ empresa, borradorId, tipoDte }) =>
      toolText(async () =>
        JSON.stringify(
          await dteBorradorDelete(runtime, {
            empresa,
            borradorId,
            ...(tipoDte !== undefined ? { tipoDte } : {}),
          }),
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    'dte_preview_pdf',
    {
      description:
        'Empresa-keyed (--empresa validado contra el Portal MIPYME). Descarga el PDF de vista previa de una factura NO emitida ("Validar y visualizar"). ' +
        'El PDF va estampado "VISTA PREVIA / DOCUMENTO NO VALIDO" y sin folio. Devuelve la RUTA ' +
        'del archivo, nunca su contenido: el documento es PII densa (identidad de ambas partes ' +
        'y montos) y no debe entrar al contexto del modelo.',
      inputSchema: {
        ...documentoFields,
        directorio: z
          .string()
          .optional()
          .describe('Carpeta destino; por defecto ~/.sii/documentos/factura.'),
      },
      annotations: { readOnlyHint: false },
    },
    async (input) => {
      const { directorio, ...doc } = input as DocInput & { directorio?: string };
      return toolText(async () =>
        JSON.stringify(
          await dtePreviewPdf(runtime, {
            ...toArgs(doc),
            directorio: directorio ?? join(DOCUMENTOS_DIR, 'dte'),
          }),
          null,
          2,
        ),
      );
    },
  );
}
