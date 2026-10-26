import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
  inlineMapsPage,
} from '../adapters/fake/index.js';
import type { Runtime } from '../seams/index.js';
import { AbortedError, BteError, NotAuthenticatedError, classifyError } from '../errors/index.js';
import { initOperateState, setOperatingRut } from '../identity/index.js';
import { writeSession } from '../auth/index.js';
import { bteList } from './bte.js';

// Synthetic data (no SII, no real PII): persona 11.111.111-1, empresa 77.777.777-7.
const SELF = '11111111-1';
const EMPRESA = '77777777-7';

const META = {
  total_boletas: '1',
  suma_honorarios: '300000',
  suma_retencion_emisor: '0',
  suma_retencion_receptor: '43500',
  suma_liquido: '256500',
  nombre_contribuyente: 'SYNTHETIC OWN NAME',
};
const ARR = {
  nroboleta_1: '101',
  fechaemision_1: '15/05/2026',
  rutreceptor_1: '12345670',
  dvreceptor_1: 'K',
  nombrereceptor_1: 'Cliente Uno SpA',
  totalhonorarios_1: { formatMiles: '300000' },
  honorariosliquidos_1: { formatMiles: '256500' },
  retencion_receptor_1: { formatMiles: '43500' },
  estado_1: 'N',
};

const REPORT = inlineMapsPage({ xml_values: META, arr_informe_mensual: ARR });

function makeRuntime(): Runtime {
  return {
    clock: new FixedClock(new Date('2026-06-30T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    // restore() backs withSession; the facade parses the maps from the report's HTML. No
    // `browser` engine: bte list runs on the HTTP driver alone (#222).
    portal: new FakePortalDriver({ restoreSession: { requestText: () => REPORT } }),
  };
}

async function seed(runtime: Runtime): Promise<void> {
  await writeSession(runtime.store, { rut: SELF, cookies: ['c'], savedAt: '2026-06-30T12:00:00Z' });
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

describe('bte tasks (fakes, no SII)', () => {
  it('bteList reads the session principal, returns parsed boletas + audits ok', async () => {
    const rt = makeRuntime();
    await seed(rt);

    const res = await bteList(rt, { periodo: '2026-05', side: 'EMITIDAS' });
    expect(res).toMatchObject({ rut: SELF, periodo: '2026-05', side: 'EMITIDAS', totalBoletas: 1 });
    expect(res.boletas[0]).toMatchObject({
      folio: 101,
      contraparteRut: '12345670-K',
      estado: 'VIG',
    });
    // Own-identity PII from the report meta never surfaces.
    expect(JSON.stringify(res)).not.toContain('SYNTHETIC OWN NAME');

    const a = entries(rt).at(-1)!;
    expect(a).toMatchObject({
      action: 'bte_list',
      result: 'ok',
      rut: SELF,
      period: '202605',
      side: 'EMITIDAS',
    });
  });

  it('rejects a representing operate pointer UP FRONT (session-keyed), with no session opened', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await setOperatingRut(rt.store, EMPRESA); // operate as the represented empresa

    await expect(bteList(rt, { periodo: '2026-05', side: 'EMITIDAS' })).rejects.toBeInstanceOf(
      BteError,
    );
    expect(rt.portal.restoreCalls).toBe(0); // rejected before any session was opened
    // The guard fires BEFORE the audited body (mirrors F29), so there is no receipt for it.
    expect(entries(rt)).toHaveLength(0);
  });

  it('an empty month returns a clean 0-boleta result', async () => {
    const rt: Runtime = {
      ...makeRuntime(),
      portal: new FakePortalDriver({
        restoreSession: {
          requestText: () =>
            inlineMapsPage({ xml_values: { total_boletas: '0' }, arr_informe_mensual: {} }),
        },
      }),
    };
    await seed(rt);
    const res = await bteList(rt, { periodo: '2026-05', side: 'RECIBIDAS' });
    expect(res.boletas).toEqual([]);
    expect(res.totalBoletas).toBe(0);
    expect(entries(rt).at(-1)).toMatchObject({ action: 'bte_list', result: 'ok' });
  });

  it('a bad período fails fast with no session opened', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await expect(bteList(rt, { periodo: 'nope', side: 'EMITIDAS' })).rejects.toThrow();
    expect(rt.portal.restoreCalls).toBe(0);
  });

  it('no session → NotAuthenticated, with a failed audit receipt', async () => {
    const rt = makeRuntime(); // not seeded
    await expect(bteList(rt, { periodo: '2026-05', side: 'EMITIDAS' })).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
    expect(entries(rt).at(-1)).toMatchObject({ action: 'bte_list', result: 'failed' });
  });

  describe('bteList bounded by an AbortSignal (ADR-031, #230)', () => {
    it('an already-aborted signal opens no session and audits `aborted` with 0 pages', async () => {
      const rt = makeRuntime();
      await seed(rt);
      const ctl = new AbortController();
      ctl.abort();
      const err = await bteList(rt, {
        periodo: '2026-05',
        side: 'EMITIDAS',
        signal: ctl.signal,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AbortedError);
      expect(classifyError(err)).toEqual({ type: 'aborted' });
      expect((rt.portal as FakePortalDriver).restoreCalls).toBe(0);
      expect(entries(rt).at(-1)).toMatchObject({
        action: 'bte_list',
        result: 'aborted',
        paginas: 0,
      });
    });

    it('a cut after the first page audits the pages read and no boleta data', async () => {
      // Two pages of one boleta each; the signal fires while page 0 is in flight.
      const pageOf = (folio: string): string =>
        inlineMapsPage({
          xml_values: { total_boletas: '2' },
          arr_informe_mensual: { nroboleta_1: folio, rutreceptor_1: '12345670', dvreceptor_1: 'K' },
        });
      const ctl = new AbortController();
      const rt: Runtime = {
        ...makeRuntime(),
        portal: new FakePortalDriver({
          restoreSession: {
            requestText: (url: string) => {
              ctl.abort();
              return url.includes('pagina_solicitada=0') ? pageOf('101') : pageOf('102');
            },
          },
        }),
      };
      await seed(rt);
      await expect(
        bteList(rt, { periodo: '2026-05', side: 'EMITIDAS', signal: ctl.signal }),
      ).rejects.toBeInstanceOf(AbortedError);
      const receipt = entries(rt).at(-1);
      expect(receipt).toMatchObject({ action: 'bte_list', result: 'aborted', paginas: 1 });
      expect(JSON.stringify(receipt)).not.toContain('101');
    });
  });
});
