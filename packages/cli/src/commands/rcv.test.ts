import { describe, it, expect } from 'vitest';
import { HOSTS, NotAuthenticatedError, testing, type Runtime } from '@albertomarturelo/sii-core';
import { datos, run, runJson } from '../test-helpers.js';

describe('sii rcv command (fake runtime, no SII)', () => {
  const RESUMEN_ENV = {
    respEstado: { codRespuesta: 0 },
    totDocRes: 2,
    data: [
      { rsmnTipoDocInteger: 33, dcvNombreTipoDoc: 'Factura', rsmnTotDoc: 2, rsmnMntTotal: 119000 },
    ],
  };

  // restore() backs withSession; it scripts the RCV facade's requestJson + TOKEN cookie.
  function makeRcvRuntime(requestJson: () => unknown): Runtime {
    return {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          requestJson,
          cookies: { TOKEN: 't' },
        },
      }),
    };
  }

  it('rcv summary prints the resumen rows for a period', async () => {
    const rt = makeRcvRuntime(() => RESUMEN_ENV);
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'rcv', 'summary', '2026-06');
    expect(out).toContain('RCV COMPRA 2026-06');
    expect(out).toContain('33');
    expect(out).toContain('Total documentos: 2');
  });

  it('rcv summary requires a session (NotAuthenticated → exit 2)', async () => {
    const rt = makeRcvRuntime(() => RESUMEN_ENV); // no login
    await expect(run(rt, 'rcv', 'summary', '2026-06')).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
  });

  // `rcv all` fans out over the resumen's types. Route the resumen POST vs each detalle POST
  // (branch on the URL + the body's codTipoDoc), mirroring the core task's test.
  const RESUMEN_MULTI = {
    respEstado: { codRespuesta: 0 },
    totDocRes: 2,
    data: [
      { rsmnTipoDocInteger: 33, dcvNombreTipoDoc: 'Factura', rsmnTotDoc: 1 },
      { rsmnTipoDocInteger: 34, dcvNombreTipoDoc: 'Exenta', rsmnTotDoc: 1 },
    ],
  };
  function allScript(
    detalle: Record<string, unknown>,
  ): (url: string, options?: unknown) => unknown {
    return (url, options) => {
      if (url.includes('getResumen')) return RESUMEN_MULTI;
      const cod = String(
        (options as { body?: { data?: { codTipoDoc?: unknown } } })?.body?.data?.codTipoDoc ?? '',
      );
      return detalle[cod] ?? { respEstado: { codRespuesta: 0 }, data: [] };
    };
  }

  it('rcv all prints one flat table across every type, each row tagged with its tipo', async () => {
    const rt = makeRcvRuntime(
      allScript({
        '33': { respEstado: { codRespuesta: 0 }, data: [{ detNroDoc: 1, detMntTotal: 100 }] },
        '34': { respEstado: { codRespuesta: 0 }, data: [{ detNroDoc: 2, detMntTotal: 200 }] },
      }),
    );
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'rcv', 'all', '2026-06');
    expect(out).toContain('RCV COMPRA 2026-06 — todos los tipos');
    expect(out).toContain('tipo=33');
    expect(out).toContain('tipo=34');
    expect(out).toContain('2 documento(s).');
    expect(out).not.toContain('incompleto');
  });

  it('rcv all flags a per-type rejection as incompleto (JSON carries incomplete + rejectedTypes)', async () => {
    const rt = makeRcvRuntime(
      allScript({
        '33': { respEstado: { codRespuesta: 0 }, data: [{ detNroDoc: 1, detMntTotal: 100 }] },
        '34': { respEstado: { codRespuesta: 1, msgeRespuesta: 'Tipo no disponible' } },
      }),
    );
    await run(rt, 'auth', 'login');

    const human = await run(rt, 'rcv', 'all', '2026-06');
    expect(human).toContain('⚠ Resultado incompleto');
    expect(human).toContain('34');

    const rt2 = makeRcvRuntime(
      allScript({
        '33': { respEstado: { codRespuesta: 0 }, data: [{ detNroDoc: 1, detMntTotal: 100 }] },
        '34': { respEstado: { codRespuesta: 1, msgeRespuesta: 'Tipo no disponible' } },
      }),
    );
    await run(rt2, 'auth', 'login');
    const json = (await runJson(rt2, 'rcv', 'all', '2026-06')) as {
      incomplete: boolean;
      rejectedTypes: string[];
      docs: unknown[];
    };
    expect(json.incomplete).toBe(true);
    expect(json.rejectedTypes).toEqual(['34']);
    expect(json.docs).toHaveLength(1);
  });
});
