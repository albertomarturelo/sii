import { describe, it, expect } from 'vitest';
import {
  HOSTS,
  NotAuthenticatedError,
  ValidationError,
  testing,
  type Runtime,
} from '@albertomarturelo/sii-core';
import { datos, run, runJson, seed } from '../test-helpers.js';

describe('sii f22 command (fake runtime, no SII)', () => {
  const BUSCA = {
    metaData: { errors: [] },
    data: {
      decls: [{ folio: '999', vgte: 'S', codConc: 'C1', fecIng: '15/04/2025' }],
      glosas: [{ codConclusion: 'C1', descripcion: 'Vigente' }],
    },
  };
  // f22Compacto grid (the source for both `status` and `formulario`): one código per group
  // + a non-PII unclassified código (→ otros) + an identity PII código that must be dropped.
  const GRID = {
    metaData: {},
    data: [
      { codigo: '110', valor: '3000000', glosa: 'Rentas honorarios' }, // ingreso
      { codigo: '494', valor: '900000', glosa: 'Gastos presuntos' }, // deducción
      { codigo: '198', valor: '300000', glosa: 'Retenciones' }, // retención
      { codigo: '305', valor: '-100', glosa: 'Resultado liquidación' }, // resultado
      { codigo: '8865', valor: '1', glosa: 'Código Emisión' }, // non-PII unclassified → otros
      { codigo: '3', valor: '11111111-1', glosa: 'RUT' }, // identity PII → excluded
    ],
  };
  const OBS = {
    data: [
      {
        codigo: 'B102',
        descripcion: 'Control ganancia de capital',
        url: 'http://www.sii.cl/B102.pdf',
      },
    ],
    respCod: null,
    errorMsg: null,
    metaData: { errors: null },
  };
  const EVENTOS = {
    data: [
      {
        folio: '999',
        codEvento: '48',
        nombre: 'Declaración recibida, solicita Devolución.',
        fechaEvento: '08/04/2025',
        tipoEvento: '0',
      },
      {
        folio: '999',
        codEvento: '2',
        nombre: 'Su devolución solicitada fue autorizada.',
        fechaEvento: '16/04/2025',
        tipoEvento: '0',
      },
    ],
    respCod: 0,
    errorMsg: null,
    metaData: { errors: null },
  };
  function makeF22Runtime(): Runtime {
    return {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          cookies: { TOKEN: 't' },
          requestJson: (url) =>
            url.includes('buscaDeclVgte')
              ? BUSCA
              : url.includes('f22Compacto')
                ? GRID
                : url.includes('situacionObservacion')
                  ? OBS
                  : url.includes('buscaEventos')
                    ? EVENTOS
                    : { metaData: {}, data: null },
        },
      }),
    };
  }

  it('f22 status <año> shows folio/estado + only the curated (non-PII) códigos', async () => {
    const rt = makeF22Runtime();
    await seed(rt);
    const out = await run(rt, 'f22', 'status', '2025');
    expect(out).toContain('F22 2025');
    expect(out).toContain('Estado: Vigente');
    expect(out).toContain('305');
    expect(out).toContain('5 código(s).'); // 110/494/198/305/8865; header '3' (RUT) excluded
    expect(out).not.toContain('11111111-1'); // the excluded PII código's value never prints
  });

  it('f22 status (no year) shows the multi-year estado overview', async () => {
    const rt = makeF22Runtime();
    await seed(rt);
    const out = await run(rt, 'f22', 'status', '--years', '3');
    expect(out).toContain('estado por año');
    expect(out).toContain('2026  Vigente');
    expect(out).toContain('2024  Vigente');
  });

  it('f22 formulario <año> prints the complete form grouped (ingresos/deducciones/retenciones/resultado/otros)', async () => {
    const rt = makeF22Runtime();
    await seed(rt);
    const out = await run(rt, 'f22', 'formulario', '2025');
    expect(out).toContain('(formulario)');
    expect(out).toContain('Ingresos:');
    expect(out).toContain('110'); // honorarios
    expect(out).toContain('Deducciones:');
    expect(out).toContain('494'); // gastos presuntos
    expect(out).toContain('Retenciones · PPM · Créditos:');
    expect(out).toContain('198'); // retenciones
    expect(out).toContain('Cálculo (subtotales IGC/IUSC):'); // intermediate IGC steps, split from resultado
    expect(out).toContain('Resultado:');
    expect(out).toContain('305');
    expect(out).toContain('Otros:'); // non-PII unclassified still shown
    expect(out).toContain('8865');
    expect(out).toContain('5 código(s).'); // 110/494/198/305/8865; header '3' (RUT) excluded
    expect(out).not.toContain('11111111-1'); // PII value never prints
  });

  it('f22 formulario requires the año argument', async () => {
    // The año is a required positional; commander rejects its absence.
    await expect(run(makeF22Runtime(), 'f22', 'formulario')).rejects.toThrow();
  });

  it('f22 status no longer accepts --full (it moved to `formulario`)', async () => {
    await expect(run(makeF22Runtime(), 'f22', 'status', '2025', '--full')).rejects.toThrow();
  });

  it('f22 status requires a session (NotAuthenticated)', async () => {
    await expect(run(makeF22Runtime(), 'f22', 'status', '2025')).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
  });

  it('f22 status --folio without a year is rejected (folio requires año)', async () => {
    // The overview path used to silently drop --folio; now it fails loudly.
    await expect(run(makeF22Runtime(), 'f22', 'status', '--folio', '123')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('f22 observaciones <año> lists the observación códigos + ayuda URLs', async () => {
    const rt = makeF22Runtime();
    await seed(rt);
    const out = await run(rt, 'f22', 'observaciones', '2025');
    expect(out).toContain('observaciones');
    expect(out).toContain('B102');
    expect(out).toContain('http://www.sii.cl/B102.pdf');
    expect(out).toContain('1 observación(es).');
  });

  it('f22 historial <año> lists the events most-recent-first with fecha + glosa', async () => {
    const rt = makeF22Runtime();
    await seed(rt);
    const out = await run(rt, 'f22', 'historial', '2025');
    expect(out).toContain('(historial)');
    expect(out).toContain('16/04/2025'); // most recent first
    expect(out).toContain('Su devolución solicitada fue autorizada.');
    expect(out).toContain('2 evento(s).');
    // The 16/04 event must print before the 08/04 one.
    expect(out.indexOf('16/04/2025')).toBeLessThan(out.indexOf('08/04/2025'));
  });

  it('JSON default: `f22 historial <año>` emits the events array verbatim', async () => {
    const rt = makeF22Runtime();
    await seed(rt);
    const json = (await runJson(rt, 'f22', 'historial', '2025')) as {
      folios: string[];
      eventos: { codigo: string; fecha: string | null; glosa: string | null }[];
    };
    expect(json.folios).toEqual(['999']);
    expect(json.eventos.map((e) => e.codigo)).toEqual(['2', '48']); // most-recent-first
  });

  // Synthetic stand-in for SII's real parse error (the space-padding — the structural cause —
  // is preserved; the digits are synthetic).
  const SII_PARSE_ERROR = 'For input string: "    000000"';
  // A runtime whose buscaEventos fails every folio with `errorMsg`, over `busca`'s decls.
  const historialErrorRuntime = (busca: unknown, errorMsg: string): Runtime => ({
    ...makeF22Runtime(),
    portal: new testing.FakePortalDriver({
      loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
      restoreSession: {
        landingUrl: HOSTS.miSii,
        evaluate: datos,
        cookies: { TOKEN: 't' },
        requestJson: (url) =>
          url.includes('buscaDeclVgte')
            ? busca
            : url.includes('buscaEventos')
              ? { data: null, errorMsg, metaData: { errors: null } }
              : { metaData: {}, data: null },
      },
    }),
  });
  // A folio anulado by a rectificatoria, as SII sends it (folio a number, vgte "0"; #288).
  const BUSCA_ANULADA = {
    metaData: { errors: [] },
    data: {
      decls: [{ folio: 888, vgte: '0', codConc: 'C9', fecIng: '15/04/2025', tipoImpugnado: '1' }],
      glosas: [{ codConclusion: 'C9', descripcion: 'Anulada' }],
    },
  };

  it('f22 historial names a folio anulado SII cannot serve, and keeps its message verbatim (⚠)', async () => {
    const rt = historialErrorRuntime(BUSCA_ANULADA, SII_PARSE_ERROR);
    await seed(rt);
    const out = await run(rt, 'f22', 'historial', '2025');
    expect(out).toContain('0 evento(s).');
    // Names the declaración and frames the known failure as SII-side (#288), keeping the
    // verbatim message (ADR-004).
    expect(out).toContain(
      `⚠ folio 888 (no vigente, Anulada): el SII no entrega el historial de este folio; su propia web falla igual (error interno del SII: ${SII_PARSE_ERROR})`,
    );
    const json = (await runJson(rt, 'f22', 'historial', '2025')) as {
      foliosConError: { motivo: string }[];
    };
    expect(json.foliosConError.map((f) => f.motivo)).toEqual(['sii_no_entrega_historial']);
  });

  it("f22 historial does not claim SII's web fails too on a folio not known to be no vigente", async () => {
    // Observed on folios no vigentes only: on the vigente one the claim is left out.
    const rt = historialErrorRuntime(BUSCA, SII_PARSE_ERROR);
    await seed(rt);
    const out = await run(rt, 'f22', 'historial', '2025');
    expect(out).toContain(
      `⚠ folio 999 (vigente, Vigente): el SII no entrega el historial de este folio (error interno del SII: ${SII_PARSE_ERROR})`,
    );
    expect(out).not.toContain('su propia web falla igual');

    // A --folio outside the año's declaraciones: no declaración to name, no parentheses.
    const scoped = await run(rt, 'f22', 'historial', '2025', '--folio', '12345');
    expect(scoped).toContain(
      `⚠ folio 12345: el SII no entrega el historial de este folio (error interno del SII: ${SII_PARSE_ERROR})`,
    );
  });

  it('f22 historial reports any other SII message on a folio as sii_error, verbatim', async () => {
    const rt = historialErrorRuntime(BUSCA, 'Servicio no disponible');
    await seed(rt);
    const out = await run(rt, 'f22', 'historial', '2025');
    expect(out).toContain(
      '⚠ folio 999 (vigente, Vigente): el SII no entregó su historial (Servicio no disponible)',
    );
    const json = (await runJson(rt, 'f22', 'historial', '2025')) as {
      foliosConError: { motivo: string; error: string }[];
    };
    expect(json.foliosConError).toMatchObject([
      { motivo: 'sii_error', error: 'Servicio no disponible' },
    ]);
  });

  it('JSON is the default: `f22 status <año>` emits the task object verbatim (no human text)', async () => {
    const rt = makeF22Runtime();
    await seed(rt);
    const json = (await runJson(rt, 'f22', 'status', '2025')) as {
      rut: string;
      anio: string;
      folio: string | null;
      codigos: { codigo: string; valor: number | null; glosa: string | null }[];
      grupos?: unknown;
    };
    expect(json.rut).toBe('11111111-1'); // operating RUT identifies the declaration (a field, not PII leakage)
    expect(json.anio).toBe('2025');
    expect(json.codigos.map((c) => c.codigo)).toContain('305');
    expect(json.grupos).toBeUndefined(); // status never groups
    // The PII código (3 = RUT-as-value) is dropped from the structured grid too.
    expect(json.codigos.map((c) => c.codigo)).not.toContain('3');
  });

  it('JSON default: `f22 formulario <año>` carries `grupos` as structured data', async () => {
    const rt = makeF22Runtime();
    await seed(rt);
    const json = (await runJson(rt, 'f22', 'formulario', '2025')) as {
      grupos: { ingresos: { codigo: string }[]; resultado: { codigo: string }[] };
    };
    expect(json.grupos.ingresos.map((c) => c.codigo)).toContain('110');
    expect(json.grupos.resultado.map((c) => c.codigo)).toContain('305');
  });

  // Información de terceros (#183): synthetic grids in the observed shape. The session RUT is
  // 11.111.111-1 (seedSession); the declarante 77.777.777-7.
  const tc = (value: string | null, colspan = 1) => ({
    colspan,
    rowspan: 1,
    value,
    esParteDeSpan: false,
  });
  const tpart = () => ({ ...tc(null), esParteDeSpan: true });
  const trow = (tipoCelda: string, cells: unknown[]) => ({
    fila: Object.fromEntries(cells.map((x, i) => [String(i), x])),
    tipoCelda,
  });
  const tabla = (rows: unknown[]) =>
    Object.fromEntries(rows.map((r, i) => [String(i).padStart(2, '0'), r]));
  const RESUMEN = {
    metaData: { errors: null },
    data: [
      {
        listAgenteRetenedor: {
          '1887': {
            resumen: {
              tabla: tabla([
                trow('cabecera', [tc('Cantidad de Informantes'), tc('Renta Total')]),
                trow('dato', [tc('1'), tc('9.999.999')]),
              ]),
              cantRegistros: 0,
            },
          },
        },
        title: 'Sobre Rentas Del Art 42',
        formKey: 0,
      },
    ],
  };
  const DETALLE = {
    metaData: { errors: null },
    data: {
      listDetalle: {
        DETALLE: {
          detalle: {
            tabla: tabla([
              trow('cabecera', [
                tc('Folio'),
                tc('Rut Declarante', 3),
                tpart(),
                tpart(),
                tc('Nombre o Razón Social Declarante'),
                tc('Rut Partícipe', 3),
                tpart(),
                tpart(),
                tc('Monto'),
                tc('Estado'),
              ]),
              trow('dato', [
                tc('555'),
                tc('77.777.777'),
                tc('-'),
                tc('7'),
                tc('EMPLEADOR SINTETICO SPA'),
                tc('11.111.111'), // own RUT: must not surface
                tc('-'),
                tc('1'),
                tc('1.500.000'),
                tc('No Observada'),
              ]),
            ]),
            cantRegistros: 1,
          },
        },
      },
    },
  };

  function tercerosRuntime(): Runtime {
    return {
      ...makeF22Runtime(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          cookies: { TOKEN: 't' },
          requestJson: (url) =>
            url.includes('getAgenteRetenedor')
              ? RESUMEN
              : url.includes('getDjDetalle')
                ? DETALLE
                : { metaData: {}, data: null },
        },
      }),
    };
  }

  it('f22 terceros <año> (human) lists the per-DJ resumen with its aggregates', async () => {
    const rt = tercerosRuntime();
    await seed(rt);
    const out = await run(rt, 'f22', 'terceros', '2026');
    expect(out).toContain('(información de terceros)');
    expect(out).toContain('1887  Sobre Rentas Del Art 42');
    expect(out).toContain('Renta Total: 9.999.999');
    expect(out).toContain('1 declaración(es).');
  });

  it('JSON default: `f22 terceros <año> --dj 1887` emits the rows, own RUT dropped', async () => {
    const rt = tercerosRuntime();
    await seed(rt);
    const json = (await runJson(rt, 'f22', 'terceros', '2026', '--dj', '1887')) as {
      dj: string;
      registros: number;
      filas: { folio: string; declaranteRut: string; estado: string; campos: unknown[] }[];
    };
    expect(json).toMatchObject({ dj: '1887', registros: 1 });
    expect(json.filas[0]).toMatchObject({
      folio: '555',
      declaranteRut: '77777777-7',
      estado: 'No Observada',
      campos: [{ columna: 'Monto', valor: 1500000 }],
    });
    expect(JSON.stringify(json.filas)).not.toContain('11111111'); // the root `rut` is the principal
  });

  it('f22 terceros --pagina without --dj is a validation error (no SII call)', async () => {
    const rt = tercerosRuntime();
    await seed(rt);
    await expect(run(rt, 'f22', 'terceros', '2026', '--pagina', '2')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
