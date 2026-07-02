import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../../adapters/fake/index.js';
import { Rut } from '../../rut/index.js';
import { Anio } from '../../periodo/index.js';
import { F22Error } from '../../errors/index.js';
import { fetchF22Observaciones } from './index.js';

// Synthetic data only (no real PII, no SII): operating 77.777.777-7, año 2025.
const RUT = Rut.parse('77777777-7');
const ANIO = Anio.parse('2025');

const session = (requestJson: (url: string, options?: unknown) => unknown): FakePortalSession =>
  new FakePortalSession({ requestJson, cookies: { TOKEN: 'conv' } });

const reqBody = (s: FakePortalSession): Record<string, unknown> =>
  (s.lastRequest?.options?.body as { data: Record<string, unknown> }).data;

describe('F22 observaciones facade (fake session, synthetic envelopes, no SII)', () => {
  it('situacionObservacion: curates codigo+descripcion+url, sends numeric periodo/folio', async () => {
    const s = session(() => ({
      data: [
        {
          codigo: 'B102',
          descripcion: 'Control ganancia de capital',
          url: 'http://www.sii.cl/B102.pdf',
        },
        {
          codigo: 'G37',
          descripcion: 'Control de retiros y dividendos',
          url: 'http://www.sii.cl/G37.pdf',
        },
      ],
      respCod: null,
      errorMsg: null,
      metaData: { errors: null },
    }));

    const obs = await fetchF22Observaciones(s, { rut: RUT, anio: ANIO, folio: '123456789' });

    expect(obs.map((o) => o.codigo)).toEqual(['B102', 'G37']);
    expect(obs[0]).toEqual({
      codigo: 'B102',
      descripcion: 'Control ganancia de capital',
      url: 'http://www.sii.cl/B102.pdf',
    });
    // periodo + folio go out as NUMBERS (observed 2026-06-29); split RUT. (Synthetic folio.)
    expect(reqBody(s)).toMatchObject({ periodo: 2025, rut: '77777777', dv: '7', folio: 123456789 });
  });

  it('situacionObservacion: empty data is "sin observaciones", not an error', async () => {
    const s = session(() => ({ data: [], respCod: null, errorMsg: null, metaData: {} }));
    expect(await fetchF22Observaciones(s, { rut: RUT, anio: ANIO, folio: '1' })).toEqual([]);
  });

  it('situacionObservacion: a top-level errorMsg is surfaced verbatim as F22Error', async () => {
    const s = session(() => ({
      data: null,
      errorMsg: 'Folio no corresponde al contribuyente',
      metaData: { errors: null },
    }));
    await expect(fetchF22Observaciones(s, { rut: RUT, anio: ANIO, folio: '1' })).rejects.toThrow(
      'Folio no corresponde al contribuyente',
    );
    await expect(
      fetchF22Observaciones(s, { rut: RUT, anio: ANIO, folio: '1' }),
    ).rejects.toBeInstanceOf(F22Error);
  });
});
