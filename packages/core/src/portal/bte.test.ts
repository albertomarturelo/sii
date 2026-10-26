import { describe, it, expect } from 'vitest';
import { FakePortalSession, inlineMapsPage } from '../adapters/fake/index.js';
import type { InlineMapValue } from '../adapters/fake/index.js';
import { Rut } from '../rut/index.js';
import { Periodo } from '../periodo/index.js';
import {
  AbortedError,
  BrowserRequiredError,
  BteError,
  SessionExpiredError,
} from '../errors/index.js';
import { fetchBteMensual } from './bte.js';

// Synthetic data only (no SII, no real PII): principal 11.111.111-1. The pages are written in
// the shape observed on the report CGIs (2026-10-26, #222): literal statements, row amounts as
// `formatMiles("<n>")`, the month's sums as bare numbers.
const RUT = Rut.parse('11111111-1');
const PERIODO = Periodo.parse('2026-05');
const noPace = (): Promise<void> => Promise.resolve();
const miles = (n: string): InlineMapValue => ({ formatMiles: n });

// Monthly meta (xml_values): carries OWN-identity PII (nombre_contribuyente/rut_arrastre) that
// must NOT surface, plus the tax aggregates.
const META: Record<string, InlineMapValue> = {
  total_boletas: '2',
  suma_honorarios: 500000,
  suma_retencion_emisor: 0,
  suma_retencion_receptor: 72500,
  suma_liquido: 427500,
  nombre_contribuyente: 'SYNTHETIC OWN NAME',
  rut_arrastre: '11111111',
  dv_arrastre: '1',
};
// Two emitidas rows (arr_informe_mensual): one vigente (N) + one anulada (S).
// `email_envio`/`usuemisor` are non-curated → must never surface (no `raw`).
const ARR_EMITIDAS: Record<string, InlineMapValue> = {
  nroboleta_1: '101',
  usuemisor_1: 'SYNTHETIC OWN EMITTER NAME', // own-identity (the emitter = self) — must NOT reach raw
  fechaemision_1: '15/05/2026',
  rutreceptor_1: '77777777',
  dvreceptor_1: '7',
  nombrereceptor_1: 'Cliente Uno SpA',
  totalhonorarios_1: miles('300000'),
  honorariosliquidos_1: miles('256500'),
  retencion_emisor_1: miles('0'),
  retencion_receptor_1: miles('43500'),
  es_soc_profesional_1: 'NO',
  estado_1: 'N',
  fechaanulacion_1: '',
  email_envio_1: 'cliente1@example.com',
  codigobarras_1: 'ABC',
  nroboleta_2: '102',
  fechaemision_2: '20/05/2026',
  rutreceptor_2: '12345670',
  dvreceptor_2: 'K',
  nombrereceptor_2: 'Cliente Dos Ltda',
  totalhonorarios_2: miles('200000'),
  honorariosliquidos_2: miles('171000'),
  retencion_emisor_2: miles('0'),
  retencion_receptor_2: miles('29000'),
  es_soc_profesional_2: 'NO',
  estado_2: 'S',
  fechaanulacion_2: '21/05/2026',
  codigobarras_2: 'DEF',
};

/** A session whose `requestText` serves `pages` in order (the last one repeats) and records
 *  every URL; `evaluate` throws, as on the HTTP driver, so the facade must never need it. */
function reportSession(...pages: string[]): { session: FakePortalSession; urls: string[] } {
  const urls: string[] = [];
  const session = new FakePortalSession({
    requestText: (url) => {
      urls.push(url);
      return pages[Math.min(urls.length, pages.length) - 1];
    },
    evaluate: () => {
      throw new BrowserRequiredError('evaluate needs a browser');
    },
  });
  return { session, urls };
}

