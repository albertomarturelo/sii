import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import { Rut } from '../rut/index.js';
import { Anio } from '../periodo/index.js';
import { F22Error, SessionExpiredError } from '../errors/index.js';
import {
  eventoDateKey,
  fetchF22Declaraciones,
  fetchF22Grid,
  fetchF22Historial,
  fetchF22Observaciones,
  groupCodigos,
  pickVigenteFolio,
} from './f22.js';
import type { CodigoF22 } from './f22.js';

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

  it('f22Compacto: curates tax códigos, EXCLUDES identity/bank PII (incl. 8809/9306/9920), sends folio', async () => {
    const s = session(() => ({
      metaData: {},
      data: [
        { codigo: '305', valor: '-150000', glosa: 'RESULTADO LIQUIDACIÓN ANUAL' },
        { codigo: '87', valor: '150000', glosa: 'Monto devolución solicitada' },
        { codigo: '110', valor: '3000000', glosa: 'Rentas honorarios art 42 N°2' }, // tax → kept
        { codigo: '3', valor: '77777777-7', glosa: 'RUT' }, // header PII → dropped
        { codigo: '55', valor: 'pii@example.cl', glosa: 'Email' }, // identity PII → dropped
        { codigo: '306', valor: '000999888', glosa: 'Número de Cuenta' }, // bank → dropped
        { codigo: '8809', valor: '777777777', glosa: '' }, // RUT-as-integer (MF3) → dropped
        { codigo: '9920', valor: 'CALLE FALSA 123', glosa: 'Dirección Origen' }, // address → dropped
      ],
    }));

    const codigos = await fetchF22Grid(s, { rut: RUT, anio: ANIO, folio: '12345' });

    expect(codigos.map((c) => c.codigo).sort()).toEqual(['110', '305', '87']);
    expect(codigos.find((c) => c.codigo === '305')?.valor).toBe(-150000); // sign preserved
    // No identity/bank PII reaches the curated grid — incl. the RUT-as-integer 8809.
    const dump = JSON.stringify(codigos);
    expect(dump).not.toContain('77777777-7');
    expect(dump).not.toContain('777777777'); // 8809's bare-integer RUT
    expect(dump).not.toContain('pii@example.cl');
    expect(dump).not.toContain('000999888');
    expect(dump).not.toContain('CALLE FALSA 123');
    expect(reqBody(s)).toMatchObject({ folio: '12345', periodo: '2025', rut: '77777777', dv: '7' });
  });

  it('f22Compacto: parses es-CL montos (dot=thousands) — millions and singles alike', async () => {
    // SII serves montos in Chilean format. Number() would make "9.999" → 9.999 and
    // "12.345.678" → NaN (two dots) → null → "—". The parser must strip thousands dots.
    // (Synthetic values — never a real declaration's montos.)
    const s = session(() => ({
      metaData: {},
      data: [
        { codigo: '1098', valor: '12.345.678', glosa: 'Sueldos' }, // millions (two dots) → 12345678
        { codigo: '90', valor: '9.999', glosa: 'Impuesto Adeudado' }, // thousands (one dot) → 9999
        { codigo: '305', valor: '-150.000', glosa: 'Resultado' }, // negative thousands
        { codigo: '87', valor: '1.234.567,50', glosa: 'Devolución' }, // decimal comma
        { codigo: '39', valor: '177', glosa: 'Reajuste' }, // plain integer, unchanged
      ],
    }));

    const codigos = await fetchF22Grid(s, { rut: RUT, anio: ANIO, folio: '12345' });
    const val = (c: string) => codigos.find((x) => x.codigo === c)?.valor;
    expect(val('1098')).toBe(12_345_678); // was NaN→null (shown as "—") before the fix
    expect(val('90')).toBe(9_999); // was 9.999 before the fix
    expect(val('305')).toBe(-150_000);
    expect(val('87')).toBe(1_234_567.5);
    expect(val('39')).toBe(177);
  });

  it('groupCodigos organizes into ingresos/deducciones/retenciones·créditos/resultado; unmapped non-PII → otros', () => {
    const codigos: CodigoF22[] = [
      { codigo: '110', valor: 3_000_000, glosa: 'Rentas honorarios' }, // ingreso
      { codigo: '547', valor: 3_000_000, glosa: 'Total Ingresos Brutos' }, // ingreso
      { codigo: '494', valor: 900_000, glosa: 'Gastos presuntos' }, // deducción
      { codigo: '900', valor: 200_000, glosa: 'Cotizaciones previsionales' }, // deducción
      { codigo: '198', valor: 300_000, glosa: 'Retenciones' }, // retención
      { codigo: '162', valor: 120_000, glosa: 'Crédito al IGC' }, // crédito
      { codigo: '305', valor: -150_000, glosa: 'Resultado' }, // resultado
      { codigo: '8865', valor: 1, glosa: 'Código Emisión' }, // unclassified non-PII → otros
    ];
    const g = groupCodigos(codigos);
    expect(g.ingresos.map((c) => c.codigo)).toEqual(['110', '547']);
    expect(g.deducciones.map((c) => c.codigo)).toEqual(['494', '900']);
    expect(g.creditos.map((c) => c.codigo)).toEqual(['198', '162']);
    expect(g.resultado.map((c) => c.codigo)).toEqual(['305']);
    expect(g.otros.map((c) => c.codigo)).toEqual(['8865']); // surfaced, not hidden
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
