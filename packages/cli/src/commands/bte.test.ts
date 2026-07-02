import { describe, it, expect } from 'vitest';
import { HOSTS, NotAuthenticatedError, testing, type Runtime } from '@altumstack/sii-core';
import { datos, run, runJson } from '../test-helpers.js';

describe('sii bte command (fake runtime, no SII)', () => {
  const META = { total_boletas: '1', suma_liquido: '256500', nombre_contribuyente: 'PII-OWN-XYZ' };
  const ARR = {
    nroboleta_1: '101',
    fechaemision_1: '15/05/2026',
    rutreceptor_1: '12345670',
    dvreceptor_1: 'K',
    nombrereceptor_1: 'Cliente Uno SpA',
    honorariosliquidos_1: '256.500',
    estado_1: 'N',
  };
  // restoreSession.evaluate serves BOTH the login DatosCntrNow probe and the BTE inline maps.
  const evaluate = (expr: string): unknown =>
    expr.includes('arr_informe_mensual') ? ARR : expr.includes('xml_values') ? META : datos();
  const makeBteRuntime = (): Runtime => ({
    clock: new testing.FixedClock(new Date('2026-06-30T12:00:00Z')),
    audit: new testing.RecordingAuditSink(),
    store: new testing.InMemoryKeyValueStore(),
    portal: new testing.FakePortalDriver({
      loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
      restoreSession: { landingUrl: HOSTS.miSii, evaluate },
    }),
  });

  it('bte list <periodo> prints the month boletas (EMITIDAS by default)', async () => {
    const rt = makeBteRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'bte', 'list', '2026-05');
    expect(out).toContain('BHE EMITIDAS 2026-05');
    expect(out).toContain('folio=101');
    expect(out).toContain('1 boleta(s)');
    expect(out).not.toContain('PII-OWN-XYZ'); // own-identity meta never prints
  });

  it('JSON default: bte list emits the curated object (no --rut concept)', async () => {
    const rt = makeBteRuntime();
    await run(rt, 'auth', 'login');
    const json = (await runJson(rt, 'bte', 'list', '2026-05', '--recibidas')) as {
      side: string;
      boletas: { folio: number }[];
    };
    expect(json.side).toBe('RECIBIDAS');
    expect(json.boletas.map((b) => b.folio)).toEqual([101]);
  });

  it('bte list requires a session (NotAuthenticated → exit 2)', async () => {
    await expect(run(makeBteRuntime(), 'bte', 'list', '2026-05')).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
  });
});
