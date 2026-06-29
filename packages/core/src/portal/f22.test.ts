import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import { Rut } from '../rut/index.js';
import { Anio } from '../periodo/index.js';
import { F22Error, SessionExpiredError } from '../errors/index.js';
import {
  fetchF22Declaraciones,
  fetchF22Grid,
  fetchF22Observaciones,
  pickVigenteFolio,
} from './f22.js';

// Synthetic data only (no real PII, no SII): operating 77.777.777-7, año 2025.
const RUT = Rut.parse('77777777-7');
const ANIO = Anio.parse('2025');

const session = (requestJson: (url: string, options?: unknown) => unknown): FakePortalSession =>
  new FakePortalSession({ requestJson, cookies: { TOKEN: 'conv' } });

const reqBody = (s: FakePortalSession): Record<string, unknown> =>
  (s.lastRequest?.options?.body as { data: Record<string, unknown> }).data;

describe('F22 facade (fake session, synthetic envelopes, no SII)', () => {
  it('buscaDeclVgte: parses decls + resolves estado via glosas; sends año + split RUT', async () => {
    const s = session(() => ({
      metaData: { errors: [] },
      data: {
        decls: [
          {
            folio: '12345',
            vgte: 'S',
            codConc: 'C1',
            fecIng: '15/04/2025',
            nombres: 'PII NAME', // identity PII — must NOT surface
            cta: '00012345', // bank PII — must NOT surface
          },
        ],
        glosas: [{ codConclusion: 'C1', descripcion: 'Declaración vigente — aceptada' }],
      },
    }));

    const res = await fetchF22Declaraciones(s, { rut: RUT, anio: ANIO });

    expect(res).toMatchObject({ rut: '77777777-7', anio: '2025', tieneDeclaracion: true });
    expect(res.declaraciones[0]).toEqual({
      folio: '12345',
      vigente: true,
      estado: 'Declaración vigente — aceptada',
      fecha: '15/04/2025',
      tipoImpugnado: null,
    });
    // No `raw` → the decl's identity/bank PII never rides along.
    expect(JSON.stringify(res)).not.toContain('PII NAME');
    expect(JSON.stringify(res)).not.toContain('00012345');
    // Body: periodo = año tributario (YYYY), split RUT.
    expect(reqBody(s)).toMatchObject({ periodo: '2025', rut: '77777777', dv: '7' });
  });

  it('buscaDeclVgte: no decls is a legitimate "sin declaración", not an error', async () => {
    const s = session(() => ({ metaData: {}, data: { decls: null } }));
    const res = await fetchF22Declaraciones(s, { rut: RUT, anio: ANIO });
    expect(res.tieneDeclaracion).toBe(false);
    expect(res.declaraciones).toEqual([]);
  });

  it('metaData.errors (list of {descripcion}) is surfaced verbatim as F22Error', async () => {
    const s = session(() => ({
      metaData: { errors: [{ id: 9, descripcion: 'RUT no autorizado para el año' }] },
      data: null,
    }));
    await expect(fetchF22Declaraciones(s, { rut: RUT, anio: ANIO })).rejects.toThrow(
      'RUT no autorizado para el año',
    );
    await expect(fetchF22Declaraciones(s, { rut: RUT, anio: ANIO })).rejects.toBeInstanceOf(
      F22Error,
    );
  });

  it('f22Compacto: curates tax códigos, EXCLUDES header/identity/bank códigos, sends folio', async () => {
    const s = session(() => ({
      metaData: {},
      data: [
        { codigo: '305', valor: '-150000', glosa: 'RESULTADO LIQUIDACIÓN ANUAL' },
        { codigo: '87', valor: '150000', glosa: 'Monto devolución solicitada' },
        { codigo: '3', valor: '77777777-7', glosa: 'RUT' }, // header PII → dropped
        { codigo: '55', valor: 'pii@example.cl', glosa: 'Email' }, // identity PII → dropped
        { codigo: '306', valor: '000999888', glosa: 'Número de Cuenta' }, // bank → dropped
      ],
    }));

    const codigos = await fetchF22Grid(s, { rut: RUT, anio: ANIO, folio: '12345' });

    expect(codigos.map((c) => c.codigo).sort()).toEqual(['305', '87']);
    expect(codigos.find((c) => c.codigo === '305')?.valor).toBe(-150000); // sign preserved
    // PII códigos never reach the curated grid.
    const dump = JSON.stringify(codigos);
    expect(dump).not.toContain('77777777-7');
    expect(dump).not.toContain('pii@example.cl');
    expect(dump).not.toContain('000999888');
    expect(reqBody(s)).toMatchObject({ folio: '12345', periodo: '2025', rut: '77777777', dv: '7' });
  });

  it('pickVigenteFolio prefers the vigente declaración, else the first with a folio', () => {
    expect(
      pickVigenteFolio([
        { folio: '1', vigente: false, estado: null, fecha: null, tipoImpugnado: null },
        { folio: '2', vigente: true, estado: null, fecha: null, tipoImpugnado: null },
      ]),
    ).toBe('2');
    expect(
      pickVigenteFolio([
        { folio: '1', vigente: false, estado: null, fecha: null, tipoImpugnado: null },
      ]),
    ).toBe('1');
    expect(pickVigenteFolio([])).toBeNull();
  });

  it('an expired session (SessionExpiredError) propagates; a generic non-JSON → F22Error', async () => {
    const expired = session(() => {
      throw new SessionExpiredError('La sesión expiró. Ejecuta `sii auth login`.');
    });
    await expect(fetchF22Declaraciones(expired, { rut: RUT, anio: ANIO })).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    const broken = session(() => {
      throw new Error('socket hang up');
    });
    await expect(fetchF22Declaraciones(broken, { rut: RUT, anio: ANIO })).rejects.toBeInstanceOf(
      F22Error,
    );
  });

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

    const obs = await fetchF22Observaciones(s, { rut: RUT, anio: ANIO, folio: '311429396' });

    expect(obs.map((o) => o.codigo)).toEqual(['B102', 'G37']);
    expect(obs[0]).toEqual({
      codigo: 'B102',
      descripcion: 'Control ganancia de capital',
      url: 'http://www.sii.cl/B102.pdf',
    });
    // periodo + folio go out as NUMBERS (observed 2026-06-29); split RUT.
    expect(reqBody(s)).toMatchObject({ periodo: 2025, rut: '77777777', dv: '7', folio: 311429396 });
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
