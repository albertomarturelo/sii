import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import { Rut } from '../rut/index.js';
import { Periodo } from '../periodo/index.js';
import { F29Error, SessionExpiredError } from '../errors/index.js';
import { fetchF29Estado, fetchF29Propuesta, iniciarFlujoPropuestaF29 } from './f29.js';

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

  it('propuesta: a non-null data with empty / all-zero códigos is "sin propuesta" (tienePropuesta false)', async () => {
    // SII returns a propuesta object for a período it has nothing for: empty or zero-placeholder
    // códigos. tienePropuesta must be false (else the surface shows an empty form as "hay propuesta").
    const empty = session(() => ({
      metaData: { errors: null },
      data: { tipopropuesta: 40, listCodPropuestos: [] },
    }));
    expect((await fetchF29Propuesta(empty, { rut: RUT, periodo: PERIODO })).tienePropuesta).toBe(
      false,
    );
    const allZero = session(() => ({
      metaData: { errors: null },
      data: {
        tipopropuesta: 40,
        listCodPropuestos: [
          { codigo: '538', valor: '0' },
          { codigo: '91', valor: 0 },
        ],
      },
    }));
    expect((await fetchF29Propuesta(allZero, { rut: RUT, periodo: PERIODO })).tienePropuesta).toBe(
      false,
    );
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

  it('estado: curates the declaración records (total surfaced), sends rut/formId/mes/anno', async () => {
    const s = session(() => ({
      metaData: { errors: null },
      data: [
        {
          estadoDeclaracionId: 1,
          estado: 'Vigente',
          folio: 7654321,
          declFechaCreacion: '12/06/2026',
          monto: 880000, // declared total a pagar → surfaced as `total` (synthetic)
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
        total: 880000, // monto → total (the declaración's total a pagar)
        enNegocio: false,
        codigo: 0,
      },
      {
        estadoId: 10,
        estado: 'Guardada',
        folio: 0,
        fecha: '11/06/2026',
        total: 0,
        enNegocio: false,
        codigo: 0,
      },
    ]);
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

describe('F29 propuesta handoff (the submit, #161; synthetic, no SII)', () => {
  const RFI = 'https://www4.sii.cl/rfiInternet?origen=PROPUESTA&accionPpta=PPTA-F29-COMPLETA';
  function handoff(over: Partial<Record<'guardarPropuesta' | 'enviarDatosFlujo', unknown>> = {}) {
    const sent: { url: string; body: { metaData: { namespace: string }; data: unknown } }[] = [];
    const s = new FakePortalSession({
      cookies: { TOKEN: 'conv' },
      requestJson: (url, options) => {
        sent.push({ url, body: options?.body as (typeof sent)[number]['body'] });
        if (url.endsWith('/guardarPropuesta'))
          return over.guardarPropuesta ?? { metaData: { errors: null }, data: 7 };
        return over.enviarDatosFlujo ?? { metaData: { errors: null }, data: RFI, tipoFlujo: '1' };
      },
    });
    return { s, sent };
  }

  it('saves the propuesta, hands the flow over, and returns the form URL SII answered', async () => {
    const { s, sent } = handoff();
    await expect(iniciarFlujoPropuestaF29(s, { rut: RUT, periodo: PERIODO })).resolves.toBe(RFI);
    expect(sent.map((r) => r.url)).toEqual([
      'https://www4.sii.cl/propuestaf29ui/services/data/facadeService/guardarPropuesta',
      'https://www4.sii.cl/propuestaf29ui/services/data/facadeService/enviarDatosFlujo',
    ]);
    expect(sent[0]!.body.metaData.namespace).toBe(
      'cl.sii.sdi.lob.iva.propuestaf29.data.api.interfaces.FacadeService/guardarPropuesta',
    );
    expect(sent[0]!.body.data).toEqual({
      rutCntr: '77777777',
      dvCntr: '7',
      formCodigo: '29',
      tipoPropuestaInicial: 40,
      periodo: { anno: '2026', mes: '05' },
    });
    expect(sent[1]!.body.data).toEqual({
      rut: '77777777',
      dv: '7',
      periodo: '202605',
      form: '29',
      tipo: 40,
    });
  });

  it("surfaces SII's message with the client's code for the step that failed", async () => {
    const err = { metaData: { errors: [{ descripcion: 'Servicio no disponible' }] }, data: null };
    const a = handoff({ guardarPropuesta: err });
    await expect(iniciarFlujoPropuestaF29(a.s, { rut: RUT, periodo: PERIODO })).rejects.toThrow(
      'Servicio no disponible [mod-gdrpro-rfi3]',
    );
    expect(a.sent).toHaveLength(1);
    const b = handoff({ enviarDatosFlujo: err });
    await expect(iniciarFlujoPropuestaF29(b.s, { rut: RUT, periodo: PERIODO })).rejects.toThrow(
      'Servicio no disponible [mod-envdf-rfi3]',
    );
  });

  it('follows the handoff only into the form app on SII', async () => {
    const { s } = handoff({
      enviarDatosFlujo: { metaData: { errors: null }, data: 'https://example.com/rfiInternet' },
    });
    await expect(iniciarFlujoPropuestaF29(s, { rut: RUT, periodo: PERIODO })).rejects.toThrow(
      F29Error,
    );
  });

  it('a dead session is session_expired, not an F29 error', async () => {
    const s = new FakePortalSession({
      cookies: { TOKEN: 'conv' },
      requestJson: () => {
        throw new SessionExpiredError('Sesión expirada');
      },
    });
    await expect(iniciarFlujoPropuestaF29(s, { rut: RUT, periodo: PERIODO })).rejects.toThrow(
      SessionExpiredError,
    );
  });
});
