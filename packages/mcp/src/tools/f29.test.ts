import { describe, it, expect } from 'vitest';
import { HOSTS, testing, type Runtime } from '@albertomarturelo/sii-core';
import { connect, datos, toolText } from '../test-helpers.js';

describe('@albertomarturelo/sii-mcp f29 tools (in-memory client, fake runtime, no SII)', () => {
  it('f29_formulario returns the propuesta grouped + labeled as JSON (session-keyed, no PII)', async () => {
    const propuesta = {
      metaData: { errors: null },
      data: {
        tipopropuesta: 40,
        estado: 0,
        descripcionEstado: null,
        listCodPropuestos: [
          { codigo: '503', valor: '1000000' }, // debitos
          { codigo: '511', valor: '50000' }, // creditos
        ],
        listCodAdministrativos: [],
        listCodBase: [{ codigo: '05', valor: 'PII-MARKER-XYZ' }], // identity PII → dropped
      },
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
          cookies: { TOKEN: 't' },
          requestJson: (url) =>
            url.includes('getDeclaracionConCondicionesYTipoPropuesta')
              ? propuesta
              : { metaData: {}, data: null },
        },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({
      name: 'f29_formulario',
      arguments: { periodo: '2026-05' },
    });
    const parsed = JSON.parse(toolText(res)) as {
      periodo: string;
      fuente: string;
      tienePropuesta: boolean;
      grupos: { debitos: { codigo: string }[]; creditos: { codigo: string }[] };
    };
    expect(parsed).toMatchObject({ periodo: '2026-05', fuente: 'propuesta', tienePropuesta: true });
    expect(parsed.grupos.debitos.map((l) => l.codigo)).toEqual(['503']);
    expect(parsed.grupos.creditos.map((l) => l.codigo)).toEqual(['511']);
    expect(toolText(res)).not.toContain('PII-MARKER-XYZ'); // listCodBase never surfaces

    // f29_formulario is read-only.
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'f29_formulario')?.annotations?.readOnlyHint).toBe(true);
  });
});
