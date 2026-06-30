import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import { Rut } from '../rut/index.js';
import { Periodo } from '../periodo/index.js';
import { BteError, SessionExpiredError } from '../errors/index.js';
import { fetchBteMensual } from './bte.js';

// Synthetic data only (no SII, no real PII): principal 11.111.111-1.
const RUT = Rut.parse('11111111-1');
const PERIODO = Periodo.parse('2026-05');
const noPace = (): Promise<void> => Promise.resolve();

// Monthly meta (xml_values): carries OWN-identity PII (nombre_contribuyente/rut_arrastre) that
// must NOT surface, plus the tax aggregates.
const META = {
  total_boletas: '2',
  suma_honorarios: '500000',
  suma_retencion_emisor: '0',
  suma_retencion_receptor: '72500',
  suma_liquido: '427500',
  nombre_contribuyente: 'SYNTHETIC OWN NAME',
  rut_arrastre: '11111111',
  dv_arrastre: '1',
};
// Two emitidas rows (arr_informe_mensual). Montos are dot-formatted; one vigente (N) + one
// anulada (S). `email_envio`/`usuemisor` are non-curated → must never surface (no `raw`).
const ARR_EMITIDAS = {
  nroboleta_1: '101',
  usuemisor_1: 'SYNTHETIC OWN EMITTER NAME', // own-identity (the emitter = self) — must NOT reach raw
  fechaemision_1: '15/05/2026',
  rutreceptor_1: '77777777',
  dvreceptor_1: '7',
  nombrereceptor_1: 'Cliente Uno SpA',
  totalhonorarios_1: '300.000',
  honorariosliquidos_1: '256.500',
  retencion_emisor_1: '0',
  retencion_receptor_1: '43.500',
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
  totalhonorarios_2: '200.000',
  honorariosliquidos_2: '171.000',
  retencion_emisor_2: '0',
  retencion_receptor_2: '29.000',
  es_soc_profesional_2: 'NO',
  estado_2: 'S',
  fechaanulacion_2: '21/05/2026',
  codigobarras_2: 'DEF',
};

const isArr = (expr: string): boolean => expr.includes('arr_informe_mensual');
const isMeta = (expr: string): boolean => expr.includes('xml_values');

describe('BTE facade (fake session, synthetic inline maps, no SII)', () => {
  it('parses curated boletas, exposes no raw / own-PII, sends the emitidas CGI + params', async () => {
    const session = new FakePortalSession({
      evaluate: (expr) => (isArr(expr) ? ARR_EMITIDAS : isMeta(expr) ? META : null),
    });

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
      totalHonorarios: 300000, // dot-formatted "300.000" → 300000
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
    // Navigated to the emitidas monthly CGI with the split RUT + período + page 0.
    expect(session.gotos[0]).toContain('/TMBCOC_InformeMensualBhe.cgi');
    expect(session.gotos[0]).toContain('cbanoinformemensual=2026&cbmesinformemensual=05');
    expect(session.gotos[0]).toContain('rut_arrastre=11111111&dv_arrastre=1&pagina_solicitada=0');
  });

  it('recibidas reads the rutemisor/nombre_emisor aliases + the …BheRec CGI', async () => {
    const ARR_RECIBIDAS = {
      nroboleta_1: '55',
      fecha_boleta_1: '10/05/2026',
      rutemisor_1: '20000042',
      dvemisor_1: '0',
      nombre_emisor_1: 'Proveedor Servicios EIRL',
      nombre_receptor_1: 'SYNTHETIC OWN RECEPTOR NAME', // own identity (self = receptor) — must NOT surface
      totalhonorarios_1: '120.000',
      honorariosliquidos_1: '102.600',
      retencion_receptor_1: '17.400',
      es_soc_profesional_1: 'NO',
      estado_1: 'N',
      fechaanulacion_1: '',
      cod_comuna_1: '13101',
      codigobarras_1: 'XYZ',
    };
    const session = new FakePortalSession({
      evaluate: (expr) =>
        isArr(expr) ? ARR_RECIBIDAS : isMeta(expr) ? { ...META, total_boletas: '1' } : null,
    });

    const res = await fetchBteMensual(
      session,
      { rut: RUT, periodo: PERIODO, side: 'RECIBIDAS' },
      noPace,
    );

    expect(res.side).toBe('RECIBIDAS');
    expect(res.boletas[0]).toMatchObject({
      folio: 55,
      fecha: '10/05/2026',
      contraparteRut: '20000042-0', // from rutemisor/dvemisor
      contraparteNombre: 'Proveedor Servicios EIRL',
      totalHonorarios: 120000,
    });
    // BUG-1: the RECIBIDAS self receptor-name never surfaces (no `raw`).
    expect(res.boletas[0]).not.toHaveProperty('raw');
    expect(JSON.stringify(res)).not.toContain('SYNTHETIC OWN RECEPTOR NAME');
    expect(session.gotos[0]).toContain('/TMBCOC_InformeMensualBheRec.cgi');
  });

  it('an empty month is a clean 0-boleta result, not an error', async () => {
    const session = new FakePortalSession({
      // Report page exists (meta defined, total 0) but no rows map.
      evaluate: (expr) => (isMeta(expr) ? { total_boletas: '0' } : null),
    });
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
    const PAGE0 = {
      nroboleta_1: '1',
      rutreceptor_1: '77777777',
      dvreceptor_1: '7',
      totalhonorarios_1: '10.000',
      nroboleta_2: '2',
      rutreceptor_2: '77777777',
      dvreceptor_2: '7',
      totalhonorarios_2: '20.000',
    };
    const PAGE1 = {
      nroboleta_1: '1',
      rutreceptor_1: '77777777',
      dvreceptor_1: '7',
      totalhonorarios_1: '10.000', // dup
      nroboleta_2: '3',
      rutreceptor_2: '77777777',
      dvreceptor_2: '7',
      totalhonorarios_2: '30.000',
    };
    let arrCall = 0;
    const session = new FakePortalSession({
      evaluate: (expr) => {
        if (isArr(expr)) {
          arrCall++;
          return arrCall === 1 ? PAGE0 : PAGE1;
        }
        return isMeta(expr) ? { total_boletas: '3' } : null;
      },
    });
    const res = await fetchBteMensual(
      session,
      { rut: RUT, periodo: PERIODO, side: 'EMITIDAS' },
      noPace,
    );
    expect(res.boletas.map((b) => b.folio)).toEqual([1, 2, 3]); // dedup dropped the repeated folio 1
    expect(session.gotos).toHaveLength(2); // walked two pages
  });

  it('a dead session (goto lands on the login host) raises SessionExpiredError', async () => {
    const session = new FakePortalSession({ landingUrl: 'https://zeusr.sii.cl/AUT2000/x.html' });
    await expect(
      fetchBteMensual(session, { rut: RUT, periodo: PERIODO, side: 'EMITIDAS' }, noPace),
    ).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('a non-report page 0 (no xml_values) is a BteError', async () => {
    const session = new FakePortalSession({ evaluate: () => null }); // xml_values undefined
    await expect(
      fetchBteMensual(session, { rut: RUT, periodo: PERIODO, side: 'EMITIDAS' }, noPace),
    ).rejects.toBeInstanceOf(BteError);
  });
});
