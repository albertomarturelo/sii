// `peticiones_list` MCP tool — Peticiones Administrativas (SISPAD). Thin call into a
// @albertomarturelo/sii-core task (ADR-003), read-only. Body-RUT (ADR-005): `rut` selects a
// represented empresa. The description DECLARES the PII exposure to the model (ADR-006):
// petition contents include SII's free-text messages to the taxpayer. zod input schema
// (ADR-011). The audit records only the read (rut + count), never petition contents.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { peticionesList, type Runtime } from '@albertomarturelo/sii-core';
import { toolText } from '../tool-helpers.js';

const rutOpt = (rut?: string): { rut?: string } => (rut ? { rut } : {});

export function registerPeticionesTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    'peticiones_list',
    {
      title: 'Peticiones administrativas',
      description:
        'Lista las peticiones administrativas del contribuyente ante el SII (SISPAD) con su ' +
        'timeline de estados (ingresada → … → cerrada) y las fechas. Útil para detectar ' +
        'trámites detenidos, p. ej. "Peticion en espera de Antecedentes" (el SII espera algo ' +
        'del contribuyente). Devuelve número, materia, estado actual y el historial; incluye ' +
        'el mensaje textual del SII cuando existe (qué falta / por qué). Body-RUT: usa rut ' +
        'para una empresa representada. Expone datos personales/tributarios del contribuyente.',
      inputSchema: {
        rut: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ rut }) =>
      toolText(async () => JSON.stringify(await peticionesList(runtime, rutOpt(rut)), null, 2)),
  );
}
