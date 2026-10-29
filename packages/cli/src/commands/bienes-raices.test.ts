import { describe, it, expect } from 'vitest';
import { HOSTS, NotAuthenticatedError, testing, type Runtime } from '@albertomarturelo/sii-core';
import { datos, run, runJson, seed } from '../test-helpers.js';

// Synthetic Mi SII opc=34 body (no SII, no PII): one invented predio, a vencida and a vigente.
const BODY = JSON.stringify({
  data: {
    k: {
      descripcionComuna: 'COMUNA SINTETICA',
      comuna: 99001,
      manzana: 123,
      predio: 45,
      direccion: 'CALLE FALSA 123',
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
        b: {
          condicion: 'VIGENTE',
          fechaVencimiento: '2026-11-30',
          agno: 2026,
          semestre: 2,
          cuota: 4,
          totalPago: 41234,
        },
      },
    },
  },
  metaData: { errors: null },
});

describe('sii bienes-raices command (fake runtime, no SII)', () => {
  function makeRuntime(): Runtime {
    return {
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
  }

  it('bienes-raices list emits JSON by default (pipeable)', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const json = await runJson(rt, 'bienes-raices', 'list');
    expect(json.predios).toHaveLength(1);
    expect(json.predios[0].rol).toBe('123-45');
    expect(json.cuotasVencidas).toBe(1);
    expect(json.cuotasVigentes).toBe(1);
  });

  it('bienes-raices list --human prints the predio and its cuotas', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const out = await run(rt, 'bienes-raices', 'list', '--human');
    expect(out).toContain('Rol 123-45');
    expect(out).toContain('1 vencidas, 1 vigentes');
    expect(out).toContain('2026-2  VENCIDA  vence 2026-06-30');
    expect(out).toContain('45.678');
  });

  it('requires a session (NotAuthenticated)', async () => {
    await expect(run(makeRuntime(), 'bienes-raices', 'list')).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
  });
});
