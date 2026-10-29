import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import { HOSTS } from '../config/index.js';
import { BienesRaicesError, NetworkError, SessionExpiredError } from '../errors/index.js';
import type { FormRequest } from '../seams/index.js';
import { fechaVencimientoIso, fetchPredios, montoPesos } from './bienes-raices-misii.js';

// Synthetic data only (no SII, no real PII): an invented RUT, comuna, address and owner.
// The row shape is the one observed 2026-10-28 (sii-contract/bienes-raices.md); the cuota
// fields are the ones SII's own client reads (`getCuotas`), with invented values.
const PREDIO_A = {
  descripcionComuna: 'COMUNA SINTETICA',
  comuna: 99001,
  manzana: 123,
  predio: 45,
  comunaCNP: 99001,
  manzanaCNP: 123,
  predioCNP: 45,
  direccion: 'CALLE FALSA 123',
  nombrePropietario: 'PROPIETARIO SINTETICO',
  destino: 'HABITACIONAL',
  propietario: true,
  pac: false,
  indExistencia: 'S',
  agnoVigDesde: 2020,
  semestreVigDesde: 1,
  indHistorial: 0,
  indBcovid: 0,
  cuotas: {
    'k-1': {
      condicion: 'VENCIDA',
      fechaVencimiento: '30-06-2026',
      agno: 2026,
      semestre: 1,
      cuota: 2,
      totalPago: 45678,
    },
    'k-2': {
      condicion: 'VIGENTE',
      fechaVencimiento: '2026-11-30',
      agno: 2026,
      semestre: 2,
      cuota: 4,
      totalPago: '$ 41.234',
    },
  },
  rol: '123-45',
};
const PREDIO_B = {
  ...PREDIO_A,
  descripcionComuna: 'OTRA COMUNA',
  comuna: 99002,
  manzana: 7,
  predio: 8,
  direccion: 'PASAJE INVENTADO 9',
  destino: 'COMERCIO',
  propietario: false,
  cuotas: {},
  rol: '7-8',
};
const ok = (data: unknown) =>
  JSON.stringify({
    data,
    metaData: {
      conversationId: 'X',
      transactionId: 'Y',
      namespace:
        'cl.sii.sdi.lob.bbrr.serviciosecontribuciones.data.impl.PropiedadesApplicationService/getPropiedades',
      info: null,
      errors: null,
      page: null,
      sorts: null,
    },
  });

function session(body: string | (() => string)) {
  const calls: { url: string; options?: FormRequest }[] = [];
  const s = new FakePortalSession({
    requestForm: (url, options) => {
      calls.push({ url, ...(options ? { options } : {}) });
      return typeof body === 'function' ? body() : body;
    },
  });
  return { s, calls };
}

