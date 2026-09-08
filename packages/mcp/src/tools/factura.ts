// `factura_*` MCP tools — facturas del Portal MIPYME. Thin calls into @albertomarturelo/sii-core tasks
// (ADR-003), zod input schemas (ADR-011).
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
  facturaBorradorDelete,
  facturaBorradorList,
  facturaBorradorSave,
  facturaEmpresas,
  facturaPreviewPdf,
  type FacturaBorradorArgs,
  type FormaPago,
  type Runtime,
} from '@albertomarturelo/sii-core';
import { DOCUMENTOS_DIR } from '@albertomarturelo/sii-core/node';
import { join } from 'node:path';
import { toolText } from '../tool-helpers.js';

const documentoFields = {
  empresa: z.string().describe('RUT de la empresa emisora (de `factura_empresas`).'),
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

const toArgs = (i: DocInput): FacturaBorradorArgs => ({
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

export function registerFacturaTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    'factura_empresas',
    {
      description:
        'Empresas para las que el usuario está autorizado a facturar en el Portal MIPYME del ' +
        'SII. Es la lista viva del portal — su propio dominio de valores, distinto del puntero ' +
        '`operate`. Expone razón social (PII) de las empresas del usuario.',
      inputSchema: { tipoDte: z.number().int().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ tipoDte }) =>
      toolText(async () =>
        JSON.stringify(
          await facturaEmpresas(runtime, { ...(tipoDte !== undefined ? { tipoDte } : {}) }),
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    'factura_borrador_list',
    {
      description:
        'Borradores de factura guardados de una empresa en el Portal MIPYME. Devuelve los de ' +
        'TODOS los tipos de DTE (`tipoDte` va en cada fila); `tipoDte` aquí sólo indica con qué ' +
        'tipo se abre el portal, NO filtra. Expone datos del RECEPTOR (RUT y razón social) y ' +
        'los montos de cada borrador — PII de terceros.',
      inputSchema: { empresa: z.string(), tipoDte: z.number().int().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ empresa, tipoDte }) =>
      toolText(async () =>
        JSON.stringify(
          await facturaBorradorList(runtime, {
            empresa,
            ...(tipoDte !== undefined ? { tipoDte } : {}),
          }),
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    'factura_borrador_save',
    {
      description:
        'Guarda una factura como BORRADOR en el Portal MIPYME (crea uno nuevo, o actualiza el ' +
        'indicado en `borradorId`). NO emite ni firma: el borrador no es un documento ' +
        'tributario, no tiene folio y no tiene efecto legal. El SII valida el documento y sus ' +
        'mensajes se devuelven textuales.',
      inputSchema: documentoFields,
      // A borrador is reversible (factura_borrador_delete) and never legally binding, so it is
      // NOT destructive — unlike `bte_emit`. It is still a write, so not readOnly either.
      annotations: { idempotentHint: false },
    },
    async (input) =>
      toolText(async () =>
        JSON.stringify(await facturaBorradorSave(runtime, toArgs(input as DocInput)), null, 2),
      ),
  );

  server.registerTool(
    'factura_borrador_delete',
    {
      description:
        'Elimina un borrador de factura del Portal MIPYME. Irreversible: el borrador no se ' +
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
          await facturaBorradorDelete(runtime, {
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
    'factura_preview_pdf',
    {
      description:
        'Descarga el PDF de vista previa de una factura NO emitida ("Validar y visualizar"). ' +
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
          await facturaPreviewPdf(runtime, {
            ...toArgs(doc),
            directorio: directorio ?? join(DOCUMENTOS_DIR, 'factura'),
          }),
          null,
          2,
        ),
      );
    },
  );
}
