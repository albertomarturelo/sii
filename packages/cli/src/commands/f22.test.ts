import { describe, it, expect } from 'vitest';
import {
  HOSTS,
  NotAuthenticatedError,
  ValidationError,
  testing,
  type Runtime,
} from '@altumstack/sii-core';
import { datos, run, runJson } from '../test-helpers.js';

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
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'f22', 'status', '2025');
    expect(out).toContain('F22 2025');
    expect(out).toContain('Estado: Vigente');
    expect(out).toContain('305');
    expect(out).toContain('5 código(s).'); // 110/494/198/305/8865; header '3' (RUT) excluded
    expect(out).not.toContain('11111111-1'); // the excluded PII código's value never prints
  });

  it('f22 status (no year) shows the multi-year estado overview', async () => {
    const rt = makeF22Runtime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'f22', 'status', '--years', '3');
    expect(out).toContain('estado por año');
    expect(out).toContain('2026  Vigente');
    expect(out).toContain('2024  Vigente');
  });

  it('f22 formulario <año> prints the complete form grouped (ingresos/deducciones/retenciones/resultado/otros)', async () => {
    const rt = makeF22Runtime();
    await run(rt, 'auth', 'login');
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
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'f22', 'observaciones', '2025');
    expect(out).toContain('observaciones');
    expect(out).toContain('B102');
    expect(out).toContain('http://www.sii.cl/B102.pdf');
    expect(out).toContain('1 observación(es).');
  });

  it('f22 historial <año> lists the events most-recent-first with fecha + glosa', async () => {
    const rt = makeF22Runtime();
    await run(rt, 'auth', 'login');
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
    await run(rt, 'auth', 'login');
    const json = (await runJson(rt, 'f22', 'historial', '2025')) as {
      folios: string[];
      eventos: { codigo: string; fecha: string | null; glosa: string | null }[];
    };
    expect(json.folios).toEqual(['999']);
    expect(json.eventos.map((e) => e.codigo)).toEqual(['2', '48']); // most-recent-first
  });

  it('f22 historial surfaces a folio SII error verbatim (⚠) without burying it', async () => {
    // buscaEventos errors on the (only) folio → no events, but the SII message is shown.
    const rt: Runtime = {
      ...makeF22Runtime(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          cookies: { TOKEN: 't' },
          requestJson: (url) =>
            url.includes('buscaDeclVgte')
              ? BUSCA
              : url.includes('buscaEventos')
                ? {
                    data: null,
                    // Synthetic stand-in for SII's real parse error (the space-padding — the
                    // structural cause — is preserved; the digits are synthetic).
                    errorMsg: 'For input string: "    000000"',
                    metaData: { errors: null },
                  }
                : { metaData: {}, data: null },
        },
      }),
    };
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'f22', 'historial', '2025');
    expect(out).toContain('0 evento(s).');
    // Framed as SII-side, but the verbatim message is preserved (ADR-004).
    expect(out).toContain('⚠ folio 999: el SII no entregó su historial (error interno del SII:');
    expect(out).toContain('For input string: "    000000"');
  });

  it('JSON is the default: `f22 status <año>` emits the task object verbatim (no human text)', async () => {
    const rt = makeF22Runtime();
    await run(rt, 'auth', 'login');
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
    await run(rt, 'auth', 'login');
    const json = (await runJson(rt, 'f22', 'formulario', '2025')) as {
      grupos: { ingresos: { codigo: string }[]; resultado: { codigo: string }[] };
    };
    expect(json.grupos.ingresos.map((c) => c.codigo)).toContain('110');
    expect(json.grupos.resultado.map((c) => c.codigo)).toContain('305');
  });
});
