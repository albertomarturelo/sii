import { describe, it, expect } from 'vitest';
import { HOSTS, testing, type JsonRequest, type Runtime } from '@albertomarturelo/sii-core';
import { connect, datos, isError, propKeys, toolText } from '../test-helpers.js';

// Synthetic F29 estado rows (no SII, no PII): 2026-09 has nothing filed; the rest are Vigente.
function makeRuntime(): Runtime {
  return {
    clock: new testing.FixedClock(new Date(2026, 9, 23, 12)),
    audit: new testing.RecordingAuditSink(),
    store: new testing.InMemoryKeyValueStore(),
    portal: new testing.FakePortalDriver({
      restoreSession: {
        landingUrl: HOSTS.miSii,
        datos,
        cookies: { TOKEN: 't' },
        requestJson: (url: string, options?: JsonRequest) => {
          if (!url.includes('getDeclaracionConEstados')) return { metaData: {}, data: null };
          const d = (options?.body as { data: { mes: string; anno: string } }).data;
          const rows =
            `${d.anno}-${d.mes}` === '2026-09'
              ? []
              : [{ estadoDeclaracionId: 1, estado: 'Vigente', folio: 100 }];
          return { metaData: { errors: null }, data: rows };
        },
      },
    }),
  };
}

describe('@albertomarturelo/sii-mcp alertas tool (in-memory client, fake runtime, no SII)', () => {
  it('is read-only, takes fuentes + desde (no rut), and states its auth mode and cost', async () => {
    const client = await connect(makeRuntime());
    const tool = (await client.listTools()).tools.find((t) => t.name === 'alertas')!;
    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(propKeys(tool.inputSchema).sort()).toEqual(['desde', 'fuentes']);
    expect(tool.description?.startsWith('Session-keyed')).toBe(true);
    expect(tool.description).toContain('~20 consultas');
  });

  it('returns the JSON contract for the requested sources', async () => {
    const runtime = makeRuntime();
    await testing.seedSession(runtime);
    const client = await connect(runtime);
    const res = await client.callTool({ name: 'alertas', arguments: { fuentes: ['f29'] } });
    expect(isError(res)).toBe(false);
    const json = JSON.parse(toolText(res)) as {
      alertas: { id: string; vencimiento?: unknown }[];
      fuentes: { origen: string; estado: string }[];
    };
    expect(json.alertas.map((a) => a.id)).toEqual(['f29:2026-09:sin_declarar']);
    expect(json.alertas[0]!.vencimiento).toEqual({
      conPago: '2026-10-20',
      sinPago: '2026-10-28',
      estimado: true,
    });
    expect(json.fuentes.map((f) => `${f.origen}:${f.estado}`)).toEqual([
      'f22:omitida',
      'f29:ok',
      'peticiones:omitida',
    ]);
  });

  it('an unknown fuente is refused by the schema; a bad desde comes back as a validation error', async () => {
    const runtime = makeRuntime();
    await testing.seedSession(runtime);
    const client = await connect(runtime);
    expect(
      isError(await client.callTool({ name: 'alertas', arguments: { fuentes: ['tgr'] } })),
    ).toBe(true);
    const bad = await client.callTool({ name: 'alertas', arguments: { desde: '23/10/2026' } });
    expect(isError(bad)).toBe(true);
    expect(JSON.parse(toolText(bad))).toMatchObject({ type: 'validation' });
  });
});
