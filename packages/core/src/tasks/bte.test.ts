import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryFileSink,
  InMemoryKeyValueStore,
  RecordingAuditSink,
  inlineMapsPage,
} from '../adapters/fake/index.js';
import type { Runtime } from '../seams/index.js';
import {
  AbortedError,
  BteError,
  NotAuthenticatedError,
  ValidationError,
  classifyError,
} from '../errors/index.js';
import { initOperateState, setOperatingRut } from '../identity/index.js';
import { writeSession } from '../auth/index.js';
import { bteList, btePdf } from './bte.js';

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

describe('btePdf (#282, fakes, no SII, no filesystem)', () => {
  const COD = 'SYNTHCB0000000000101';
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x33]); // "%PDF-1.3"
  // Recibidas of one month: two emisores share folio 7 (a folio is unique per emisor only),
  // and folio 8 has no código de barras.
  const RECIBIDAS = inlineMapsPage({
    xml_values: { total_boletas: '3', nombre_contribuyente: 'SYNTHETIC OWN NAME' },
    arr_informe_mensual: {
      nroboleta_1: '7',
      rutemisor_1: '20000042',
      dvemisor_1: '0',
      nombre_emisor_1: 'Emisor Uno',
      estado_1: 'S', // an anulada is served too (observed 2026-11-15)
      codigobarras_1: COD,
      nroboleta_2: '7',
      rutemisor_2: '12345670',
      dvemisor_2: 'K',
      nombre_emisor_2: 'Emisor Dos',
      estado_2: 'N',
      codigobarras_2: 'SYNTHCB0000000000202',
      nroboleta_3: '8',
      rutemisor_3: '12345670',
      dvemisor_3: 'K',
      estado_3: 'N',
    },
  });

  function pdfRuntime(listing: string = REPORT): { rt: Runtime; urls: string[] } {
    const urls: string[] = [];
    const rt: Runtime = {
      ...makeRuntime(),
      files: new InMemoryFileSink(),
      portal: new FakePortalDriver({
        restoreSession: {
          requestText: (url) => {
            urls.push(url);
            return listing;
          },
          requestBinary: (url) => {
            urls.push(url);
            return PDF;
          },
        },
      }),
    };
    return { rt, urls };
  }
  const written = (rt: Runtime) => (rt.files as InMemoryFileSink).files;

  it('by código: one GET, a descriptor (never the bytes), and a receipt without boleta data', async () => {
    const { rt, urls } = pdfRuntime();
    await seed(rt);
    const res = await btePdf(rt, { side: 'EMITIDAS', codBarras: COD, directorio: '/tmp/docs/' });
    expect(res).toEqual({
      path: `/tmp/docs/bte-emitida-${COD}.pdf`,
      archivo: `bte-emitida-${COD}.pdf`,
      bytes: PDF.length,
      contentType: 'application/pdf',
      rut: SELF,
      side: 'EMITIDAS',
      codBarras: COD,
      boleta: null,
    });
    expect(urls).toHaveLength(1); // no listing
    expect(urls[0]).toContain('origen=PROPIOS');
    expect(written(rt).get(res.path)).toEqual(PDF);
    expect(entries(rt).at(-1)).toEqual({
      ts: expect.any(String),
      action: 'bte_pdf',
      result: 'ok',
      rut: SELF,
      side: 'EMITIDAS',
      folio: null,
      bytes: PDF.length,
      durationMs: 0,
    });
  });

  it('by período + folio: the listing, a pause, then the PDF of that row', async () => {
    const { rt, urls } = pdfRuntime(
      inlineMapsPage({
        xml_values: { total_boletas: '1' },
        arr_informe_mensual: { nroboleta_1: '101', estado_1: 'N', codigobarras_1: COD },
      }),
    );
    await seed(rt);
    const res = await btePdf(rt, {
      side: 'EMITIDAS',
      periodo: '2026-05',
      folio: 101,
      directorio: '/tmp/docs',
    });
    expect(res.boleta).toMatchObject({ folio: 101, codBarras: COD });
    expect(urls[0]).toContain('TMBCOC_InformeMensualBhe.cgi');
    expect(urls[1]).toContain(`txt_codigobarras=${COD}`);
    expect((rt.clock as FixedClock).slept).toEqual([1000]); // paced between the two calls
    expect(entries(rt).at(-1)).toMatchObject({ action: 'bte_pdf', result: 'ok', folio: 101 });
    // The receipt never carries the counterparty, the montos or the código.
    expect(JSON.stringify(entries(rt))).not.toContain(COD);
  });

  it('recibidas: a folio two emisores share needs the emisor; with it, that row (an anulada) is served', async () => {
    const { rt, urls } = pdfRuntime(RECIBIDAS);
    await seed(rt);
    const ambiguo = { side: 'RECIBIDAS' as const, periodo: '2026-05', folio: 7, directorio: '/d' };
    await expect(btePdf(rt, ambiguo)).rejects.toThrow(
      'Hay 2 boletas con folio 7 en las recibidas de 2026-05, de distintos emisores. Indica el RUT del emisor.',
    );
    expect(written(rt).size).toBe(0);
    expect(entries(rt).at(-1)).toEqual({
      ts: expect.any(String),
      action: 'bte_pdf',
      result: 'failed',
      side: 'RECIBIDAS',
      folio: 7,
    });

    const res = await btePdf(rt, { ...ambiguo, emisor: '20.000.042-0' });
    expect(res.boleta).toMatchObject({ folio: 7, contraparteRut: '20000042-0', estado: 'ANUL' });
    expect(res.archivo).toBe(`bte-recibida-${COD}.pdf`);
    expect(urls.at(-1)).toContain('origen=RECIBIDOS');
  });

  it('a folio not in the month, or a row with no código, is a BteError and no PDF is asked for', async () => {
    const { rt, urls } = pdfRuntime(RECIBIDAS);
    await seed(rt);
    const base = { side: 'RECIBIDAS' as const, periodo: '2026-05', directorio: '/d' };
    await expect(btePdf(rt, { ...base, folio: 9 })).rejects.toThrow(
      'No hay una boleta con folio 9 en las recibidas de 2026-05. Revisa `bte list`.',
    );
    await expect(btePdf(rt, { ...base, folio: 8 })).rejects.toThrow(
      'La boleta folio 8 no trae código de barras en el listado del SII.',
    );
    expect(urls.every((u) => u.includes('TMBCOC_InformeMensualBheRec.cgi'))).toBe(true);
  });

  it("SII's refusal page is a BteError: no file written, a failed receipt, never retried", async () => {
    let pdfCalls = 0;
    const page = Uint8Array.from(
      '<html><body><table><tr><td>Sr. Contribuyente:</td></tr>' +
        '<tr><td>No ha sido posible completar su solicitud.</td></tr></table></body></html>',
      (c) => c.charCodeAt(0),
    );
    const rt: Runtime = {
      ...makeRuntime(),
      files: new InMemoryFileSink(),
      portal: new FakePortalDriver({
        restoreSession: {
          requestBinary: () => {
            pdfCalls++;
            return { status: 200, contentType: 'text/html; charset=ISO-8859-1', bytes: page };
          },
        },
      }),
    };
    await seed(rt);
    const err = await btePdf(rt, { side: 'EMITIDAS', codBarras: COD, directorio: '/d' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BteError);
    expect((err as Error).message).toBe(
      'El SII no entregó el PDF de la boleta: No ha sido posible completar su solicitud.',
    );
    expect(classifyError(err)).toMatchObject({ type: 'sii_error' });
    expect(pdfCalls).toBe(1);
    expect(written(rt).size).toBe(0);
    expect(entries(rt).at(-1)).toEqual({
      ts: expect.any(String),
      action: 'bte_pdf',
      result: 'failed',
      side: 'EMITIDAS',
      folio: null,
    });
  });

  it('bad input fails before any session', async () => {
    const { rt } = pdfRuntime();
    await seed(rt);
    const d = { directorio: '/d' };
    for (const args of [
      { side: 'EMITIDAS' as const, ...d }, // no address
      { side: 'EMITIDAS' as const, codBarras: 'corto', ...d },
      { side: 'EMITIDAS' as const, codBarras: COD, folio: 1, periodo: '2026-05', ...d },
      { side: 'EMITIDAS' as const, periodo: '2026-05', ...d }, // no folio
      { side: 'EMITIDAS' as const, periodo: '2026-05', folio: 0, ...d },
      { side: 'EMITIDAS' as const, periodo: '2026-05', folio: 1, emisor: '20000042-0', ...d },
    ]) {
      await expect(btePdf(rt, args)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(
      btePdf(rt, { side: 'RECIBIDAS', periodo: '2026-05', folio: 1, emisor: '20000042-1', ...d }),
    ).rejects.toThrow(); // Mod-11
    expect(rt.portal.restoreCalls).toBe(0);
  });

  it('refuses a representing operate pointer and a runtime without a FileSink, with no session', async () => {
    const { rt } = pdfRuntime();
    await seed(rt);
    await setOperatingRut(rt.store, EMPRESA);
    await expect(
      btePdf(rt, { side: 'RECIBIDAS', codBarras: COD, directorio: '/d' }),
    ).rejects.toBeInstanceOf(BteError);
    const { files: _f, ...sinFiles } = pdfRuntime().rt;
    await expect(
      btePdf(sinFiles, { side: 'RECIBIDAS', codBarras: COD, directorio: '/d' }),
    ).rejects.toThrow(/FileSink/);
    expect(rt.portal.restoreCalls).toBe(0);
  });
});
