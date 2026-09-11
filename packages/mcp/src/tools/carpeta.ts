// `carpeta_*` MCP tools — Carpeta Tributaria. Thin calls into @albertomarturelo/sii-core tasks
// (ADR-003), read-only. SESSION-KEYED (ADR-005): no `rut` argument. #110 ships
// `carpeta_instituciones` (the live `enfinCodigo` catalog); #109 adds `carpeta_regular`.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { carpetaInstituciones, type Runtime } from '@albertomarturelo/sii-core';
import { toolText } from '../tool-helpers.js';

export function registerCarpetaTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    'carpeta_instituciones',
    {
      title: 'Carpeta Tributaria — instituciones destinatarias',
      description:
        'Lista VIGENTE de las instituciones a las que puede dirigirse una Carpeta Tributaria ' +
        'Regular (bancos, cooperativas, etc.): [{codigo, descripcion, abreviacion}]. `codigo` es ' +
        'el valor que exige `carpeta_regular` como institución destinataria; los códigos cambian ' +
        'con el tiempo, así que se leen del SII en cada llamada — no uses un código recordado sin ' +
        'confirmarlo aquí. Catálogo público: no expone datos del contribuyente. Session-keyed: ' +
        'requiere sesión; para una empresa, inicia sesión como ella.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => toolText(async () => JSON.stringify(await carpetaInstituciones(runtime), null, 2)),
  );
}
