import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import { Rut } from '../rut/index.js';
import { Periodo } from '../periodo/index.js';
import { RcvError, SessionExpiredError } from '../errors/index.js';
import { fetchRcvResumen, fetchRcvDetalle } from './rcv.js';

// Synthetic data only (no real PII, no SII): operating 20.000.042-0, emisor 77.777.777-7.
const RUT = Rut.parse('20000042-0');
const PERIODO = Periodo.parse('2026-06');

const session = (requestJson: (url: string, options?: unknown) => unknown): FakePortalSession =>
  new FakePortalSession({ requestJson, cookies: { TOKEN: 'conv-123' } });

const reqBody = (s: FakePortalSession): Record<string, unknown> =>
  (s.lastRequest?.options?.body as { data: Record<string, unknown> }).data;

describe('RCV facade (fake session, synthetic envelopes, no SII)', () => {
  it('getResumen: parses curated rows from the observed rsmn*/dcv* keys + sends the right body', async () => {
    const s = session(() => ({
      respEstado: { codRespuesta: 0 },
      totDocRes: 5,
      data: [
        {
          rsmnTipoDocInteger: 33,
          dcvNombreTipoDoc: 'Factura Electrónica',
          rsmnTotDoc: 5,
          rsmnMntExe: 0,
          rsmnMntNeto: 100000,
          rsmnMntIVA: 19000,
          rsmnMntTotal: 119000,
        },
      ],
    }));

    const res = await fetchRcvResumen(s, { rut: RUT, periodo: PERIODO, side: 'COMPRA' });

    expect(res).toMatchObject({
      rut: '20000042-0',
      periodo: '2026-06',
      side: 'COMPRA',
      totalDocumentos: 5,
    });
    expect(res.rows).toEqual([
      {
        codigoTipoDoc: '33',
        descripcion: 'Factura Electrónica',
        totalDocumentos: 5,
        montoExento: 0,
        montoNeto: 100000,
        montoIva: 19000,
        montoTotal: 119000,
      },
    ]);
    // Body carries the operating RUT split + period + side (ADR-005 body-RUT).
    expect(reqBody(s)).toMatchObject({
      rutEmisor: '20000042',
      dvEmisor: '0',
      ptributario: '202606',
      operacion: 'COMPRA',
      busquedaInicial: true,
    });
  });

  it('getResumen: empty data[] is a legitimate "no documents", not an error', async () => {
    const s = session(() => ({ respEstado: { codRespuesta: 0 }, data: [] }));
    const res = await fetchRcvResumen(s, { rut: RUT, periodo: PERIODO, side: 'VENTA' });
    expect(res.rows).toEqual([]);
    expect(res.totalDocumentos).toBeNull();
  });

  it('getResumen: codRespuesta 3 ("sin movimientos") is an empty result, not an error', async () => {
    // Observed live 2026-06-28: SII returns code 3 (null message, no rows) for a
    // valid query with no documents that side/period — must NOT throw.
    const s = session(() => ({ respEstado: { codRespuesta: 3, msgeRespuesta: null }, data: null }));
    const res = await fetchRcvResumen(s, { rut: RUT, periodo: PERIODO, side: 'VENTA' });
    expect(res.rows).toEqual([]);
  });

  it('getResumen: a respEstado error is surfaced verbatim as RcvError', async () => {
    const s = session(() => ({
      respEstado: { codRespuesta: -1, msgeRespuesta: 'Periodo fuera de rango' },
    }));
    await expect(
      fetchRcvResumen(s, { rut: RUT, periodo: PERIODO, side: 'COMPRA' }),
    ).rejects.toThrow('Periodo fuera de rango');
    await expect(
      fetchRcvResumen(s, { rut: RUT, periodo: PERIODO, side: 'COMPRA' }),
    ).rejects.toBeInstanceOf(RcvError);
  });

  it('getDetalle: parses det* fields, canonical emisor RUT, ISO dates, keeps raw + sends recaptcha sentinel', async () => {
    const s = session(() => ({
      respEstado: { codRespuesta: 0 },
      data: [
        {
          detNroDoc: 42,
          detRutDoc: 77777777,
          detDvDoc: '7',
          detRznSoc: 'Proveedor SpA',
          detFchDoc: '15/06/2026',
          detFecRecepcion: '16/06/2026 10:30:00',
          detMntExe: 0,
          detMntNeto: 50000,
          detMntIVA: 9500,
          detMntTotal: 59500,
          detEventoReceptor: 'ACD',
          detEventoReceptorLeyenda: 'Aceptado',
          ivaUsoComun: 1234, // tax-special field → only in raw
        },
      ],
    }));

    const res = await fetchRcvDetalle(s, {
      rut: RUT,
      periodo: PERIODO,
      side: 'COMPRA',
      codigoTipoDoc: '33',
    });

    expect(res.docs).toHaveLength(1);
    const d = res.docs[0]!;
    expect(d).toMatchObject({
      folio: 42,
      rutEmisor: '77777777-7',
      razonSocial: 'Proveedor SpA',
      fechaEmision: '2026-06-15',
      fechaRecepcion: '2026-06-16 10:30:00',
      montoNeto: 50000,
      montoIva: 9500,
      montoTotal: 59500,
      eventoReceptor: 'ACD',
      eventoReceptorLeyenda: 'Aceptado',
    });
    expect(d.raw.ivaUsoComun).toBe(1234); // tax-special field preserved in raw
    // Detalle body adds the DTE type + the recaptcha sentinel (bundle-observed).
    expect(reqBody(s)).toMatchObject({
      codTipoDoc: '33',
      accionRecaptcha: 'RCV_DETC',
      tokenRecaptcha: 't-o-k-e-n-web',
    });
  });

  it('a generic non-JSON / network failure becomes RcvError', async () => {
    const s = session(() => {
      throw new Error('socket hang up');
    });
    await expect(
      fetchRcvDetalle(s, { rut: RUT, periodo: PERIODO, side: 'VENTA', codigoTipoDoc: '33' }),
    ).rejects.toBeInstanceOf(RcvError);
  });

  it('an expired session (seam SessionExpiredError) propagates verbatim — NOT wrapped', async () => {
    // The seam classifies the login-wall response as SessionExpiredError; the facade
    // must let it through so the user gets the actionable "re-login" message.
    const s = session(() => {
      throw new SessionExpiredError('La sesión expiró. Ejecuta `sii auth login`.');
    });
    await expect(
      fetchRcvResumen(s, { rut: RUT, periodo: PERIODO, side: 'COMPRA' }),
    ).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
