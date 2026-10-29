// `bienes_raices_list` MCP tool (ADR-032) — the predios whose contribuciones the taxpayer pays,
// from Mi SII, with their unpaid cuotas. Thin call into the @albertomarturelo/sii-core task
// (ADR-003), read-only, session-keyed (ADR-005). The description DECLARES the PII exposure to the
// model (ADR-006): each predio carries its address. The audit records counts only.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bienesRaicesList, type Runtime } from '@albertomarturelo/sii-core';
import { toolText } from '../tool-helpers.js';

export function registerBienesRaicesTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    'bienes_raices_list',
    {
      title: 'Bienes raíces y contribuciones',
      description:
        'Session-keyed: los predios del titular de la sesión (para una empresa, auth_logout y ' +
        'auth_login como ella). Lista los predios por los que el contribuyente paga ' +
        'contribuciones habitualmente según Mi SII (sea o no el propietario: propietario lo ' +
        'dice), con rol, comuna, destino y las cuotas por pagar: condición del SII (vencida o ' +
        'vigente), fecha de vencimiento y total a pagar. Una cuota pagada no aparece. Una ' +
        'consulta al SII. Expone la dirección de cada predio (dato personal).',
      annotations: { readOnlyHint: true },
    },
    () => toolText(async () => JSON.stringify(await bienesRaicesList(runtime), null, 2)),
  );
}
