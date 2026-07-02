import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../../adapters/fake/index.js';
import { Rut } from '../../rut/index.js';
import { Anio } from '../../periodo/index.js';
import { F22Error } from '../../errors/index.js';
import { eventoDateKey, fetchF22Historial } from './index.js';

// Synthetic data only (no real PII, no SII): operating 77.777.777-7, año 2025.
const RUT = Rut.parse('77777777-7');
const ANIO = Anio.parse('2025');

const session = (requestJson: (url: string, options?: unknown) => unknown): FakePortalSession =>
  new FakePortalSession({ requestJson, cookies: { TOKEN: 'conv' } });

const reqBody = (s: FakePortalSession): Record<string, unknown> =>
  (s.lastRequest?.options?.body as { data: Record<string, unknown> }).data;

describe('F22 historial facade (fake session, synthetic envelopes, no SII)', () => {
  it('buscaEventos: curates the event fields, uses codEvento (not the row codigo), sends string folio', async () => {
    const s = session(() => ({
      data: [
        {
          folio: '12345',
          codEvento: '48',
          codigo: '0000000001', // unrelated internal id — must NOT win over codEvento
          nombre: 'Declaración recibida, solicita Devolución por $9.999.',
          fechaEvento: '08/04/2025',
          tipoEvento: '0',
          codCarta: '000483',
          idCarta: null,
          referencia: '000483 000000000009999            ', // space-padded → trimmed
          fechaCitacion: '', // blank → null
          unidadSii: '', // blank → null
        },
      ],
      respCod: 0,
      errorMsg: null,
      metaData: { errors: null },
    }));

    const evs = await fetchF22Historial(s, { rut: RUT, anio: ANIO, folio: '12345' });

    expect(evs).toHaveLength(1);
    expect(evs[0]).toEqual({
      folio: '12345',
      codigo: '48', // codEvento, not the row's own `codigo`
      glosa: 'Declaración recibida, solicita Devolución por $9.999.', // verbatim, monto inline
      fecha: '08/04/2025',
      tipo: '0',
      codCarta: '000483', // leading zeros preserved
      idCarta: null,
      referencia: '000483 000000000009999', // trimmed
      fechaCitacion: null, // blank → null
      unidadSii: null,
    });
    // Folio REQUIRED; all params strings (like buscaDeclVgte), split RUT. (Synthetic folio.)
    expect(reqBody(s)).toMatchObject({ periodo: '2025', rut: '77777777', dv: '7', folio: '12345' });
  });

  it('buscaEventos: empty / non-array data is "sin eventos", not an error', async () => {
    const empty = session(() => ({ data: [], respCod: 0, errorMsg: null, metaData: {} }));
    expect(await fetchF22Historial(empty, { rut: RUT, anio: ANIO, folio: '1' })).toEqual([]);
    const nullish = session(() => ({ data: null, respCod: 0, errorMsg: null, metaData: {} }));
    expect(await fetchF22Historial(nullish, { rut: RUT, anio: ANIO, folio: '1' })).toEqual([]);
  });

  it('buscaEventos: a top-level errorMsg is surfaced verbatim as F22Error', async () => {
    const s = session(() => ({
      data: null,
      errorMsg: 'RESTEASY001130: Error status 500 Internal Server Error returned',
      metaData: { errors: null },
    }));
    await expect(fetchF22Historial(s, { rut: RUT, anio: ANIO, folio: '1' })).rejects.toBeInstanceOf(
      F22Error,
    );
  });

  it('eventoDateKey orders DD/MM/YYYY descending; undated/unparseable sink to the bottom', () => {
    expect(eventoDateKey('25/04/2025')).toBeGreaterThan(eventoDateKey('08/04/2025'));
    expect(eventoDateKey('08/04/2025')).toBeGreaterThan(eventoDateKey('31/12/2024'));
    expect(eventoDateKey(null)).toBe(Number.NEGATIVE_INFINITY);
    expect(eventoDateKey('not-a-date')).toBe(Number.NEGATIVE_INFINITY);
  });
});
