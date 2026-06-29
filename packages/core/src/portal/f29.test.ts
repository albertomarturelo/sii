import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import { Rut } from '../rut/index.js';
import { Periodo } from '../periodo/index.js';
import { F29Error, SessionExpiredError } from '../errors/index.js';
import { fetchF29Estado, fetchF29Propuesta } from './f29.js';

// Synthetic data only (no real PII, no SII): operating 77.777.777-7, período 2026-05.
const RUT = Rut.parse('77777777-7');
const PERIODO = Periodo.parse('2026-05');

const session = (requestJson: (url: string, options?: unknown) => unknown): FakePortalSession =>
  new FakePortalSession({ requestJson, cookies: { TOKEN: 'conv' } });

const reqBody = (s: FakePortalSession): Record<string, unknown> =>
  (s.lastRequest?.options?.body as { data: Record<string, unknown> }).data;

describe('F29 facade (fake session, synthetic envelopes, no SII)', () => {
  it('propuesta: curates the tax códigos (propuestos + administrativos), DROPS identity/financial PII, sends rutContribuyente/formCodigo/mes/anno', async () => {
    const s = session(() => ({
      metaData: { errors: null },
      data: {
        tipopropuesta: 40,
        estado: 0,
        descripcionEstado: null,
        listCodPropuestos: [
          { codigo: '511', valor: '1097' },
          { codigo: '520', valor: '7482' },
          { codigo: '115', valor: '0.125' }, // PPM tasa — a float, must survive
        ],
        listCodAdministrativos: [{ codigo: '9114', valor: '1097' }],
        // Identity PII (a SEPARATE array) — must NOT surface.
        listCodBase: [
          { codigo: '03', valor: '77777777-7' }, // RUT
          { codigo: '05', valor: 'PII NAME' }, // nombres
          { codigo: '06', valor: 'CALLE FALSA 123' }, // dirección
        ],
        // The PP29 calc traza EMBEDS the RUT — must NOT surface.
        resultadoCalculoPP29: { estado: 3, traza: 'RUT[77777777] Periodo[202605]' },
      },
    }));

    const res = await fetchF29Propuesta(s, { rut: RUT, periodo: PERIODO });

    expect(res).toMatchObject({
      rut: '77777777-7',
      periodo: '2026-05',
      tienePropuesta: true,
      tipoPropuesta: 40,
      estado: 0,
    });
    expect(res.codigos).toEqual([
      { codigo: '511', valor: 1097 },
      { codigo: '520', valor: 7482 },
      { codigo: '115', valor: 0.125 }, // float preserved (int-only coercion would drop it to null)
    ]);
    expect(res.codigosAdministrativos).toEqual([{ codigo: '9114', valor: 1097 }]);
    // No raw → none of the identity/financial PII rides along.
    const dump = JSON.stringify(res);
    expect(dump).not.toContain('PII NAME');
    expect(dump).not.toContain('CALLE FALSA 123');
    expect(dump).not.toContain('77777777]'); // the traza's bare-integer RUT
    // Body: propuesta uses rutContribuyente + formCodigo + split mes/anno.
    expect(reqBody(s)).toMatchObject({
      rutContribuyente: '77777777',
      dv: '7',
      formCodigo: '2',
      mes: '05',
      anno: '2026',
    });
  });

  it('propuesta: data:null (no errors) is a legitimate "sin propuesta", not an error', async () => {
    const s = session(() => ({ metaData: { errors: null }, data: null }));
    const res = await fetchF29Propuesta(s, { rut: RUT, periodo: PERIODO });
    expect(res).toMatchObject({ tienePropuesta: false, codigos: [], codigosAdministrativos: [] });
    expect(res.tipoPropuesta).toBeNull();
  });

  it('propuesta: metaData.errors (list of {descripcion}) surfaces verbatim as F29Error', async () => {
    const s = session(() => ({
      metaData: { errors: [{ id: '0', descripcion: 'Consulta RUT no esta autorizado' }] },
      data: null,
    }));
    await expect(fetchF29Propuesta(s, { rut: RUT, periodo: PERIODO })).rejects.toThrow(
      'Consulta RUT no esta autorizado',
    );
    await expect(fetchF29Propuesta(s, { rut: RUT, periodo: PERIODO })).rejects.toBeInstanceOf(
      F29Error,
    );
  });

  it('estado: curates the declaración records, DROPS monto (financial PII), sends rut/formId/mes/anno', async () => {
    const s = session(() => ({
      metaData: { errors: null },
      data: [
        {
          estadoDeclaracionId: 1,
          estado: 'Vigente',
          folio: 7654321,
          declFechaCreacion: '12/06/2026',
          monto: 999999, // financial position — must NOT surface
          enNegocio: false,
          codigo: 0,
        },
        {
          estadoDeclaracionId: 10,
          estado: 'Guardada',
          folio: 0,
          declFechaCreacion: '11/06/2026',
          monto: 0,
          enNegocio: false,
          codigo: 0,
        },
      ],
    }));

    const res = await fetchF29Estado(s, { rut: RUT, periodo: PERIODO });

    expect(res).toMatchObject({ rut: '77777777-7', periodo: '2026-05', tieneDeclaracion: true });
    expect(res.declaraciones).toEqual([
      {
        estadoId: 1,
        estado: 'Vigente',
        folio: 7654321,
        fecha: '12/06/2026',
        enNegocio: false,
        codigo: 0,
      },
      {
        estadoId: 10,
        estado: 'Guardada',
        folio: 0,
        fecha: '11/06/2026',
        enNegocio: false,
        codigo: 0,
      },
    ]);
    expect(JSON.stringify(res)).not.toContain('999999'); // monto never surfaces
    // Body: estado uses rut + formId (NOT rutContribuyente/formCodigo — SII's naming quirk).
    expect(reqBody(s)).toMatchObject({
      rut: '77777777',
      dv: '7',
      formId: '2',
      mes: '05',
      anno: '2026',
    });
  });

  it('estado: empty data:[] is "nada presentado", not an error', async () => {
    const s = session(() => ({ metaData: { errors: null }, data: [] }));
    const res = await fetchF29Estado(s, { rut: RUT, periodo: PERIODO });
    expect(res.tieneDeclaracion).toBe(false);
    expect(res.declaraciones).toEqual([]);
  });

  it('an expired session (SessionExpiredError) propagates; a generic non-JSON → F29Error', async () => {
    const expired = session(() => {
      throw new SessionExpiredError('La sesión expiró. Ejecuta `sii auth login`.');
    });
    await expect(fetchF29Propuesta(expired, { rut: RUT, periodo: PERIODO })).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    const broken = session(() => {
      throw new Error('socket hang up');
    });
    await expect(fetchF29Estado(broken, { rut: RUT, periodo: PERIODO })).rejects.toBeInstanceOf(
      F29Error,
    );
  });
});
