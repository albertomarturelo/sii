import { describe, it, expect } from 'vitest';
import { HOSTS, testing, type Runtime } from '@albertomarturelo/sii-core';
import { connect, datos, toolText } from '../test-helpers.js';

describe('@sii/mcp rcv tools (in-memory client, fake runtime, no SII)', () => {
  it('rcv_summary returns the curated resumen as JSON (body-RUT, read-only)', async () => {
    const env = {
      respEstado: { codRespuesta: 0 },
      totDocRes: 2,
      data: [
        {
          rsmnTipoDocInteger: 33,
          dcvNombreTipoDoc: 'Factura',
          rsmnTotDoc: 2,
          rsmnMntTotal: 119000,
        },
      ],
    };
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          requestJson: () => env,
          cookies: { TOKEN: 't' },
        },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({ name: 'rcv_summary', arguments: { periodo: '2026-06' } });
    const parsed = JSON.parse(toolText(res)) as {
      side: string;
      periodo: string;
      rows: { codigoTipoDoc: string }[];
    };
    expect(parsed).toMatchObject({ side: 'COMPRA', periodo: '2026-06' });
    expect(parsed.rows[0]?.codigoTipoDoc).toBe('33');
    // rcv_summary is read-only.
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'rcv_summary')?.annotations?.readOnlyHint).toBe(true);
  });
});