describe('BTE facade (fake session, synthetic report HTML, no SII)', () => {
  it('parses curated boletas, exposes no raw / own-PII, GETs the emitidas CGI + params', async () => {
    const { session, urls } = reportSession(
      inlineMapsPage({ xml_values: META, arr_informe_mensual: ARR_EMITIDAS }),
    );

    const res = await fetchBteMensual(
      session,
      { rut: RUT, periodo: PERIODO, side: 'EMITIDAS' },
      noPace,
    );

    expect(res).toMatchObject({
      rut: '11111111-1',
      periodo: '2026-05',
      side: 'EMITIDAS',
      totalBoletas: 2,
    });
    expect(res.totales).toEqual({
      honorarios: 500000,
      retencionEmisor: 0,
      retencionReceptor: 72500,
      liquido: 427500,
    });
    expect(res.boletas).toHaveLength(2);
    expect(res.boletas[0]).toMatchObject({
      folio: 101,
      fecha: '15/05/2026',
      contraparteRut: '77777777-7',
      contraparteNombre: 'Cliente Uno SpA',
      totalHonorarios: 300000, // formatMiles("300000") → 300000
      honorariosLiquidos: 256500,
      retencionReceptor: 43500,
      estado: 'VIG', // N
      fechaAnulacion: null,
      socProfesional: false,
    });
    expect(res.boletas[1]).toMatchObject({
      folio: 102,
      estado: 'ANUL',
      fechaAnulacion: '21/05/2026',
    });
    expect(res.boletas[1]?.contraparteRut).toBe('12345670-K');
    // BUG-1: BTE exposes NO `raw` — own-identity (usuemisor + report-meta name) and the
    // counterparty email never surface; only the curated tax fields do.
    expect(res.boletas[0]).not.toHaveProperty('raw');
    expect(JSON.stringify(res)).not.toContain('SYNTHETIC OWN EMITTER NAME'); // usuemisor (own)
    expect(JSON.stringify(res)).not.toContain('SYNTHETIC OWN NAME'); // report-meta name
    expect(JSON.stringify(res)).not.toContain('cliente1@example.com'); // counterparty email (was raw-only)
    // A GET of the emitidas monthly CGI with the split RUT + período + page 0.
    expect(session.lastTextRequest?.options).toEqual({ method: 'GET' });
    expect(urls[0]).toContain('/TMBCOC_InformeMensualBhe.cgi');
    expect(urls[0]).toContain('cbanoinformemensual=2026&cbmesinformemensual=05');
    expect(urls[0]).toContain('rut_arrastre=11111111&dv_arrastre=1&pagina_solicitada=0');
  });

  it('recibidas reads the rutemisor/nombre_emisor aliases + the …BheRec CGI', async () => {
    // The 13 row fields observed on recibidas (2026-10-26), plus a defensive own-name field.
    const ARR_RECIBIDAS: Record<string, InlineMapValue> = {
      nroboleta_1: '55',
      fecha_boleta_1: '10/05/2026',
      rutemisor_1: '20000042',
      dvemisor_1: '0',
      nombre_emisor_1: 'Proveedor Servicios EIRL',
      nombre_receptor_1: 'SYNTHETIC OWN RECEPTOR NAME', // own identity (self = receptor) — must NOT surface
      totalhonorarios_1: miles('120000'),
      honorariosliquidos_1: miles('102600'),
      retencion_receptor_1: miles('17400'),
      es_soc_profesional_1: 'NO',
      estado_1: 'N',
      fechaanulacion_1: '',
      cod_comuna_1: '13101',
      codigobarras_1: 'XYZ',
    };
    // Recibidas meta has no suma_retencion_emisor, and its sums start at 0 and grow by one
    // `+=` per row (observed 2026-10-26).
    const { session, urls } = reportSession(
      inlineMapsPage({
        xml_values: {
          total_boletas: '1',
          nombre_contribuyente: 'SYNTHETIC OWN NAME',
          suma_honorarios: 0,
          suma_retencion_receptor: 0,
          suma_liquido: 0,
        },
        arr_informe_mensual: ARR_RECIBIDAS,
      }) +
        "<script>xml_values['suma_honorarios'] += 120000;" +
        "xml_values['suma_retencion_receptor'] += 17400;" +
        "xml_values['suma_liquido'] += 102600;</script>",
    );

    const res = await fetchBteMensual(
      session,
      { rut: RUT, periodo: PERIODO, side: 'RECIBIDAS' },
      noPace,
    );

    expect(res.side).toBe('RECIBIDAS');
    expect(res.totales).toEqual({
      honorarios: 120000,
      retencionEmisor: null,
      retencionReceptor: 17400,
      liquido: 102600,
    });
    expect(res.boletas[0]).toMatchObject({
      folio: 55,
      fecha: '10/05/2026',
      contraparteRut: '20000042-0', // from rutemisor/dvemisor
      contraparteNombre: 'Proveedor Servicios EIRL',
      totalHonorarios: 120000,
      retencionEmisor: null,
      retencionReceptor: 17400,
    });
    // BUG-1: the RECIBIDAS self receptor-name never surfaces (no `raw`).
    expect(res.boletas[0]).not.toHaveProperty('raw');
    expect(JSON.stringify(res)).not.toContain('SYNTHETIC OWN RECEPTOR NAME');
    expect(urls[0]).toContain('/TMBCOC_InformeMensualBheRec.cgi');
  });

  it('an empty month is a clean 0-boleta result, not an error', async () => {
    // Report page exists (meta declared, total 0) but its rows map is empty.
    const { session } = reportSession(
      inlineMapsPage({ xml_values: { total_boletas: '0' }, arr_informe_mensual: {} }),
    );
    const res = await fetchBteMensual(
      session,
      { rut: RUT, periodo: PERIODO, side: 'EMITIDAS' },
      noPace,
    );
    expect(res.boletas).toEqual([]);
    expect(res.totalBoletas).toBe(0);
  });

  it('paginates and de-dupes until total_boletas is reached', async () => {
    // total=3: page 0 returns rows 1-2, page 1 returns row 3 (+ a duplicate of row 1).
    const row = (i: number, folio: string, monto: string): Record<string, InlineMapValue> => ({
      [`nroboleta_${i}`]: folio,
      [`rutreceptor_${i}`]: '77777777',
      [`dvreceptor_${i}`]: '7',
      [`totalhonorarios_${i}`]: miles(monto),
    });
    const meta = { total_boletas: '3' };
    const { session, urls } = reportSession(
      inlineMapsPage({
        xml_values: meta,
        arr_informe_mensual: { ...row(1, '1', '10000'), ...row(2, '2', '20000') },
      }),
      inlineMapsPage({
        xml_values: meta,
        arr_informe_mensual: { ...row(1, '1', '10000'), ...row(2, '3', '30000') }, // dup + new
      }),
    );
    const res = await fetchBteMensual(
      session,
      { rut: RUT, periodo: PERIODO, side: 'EMITIDAS' },
      noPace,
    );
    expect(res.boletas.map((b) => b.folio)).toEqual([1, 2, 3]); // dedup dropped the repeated folio 1
    expect(urls).toHaveLength(2); // walked two pages
    expect(urls[1]).toContain('pagina_solicitada=1');
  });

  it("a dead session (the driver's login-host landing) raises SessionExpiredError", async () => {
    const session = new FakePortalSession({
      requestText: () => {
        throw new SessionExpiredError('La sesión expiró. Ejecuta `sii auth login`.');
      },
    });
    await expect(
      fetchBteMensual(session, { rut: RUT, periodo: PERIODO, side: 'EMITIDAS' }, noPace),
    ).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('a non-report page 0 (no xml_values) is a BteError', async () => {
    const { session } = reportSession('<html><body>Servicio no disponible</body></html>');
    await expect(
      fetchBteMensual(session, { rut: RUT, periodo: PERIODO, side: 'EMITIDAS' }, noPace),
    ).rejects.toBeInstanceOf(BteError);
  });
});

describe('BTE facade bounded by an AbortSignal (ADR-031, #230)', () => {
  // A three-page month, one boleta per page: page i carries folio i + 1.
  const page = (i: number): string =>
    inlineMapsPage({
      xml_values: { total_boletas: '3' },
      arr_informe_mensual: {
        nroboleta_1: String(i + 1),
        rutreceptor_1: '77777777',
        dvreceptor_1: '7',
        totalhonorarios_1: miles('10000'),
      },
    });
  const PARAMS = { rut: RUT, periodo: PERIODO, side: 'EMITIDAS' } as const;

  /** Serves page N for `pagina_solicitada=N`; `onRequest(n)` runs while page n is in flight. */
  function threePages(onRequest: (n: number) => void = () => undefined): {
    session: FakePortalSession;
    urls: string[];
  } {
    const urls: string[] = [];
    const session = new FakePortalSession({
      requestText: (url) => {
        urls.push(url);
        const n = Number(/pagina_solicitada=(\d+)/.exec(url)?.[1]);
        onRequest(n);
        return page(n);
      },
    });
    return { session, urls };
  }

  it('without a signal, or with one that never fires, walks the month as before', async () => {
    const plain = threePages();
    const bounded = threePages();
    let paginas = 0;
    const a = await fetchBteMensual(plain.session, PARAMS, noPace);
    const b = await fetchBteMensual(bounded.session, PARAMS, noPace, {
      signal: new AbortController().signal,
      onPagina: () => paginas++,
    });
    expect(b).toEqual(a);
    expect(a.boletas.map((x) => x.folio)).toEqual([1, 2, 3]);
    expect(bounded.urls).toEqual(plain.urls);
    expect(paginas).toBe(3);
  });

  it('an already-aborted signal sends no request, and carries the reason as cause', async () => {
    const { session, urls } = threePages();
    const ctl = new AbortController();
    const reason = new Error('deadline');
    ctl.abort(reason);
    const err = await fetchBteMensual(session, PARAMS, noPace, { signal: ctl.signal }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AbortedError);
    expect((err as AbortedError).cause).toBe(reason);
    expect(urls).toHaveLength(0);
  });

  it('a signal fired during a pause sends no request for the next page', async () => {
    const { session, urls } = threePages();
    const ctl = new AbortController();
    const pace = (): Promise<void> => {
      ctl.abort();
      return Promise.resolve();
    };
    await expect(
      fetchBteMensual(session, PARAMS, pace, { signal: ctl.signal }),
    ).rejects.toBeInstanceOf(AbortedError);
    expect(urls).toHaveLength(1); // page 0 only
  });

  it('a signal fired while a page is in flight lets it complete, then stops before the pause', async () => {
    const ctl = new AbortController();
    const { session, urls } = threePages((n) => {
      if (n === 1) ctl.abort();
    });
    let pauses = 0;
    let paginas = 0;
    const pace = (): Promise<void> => {
      pauses++;
      return Promise.resolve();
    };
    await expect(
      fetchBteMensual(session, PARAMS, pace, { signal: ctl.signal, onPagina: () => paginas++ }),
    ).rejects.toBeInstanceOf(AbortedError);
    expect(urls).toHaveLength(2); // pages 0 and 1; page 1 was not cut
    expect(paginas).toBe(2);
    expect(pauses).toBe(1); // the pause before page 2 never started
  });

  it('a signal fired during the last page still returns the complete month', async () => {
    const ctl = new AbortController();
    const { session } = threePages((n) => {
      if (n === 2) ctl.abort();
    });
    const res = await fetchBteMensual(session, PARAMS, noPace, { signal: ctl.signal });
    expect(res.boletas.map((x) => x.folio)).toEqual([1, 2, 3]);
  });
});
