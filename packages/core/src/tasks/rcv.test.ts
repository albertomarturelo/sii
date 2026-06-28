import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { Runtime } from '../seams/index.js';
import { NotAuthenticatedError } from '../errors/index.js';
import { initOperateState, setOperatingRut } from '../identity/index.js';
import { writeSession } from '../auth/index.js';
import { rcvSummary, rcvList } from './rcv.js';

// Synthetic data (no SII, no real PII): persona 20.000.042-0, empresa 77.777.777-7.
const SELF = '20000042-0';
const EMPRESA = '77777777-7';

const RESUMEN_ENV = {
  respEstado: { codRespuesta: 0 },
  totDocRes: 2,
  data: [
    { rsmnTipoDocInteger: 33, dcvNombreTipoDoc: 'Factura', rsmnTotDoc: 2, rsmnMntTotal: 119000 },
  ],
};
const DETALLE_ENV = {
  respEstado: { codRespuesta: 0 },
  data: [{ detNroDoc: 7, detRutDoc: 77777777, detDvDoc: '7', detMntTotal: 59500 }],
};

function makeRuntime(requestJson: (url: string) => unknown): Runtime {
  return {
    clock: new FixedClock(new Date('2026-06-27T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver({ restoreSession: { requestJson, cookies: { TOKEN: 't' } } }),
  };
}

async function seed(runtime: Runtime): Promise<void> {
  await writeSession(runtime.store, { rut: SELF, cookies: ['c'], savedAt: '2026-06-27T12:00:00Z' });
  await initOperateState(runtime.store, {
    selfRut: SELF,
    accountType: 'persona',
    operable: [
      { rut: SELF, razonSocial: 'Juan Pérez', isSelf: true },
      { rut: EMPRESA, razonSocial: 'Mi Empresa SpA', isSelf: false },
    ],
  });
}

const entries = (rt: Runtime) => (rt.audit as RecordingAuditSink).entries;

describe('rcv tasks (fakes, no SII)', () => {
  it('rcvSummary acquires a session, queries as self, returns parsed rows + audits', async () => {
    const rt = makeRuntime(() => RESUMEN_ENV);
    await seed(rt);

    const res = await rcvSummary(rt, { periodo: '2026-06', side: 'COMPRA' });
    expect(res).toMatchObject({
      rut: SELF,
      periodo: '2026-06',
      side: 'COMPRA',
      totalDocumentos: 2,
    });
    expect(res.rows[0]?.codigoTipoDoc).toBe('33');

    const a = entries(rt).at(-1)!;
    expect(a).toMatchObject({
      action: 'rcv_resumen',
      result: 'ok',
      rut: SELF,
      periodo: '202606',
      side: 'COMPRA',
    });
    expect(a.rutAuth).toBeUndefined(); // operating == self → no rutAuth
  });

  it('--rut override queries the represented empresa and records rutAuth = session principal', async () => {
    const rt = makeRuntime(() => RESUMEN_ENV);
    await seed(rt);

    const res = await rcvSummary(rt, { periodo: '202606', side: 'VENTA', rut: EMPRESA });
    expect(res.rut).toBe(EMPRESA);
    expect(entries(rt).at(-1)).toMatchObject({ rut: EMPRESA, rutAuth: SELF });
  });

  it('honors the operate pointer when no --rut is given', async () => {
    const rt = makeRuntime(() => RESUMEN_ENV);
    await seed(rt);
    await setOperatingRut(rt.store, EMPRESA);

    const res = await rcvSummary(rt, { periodo: '2026-06', side: 'COMPRA' });
    expect(res.rut).toBe(EMPRESA);
  });

  it('rcvList queries the detalle for a DTE type and parses curated docs', async () => {
    const rt = makeRuntime(() => DETALLE_ENV);
    await seed(rt);

    const res = await rcvList(rt, { periodo: '2026-06', side: 'COMPRA', codigoTipoDoc: '33' });
    expect(res.codigoTipoDoc).toBe('33');
    expect(res.docs[0]).toMatchObject({ folio: 7, rutEmisor: '77777777-7', montoTotal: 59500 });
    expect(entries(rt).at(-1)).toMatchObject({
      action: 'rcv_detalle',
      result: 'ok',
      codigoTipoDoc: '33',
    });
  });

  it('a bad period fails fast with no session opened', async () => {
    const rt = makeRuntime(() => RESUMEN_ENV);
    await seed(rt);
    await expect(rcvSummary(rt, { periodo: 'nope', side: 'COMPRA' })).rejects.toThrow();
    expect(rt.portal.restoreCalls).toBe(0);
  });

  it('no session → NotAuthenticated, with a failed audit receipt', async () => {
    const rt = makeRuntime(() => RESUMEN_ENV); // not seeded
    await expect(rcvSummary(rt, { periodo: '2026-06', side: 'COMPRA' })).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
    expect(entries(rt).at(-1)).toMatchObject({ action: 'rcv_resumen', result: 'failed' });
  });
});
