import { describe, it, expect } from 'vitest';
import { HOSTS, testing, type Runtime } from '@albertomarturelo/sii-core';
import { connect, datos, toolText } from '../test-helpers.js';

// Synthetic Mi SII opc=34 body (no SII, no PII): one invented predio with one vencida cuota.
const BODY = JSON.stringify({
  data: {
    k: {
      descripcionComuna: 'COMUNA SINTETICA',
      comuna: 99001,
      manzana: 123,
      predio: 45,
      direccion: 'CALLE FALSA 123',
      nombrePropietario: 'PROPIETARIO SINTETICO',
      destino: 'HABITACIONAL',
      propietario: true,
      rol: '123-45',
      cuotas: {
        a: {
          condicion: 'VENCIDA',
          fechaVencimiento: '30-06-2026',
          agno: 2026,
          semestre: 1,
          cuota: 2,
          totalPago: 45678,
        },
      },
    },
  },
  metaData: { errors: null },
});

describe('@albertomarturelo/sii-mcp bienes raíces tool (in-memory client, fake runtime, no SII)', () => {
  it('bienes_raices_list returns the curated predios as JSON (read-only)', async () => {
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-10-28T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          requestForm: (url) => (url === HOSTS.miSiiCarta ? BODY : ''),
          cookies: { TOKEN: 't' },
        },
      }),
    };
    const client = await connect(runtime);
    await testing.seedSession(runtime);

    const res = await client.callTool({ name: 'bienes_raices_list', arguments: {} });
    const text = toolText(res);
    const parsed = JSON.parse(text) as {
      predios: { rol: string; cuotasVencidas: number; cuotas: { fechaVencimiento: string }[] }[];
      cuotasVencidas: number;
    };
    expect(parsed.predios).toHaveLength(1);
    expect(parsed.predios[0]?.rol).toBe('123-45');
    expect(parsed.predios[0]?.cuotas[0]?.fechaVencimiento).toBe('2026-06-30');
    expect(parsed.cuotasVencidas).toBe(1);
    expect(text).not.toContain('PROPIETARIO SINTETICO');

    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'bienes_raices_list');
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.description).toMatch(/^Session-keyed/);
    expect(tool?.description).toContain('dato personal');
  });
});