describe('fetchPredios (Mi SII opc=34; fakes, synthetic data)', () => {
  it("POSTs SII's own form to CViewCarta.cgi and curates each predio", async () => {
    const { s, calls } = session(ok({ '20000042-123-45': PREDIO_A, '20000042-7-8': PREDIO_B }));
    const predios = await fetchPredios(s);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(HOSTS.miSiiCarta);
    expect(calls[0]?.options?.form).toMatchObject({ opc: '34', VIEW: '1' });
    expect(predios).toHaveLength(2);
    expect(predios[0]).toEqual({
      rol: '123-45',
      comuna: { codigo: 99001, nombre: 'COMUNA SINTETICA' },
      manzana: 123,
      predio: 45,
      direccion: 'CALLE FALSA 123',
      destino: 'HABITACIONAL',
      propietario: true,
      cuotas: [
        {
          anio: 2026,
          semestre: 1,
          cuota: 2,
          condicion: 'VENCIDA',
          vencida: true,
          fechaVencimiento: '2026-06-30',
          totalPago: 45678,
        },
        {
          anio: 2026,
          semestre: 2,
          cuota: 4,
          condicion: 'VIGENTE',
          vencida: false,
          fechaVencimiento: '2026-11-30',
          totalPago: 41234,
        },
      ],
      cuotasVencidas: 1,
      cuotasVigentes: 1,
    });
    expect(predios[1]).toMatchObject({ rol: '7-8', propietario: false, cuotas: [] });
  });

  it("drops the owner's name, the map keys and the unobserved fields (no raw)", async () => {
    const { s } = session(ok({ '20000042-123-45': PREDIO_A }));
    const json = JSON.stringify(await fetchPredios(s));
    expect(json).not.toContain('PROPIETARIO SINTETICO');
    expect(json).not.toContain('20000042');
    expect(json).not.toContain('k-1');
    for (const k of ['raw', 'pac', 'indExistencia', 'comunaCNP', 'agnoVigDesde']) {
      expect(json).not.toContain(`"${k}"`);
    }
  });

  it('reads data null and {} as "no predios"', async () => {
    expect(await fetchPredios(session(ok(null)).s)).toEqual([]);
    expect(await fetchPredios(session(ok({})).s)).toEqual([]);
  });

  it("reads SII's missing-session answer as SessionExpiredError, never as no predios", async () => {
    // Observed 2026-10-28: a POST without session cookies answers 200 with this body.
    const { s } = session('{"codigoResp":-2, "glosaRespuesta":"Error: Autenticacion"}');
    const err = await fetchPredios(s).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionExpiredError);
    expect((err as Error).message).toContain('Error: Autenticacion');
  });

  it("surfaces SII's other codigoResp and metaData.errors verbatim", async () => {
    await expect(
      fetchPredios(session('{"codigoResp":-9,"glosaRespuesta":"Servicio no disponible"}').s),
    ).rejects.toThrow(new BienesRaicesError('Servicio no disponible'));
    const errors = JSON.stringify({
      data: null,
      metaData: { errors: [{ descripcion: 'Error sintético del SII' }] },
    });
    await expect(fetchPredios(session(errors).s)).rejects.toThrow('Error sintético del SII');
  });

  it('fails loud ("scraper roto") on a body that is not the observed shape', async () => {
    await expect(fetchPredios(session('<html>Mi SII</html>').s)).rejects.toThrow(
      /Scraper roto.*no respondió JSON/,
    );
    await expect(fetchPredios(session('{"otra":"cosa"}').s)).rejects.toThrow(
      /Scraper roto.*ni `metaData`/,
    );
    await expect(fetchPredios(session('[1,2]').s)).rejects.toThrow(/Scraper roto/);
    const sinRol = ok({ x: { ...PREDIO_A, comuna: 'no-numero' } });
    await expect(fetchPredios(session(sinRol).s)).rejects.toThrow(
      /Scraper roto.*comuna, manzana y predio/,
    );
  });

  it('lets a dead session and a network failure through unchanged', async () => {
    const dead = session(() => {
      throw new SessionExpiredError('Sesión expirada (sintético).');
    });
    await expect(fetchPredios(dead.s)).rejects.toBeInstanceOf(SessionExpiredError);
    const net = session(() => {
      throw new NetworkError('sin red (sintético)', { host: 'misiir.sii.cl', causa: 'ECONNRESET' });
    });
    await expect(fetchPredios(net.s)).rejects.toBeInstanceOf(NetworkError);
  });

  it('reads an unexpected cuota shape as null, never as a guess', async () => {
    const raro = {
      ...PREDIO_A,
      cuotas: { k: { condicion: 'vencida ', fechaVencimiento: '31-02-2026', totalPago: 'n/d' } },
    };
    const [p] = await fetchPredios(session(ok({ x: raro })).s);
    expect(p?.cuotas).toEqual([
      {
        anio: null,
        semestre: null,
        cuota: null,
        condicion: 'vencida',
        vencida: true,
        fechaVencimiento: null,
        totalPago: null,
      },
    ]);
  });
});

describe('fechaVencimientoIso — the two formats SII’s dateOrderKey accepts', () => {
  it.each([
    ['2026-11-30', '2026-11-30'],
    ['2026-11-30 00:00:00.0', '2026-11-30'],
    ['30-11-2026', '2026-11-30'],
    ['1/4/2026', '2026-04-01'],
    ['30/04/2026', '2026-04-30'],
  ])('%s ⇒ %s', (input, out) => expect(fechaVencimientoIso(input)).toBe(out));

  it.each([['31-02-2026'], ['2026/11/30'], ['nov 2026'], [''], [null], [20261130]])(
    '%s ⇒ null',
    (input) => expect(fechaVencimientoIso(input)).toBeNull(),
  );
});

describe('montoPesos — a number, or an es-CL amount string', () => {
  it.each([
    [45678, 45678],
    ['45678', 45678],
    ['45.678', 45678],
    ['$ 1.234.567', 1234567],
    ['$12.345', 12345],
    ['12,5', 12.5],
  ])('%s ⇒ %s', (input, out) => expect(montoPesos(input)).toBe(out));

  it.each([['n/d'], ['1.23'], [''], [null], [Number.NaN]])('%s ⇒ null', (input) =>
    expect(montoPesos(input)).toBeNull(),
  );
});
