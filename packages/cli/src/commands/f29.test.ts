import { describe, it, expect } from 'vitest';
import { HOSTS, NotAuthenticatedError, testing, type Runtime } from '@albertomarturelo/sii-core';
import { datos, run, runJson } from '../test-helpers.js';

describe('sii f29 command (fake runtime, no SII)', () => {
  const PROPUESTA = {
    metaData: { errors: null },
    data: {
      tipopropuesta: 40,
      estado: 0,
      descripcionEstado: null,
      listCodPropuestos: [
        { codigo: '503', valor: '1000000' }, // debitos
        { codigo: '538', valor: '190000' }, // debitos (TOTAL DÉBITOS)
        { codigo: '511', valor: '50000' }, // creditos
        { codigo: '151', valor: '30000' }, // retenciones
      ],
      listCodAdministrativos: [{ codigo: '9114', valor: '1' }], // otros
      listCodBase: [{ codigo: '05', valor: 'PII NAME' }], // identity PII → dropped
    },
  };
  const ESTADO = {
    metaData: { errors: null },
    data: [
      {
        estadoDeclaracionId: 1,
        estado: 'Vigente',
        folio: 7654321,
        declFechaCreacion: '12/06/2026',
        monto: 880000, // declared total a pagar → surfaced
      },
    ],
  };
  function makeF29Runtime(): Runtime {
    return {
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
              ? PROPUESTA
              : url.includes('getDeclaracionConEstados')
                ? ESTADO
                : { metaData: {}, data: null },
        },
      }),
    };
  }

  it('f29 formulario <periodo> prints the propuesta grouped + labeled (PII dropped)', async () => {
    const rt = makeF29Runtime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'f29', 'formulario', '2026-05');
    expect(out).toContain('F29 2026-05');
    expect(out).toContain('fuente: propuesta');
    expect(out).toContain('Débitos (ventas):');
    expect(out).toContain('TOTAL DÉBITOS'); // glosa from the taxonomy
    expect(out).toContain('Créditos (compras):');
    expect(out).not.toContain('PII NAME'); // listCodBase never prints
  });

  it('f29 overview <año> lists the per-month position with total', async () => {
    const rt = makeF29Runtime();
    await run(rt, 'auth', 'login');
    const json = (await runJson(rt, 'f29', 'overview', '2026')) as {
      desde: string;
      hasta: string;
      meses: { periodo: string; estado: string | null; total: number | null }[];
    };
    expect(json.desde).toBe('2026-01');
    expect(json.hasta).toBe('2026-12');
    expect(json.meses).toHaveLength(12);
    expect(json.meses.every((m) => m.estado === 'Vigente' && m.total === 880000)).toBe(true);
  });

  it('f29 status <periodo> lists the presented declaración with total', async () => {
    const rt = makeF29Runtime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'f29', 'status', '2026-05');
    expect(out).toContain('(estado)');
    expect(out).toContain('Vigente');
    expect(out).toContain('folio 7654321');
    expect(out).toContain('880.000'); // total surfaced (es-CL)
  });

  it('f29 formulario requires a session (NotAuthenticated)', async () => {
    await expect(run(makeF29Runtime(), 'f29', 'formulario', '2026-05')).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
  });
});
