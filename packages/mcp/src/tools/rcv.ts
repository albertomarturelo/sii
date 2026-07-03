// `rcv_*` MCP tools — Registro de Compras y Ventas. Thin calls into @albertomarturelo/sii-core tasks
// (ADR-003), read-only. Body-RUT (ADR-005): `rut` selects a represented empresa.
// zod input schemas (ADR-011) — the SDK derives the protocol JSON Schema.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { rcvList, rcvSummary, type RcvSide, type Runtime } from '@albertomarturelo/sii-core';
import { toolText } from '../tool-helpers.js';

const sideOf = (venta?: boolean): RcvSide => (venta ? 'VENTA' : 'COMPRA');
// exactOptionalPropertyTypes: only carry `rut` when the override was passed.
const rutOpt = (rut?: string): { rut?: string } => (rut ? { rut } : {});

export function registerRcvTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    'rcv_summary',
    {
      title: 'RCV resumen',
      description:
        'Resumen del Registro de Compras y Ventas por tipo de documento, para un período (YYYYMM/YYYY-MM). ' +
        'COMPRAS por defecto; venta=true para VENTAS. Body-RUT: usa rut para una empresa representada.',
      inputSchema: {
        periodo: z.string(),
        venta: z.boolean().optional(),
        rut: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ periodo, venta, rut }) =>
      toolText(async () =>
        JSON.stringify(
          await rcvSummary(runtime, { periodo, side: sideOf(venta), ...rutOpt(rut) }),
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    'rcv_list',
    {
      title: 'RCV detalle',
      description:
        'Detalle de documentos de un tipo (codigoTipoDoc, ej. "33") del RCV para un período. ' +
        'COMPRAS por defecto; venta=true para VENTAS. Body-RUT: usa rut para una empresa representada.',
      inputSchema: {
        periodo: z.string(),
        codigoTipoDoc: z.string(),
        venta: z.boolean().optional(),
        rut: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ periodo, codigoTipoDoc, venta, rut }) =>
      toolText(async () =>
        JSON.stringify(
          await rcvList(runtime, { periodo, side: sideOf(venta), codigoTipoDoc, ...rutOpt(rut) }),
          null,
          2,
        ),
      ),
  );
}
