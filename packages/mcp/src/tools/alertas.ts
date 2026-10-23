// `alertas` MCP tool (ADR-030) — what SII holds against the taxpayer but does not push. Thin
// call into the @albertomarturelo/sii-core task (ADR-003), read-only, session-keyed (ADR-005).
// The description states the auth mode, the cost of a full read and the PII it carries
// (ADR-006); the audit records counts only. zod input schema (ADR-011).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FUENTES_ALERTAS, alertas, type Runtime } from '@albertomarturelo/sii-core';
import { toolText } from '../tool-helpers.js';

export function registerAlertasTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    'alertas',
    {
      title: 'Alertas del SII',
      description:
        'Session-keyed: las alertas del titular de la sesión (para una empresa, auth_logout y ' +
        'auth_login como ella). Lo que el SII registra y no avisa: observaciones del F22 ' +
        '(últimos 3 años tributarios), F29 guardados sin enviar, rechazados o sin declarar ' +
        '(últimos 12 períodos; "sin declarar" solo si la cuenta declara F29, y con fechas de ' +
        'vencimiento estimadas) y el último estado de las peticiones administrativas. Cada ' +
        'alerta trae un id estable: guarda los vistos y avisa solo de los nuevos. fuentes ' +
        'elige qué leer: todas son ~20 consultas pausadas al SII (~20 s), así que una rutina ' +
        'frecuente debería pedir solo las que necesita. desde (AAAA-MM-DD) descarta alertas ' +
        'anteriores. Si una fuente falla, el resto se devuelve y fuentes/incompleto lo dicen. ' +
        'Incluye el texto del SII sobre el contribuyente (datos tributarios personales).',
      inputSchema: {
        fuentes: z.array(z.enum(FUENTES_ALERTAS)).optional(),
        desde: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ fuentes, desde }) =>
      toolText(async () => JSON.stringify(await alertas(runtime, { fuentes, desde }), null, 2)),
  );
}
