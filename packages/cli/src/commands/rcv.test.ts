import { describe, it, expect } from 'vitest';
import { HOSTS, NotAuthenticatedError, testing, type Runtime } from '@albertomarturelo/sii-core';
import { datos, run } from '../test-helpers.js';

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
});
