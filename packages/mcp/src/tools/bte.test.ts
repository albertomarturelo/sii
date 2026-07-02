import { describe, it, expect } from 'vitest';
import { HOSTS, testing, type Runtime } from '@altumstack/sii-core';
import { connect, datos, toolText } from '../test-helpers.js';

describe('@sii/mcp bte tools (in-memory client, fake runtime, no SII)', () => {
  it('bte_list returns the month boletas as JSON (session-keyed, own-PII dropped)', async () => {
    const META = {
      total_boletas: '1',
      suma_liquido: '256500',
      nombre_contribuyente: 'PII-OWN-NAME-XYZ', // report meta → must not surface
    };
    const ARR = {
      nroboleta_1: '101',
      fechaemision_1: '15/05/2026',
      rutreceptor_1: '12345670',
      dvreceptor_1: 'K',
      nombrereceptor_1: 'Cliente Uno SpA',
      totalhonorarios_1: '300.000',
      honorariosliquidos_1: '256.500',
      estado_1: 'N',
    };
    // restoreSession.evaluate serves BOTH the login DatosCntrNow probe and the BTE inline maps.
    const evaluate = (expr: string): unknown =>
      expr.includes('arr_informe_mensual') ? ARR : expr.includes('xml_values') ? META : datos();
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-30T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: { landingUrl: HOSTS.miSii, evaluate },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({ name: 'bte_list', arguments: { periodo: '2026-05' } });
    const parsed = JSON.parse(toolText(res)) as {
      side: string;
      periodo: string;
      boletas: { folio: number; contraparteRut: string }[];
    };
    expect(parsed).toMatchObject({ side: 'EMITIDAS', periodo: '2026-05' });
    expect(parsed.boletas[0]).toMatchObject({ folio: 101, contraparteRut: '12345670-K' });
    expect(toolText(res)).not.toContain('PII-OWN-NAME-XYZ'); // own-identity meta never surfaces

    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'bte_list')?.annotations?.readOnlyHint).toBe(true);
  });
});
