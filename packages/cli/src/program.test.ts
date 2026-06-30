import { describe, it, expect, vi } from 'vitest';
import {
  HOSTS,
  LoginFailedError,
  NotAuthenticatedError,
  RateLimitError,
  SessionExpiredError,
  ValidationError,
  testing,
  type Runtime,
} from '@altumstack/sii-core';
import { buildProgram } from './program.js';
import { exitCodeFor } from './io.js';
import type { Prompters } from './prompt.js';

// Synthetic, Mod-11-valid RUT (CONVENTIONS): 11.111.111-1.
const SELF_RUT_BODY = 11111111;

// The portal's inline contribuyente snapshot (DatosCntrNow), used by both the
// login mint and the `--refresh` readback.
const datos = (): unknown => ({
  contribuyente: { rut: SELF_RUT_BODY, dv: '1', nombres: 'Juan', apellidoPaterno: 'Pérez' },
});

function makeRuntime(): Runtime {
  return {
    clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
    audit: new testing.RecordingAuditSink(),
    store: new testing.InMemoryKeyValueStore(),
    portal: new testing.FakePortalDriver({
      loginSession: {
        landingUrl: HOSTS.miSii, // off zeusr.sii.cl ⇒ authenticated (URL-based detection)
        evaluate: datos,
        storageState: { cookies: [] },
      },
      // credentialLogin() backs `auth login --console` (ADR-010).
      credentialSession: {
        landingUrl: HOSTS.miSii,
        evaluate: datos,
        storageState: { cookies: [] },
      },
      // restore() backs the idempotent live-probe and `auth status --refresh`.
      restoreSession: { landingUrl: HOSTS.miSii, evaluate: datos },
    }),
  };
}

/** Capture STDOUT while running `fn` (STDERR — incl. the header + prompts — muted). */
async function capture(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    await fn();
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  return lines.join('');
}

// Output is JSON by DEFAULT now; these helpers append `--human` so the human-rendering
// assertions below stay focused on the text. The JSON default is covered by `runJson` +
// the dedicated "JSON output (default)" describe block.
async function run(runtime: Runtime, ...argv: string[]): Promise<string> {
  return capture(async () => {
    const program = buildProgram(runtime);
    program.exitOverride();
    await program.parseAsync(['node', 'sii', ...argv, '--human']);
  });
}

/** Run with injected prompters (for `auth login --console`, no real stdin). */
async function runWith(runtime: Runtime, prompters: Prompters, ...argv: string[]): Promise<string> {
  return capture(async () => {
    const program = buildProgram(runtime, prompters);
    program.exitOverride();
    await program.parseAsync(['node', 'sii', ...argv, '--human']);
  });
}

/** Run with the DEFAULT (JSON) output and parse it — the library/integration contract. */
async function runJson(runtime: Runtime, ...argv: string[]): Promise<unknown> {
  const text = await capture(async () => {
    const program = buildProgram(runtime);
    program.exitOverride();
    await program.parseAsync(['node', 'sii', ...argv]);
  });
  return JSON.parse(text);
}

/** Fake prompters: hidden() returns the Clave; line() returns the RUT (if prompted). */
const fakePrompters = (clave: string, rut = ''): Prompters => ({
  line: () => Promise.resolve(rut),
  hidden: () => Promise.resolve(clave),
});

describe('sii CLI command tree (fake runtime, no SII)', () => {
  it('auth login mints a session and reports the RUT', async () => {
    const out = await run(makeRuntime(), 'auth', 'login');
    expect(out).toContain('Sesión iniciada como 11.111.111-1.');
  });

  it('auth login is idempotent when a live session exists', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'auth', 'login');
    expect(out).toContain('Ya tienes una sesión activa como 11.111.111-1.');
  });

  it('auth login --console mints a session from terminal RUT + Clave', async () => {
    const out = await runWith(
      makeRuntime(),
      fakePrompters('synthetic-clave'),
      'auth',
      'login',
      '--console',
      '--rut',
      '11111111-1',
    );
    expect(out).toContain('Sesión iniciada como 11.111.111-1.');
  });

  it('auth login --console prompts for the RUT when --rut is omitted', async () => {
    const out = await runWith(
      makeRuntime(),
      fakePrompters('synthetic-clave', '11111111-1'),
      'auth',
      'login',
      '--console',
    );
    expect(out).toContain('Sesión iniciada como 11.111.111-1.');
  });

  it('auth login --console with an empty Clave fails before any attempt', async () => {
    await expect(
      runWith(
        makeRuntime(),
        fakePrompters(''),
        'auth',
        'login',
        '--console',
        '--rut',
        '11111111-1',
      ),
    ).rejects.toThrow(/Clave vacía/);
  });

  it('auth status reports the local session after login', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'auth', 'status');
    expect(out).toContain('Autenticado (sesión local) como 11.111.111-1.');
  });

  it('auth status without a session says so', async () => {
    const out = await run(makeRuntime(), 'auth', 'status');
    expect(out).toContain('No autenticado.');
  });

  it('auth status --refresh reads the identity from the portal', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'auth', 'status', '--refresh');
    expect(out).toContain('11.111.111-1');
    expect(out).toContain('Juan Pérez');
    expect(out).toContain('persona');
  });

  it('operate with no argument reports the current context', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'operate');
    expect(out).toContain('Operando como tú mismo: 11.111.111-1.');
  });

  it('operate --self reports operating as self', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'operate', '--self');
    expect(out).toContain('Operando como tú mismo: 11.111.111-1.');
  });

  it('operate <rut> validates against the operable set (self is operable)', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'operate', '11111111-1');
    expect(out).toContain('Operando como tú mismo: 11.111.111-1.');
  });

  it('operate --list lists the operable set with markers', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'operate', '--list');
    expect(out).toContain('11.111.111-1');
    expect(out).toContain('tú mismo');
    expect(out).toContain('operando ahora');
  });

  it('operate --list without a session says so', async () => {
    const out = await run(makeRuntime(), 'operate', '--list');
    expect(out).toContain('No hay sesión activa.');
  });

  it('logout wipes the session', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'auth', 'logout');
    expect(out).toMatch(/Sesión cerrada/);
    expect(await run(rt, 'auth', 'status')).toContain('No autenticado.');
  });
});

describe('sii rcv command (fake runtime, no SII)', () => {
  const RESUMEN_ENV = {
    respEstado: { codRespuesta: 0 },
    totDocRes: 2,
    data: [
      { rsmnTipoDocInteger: 33, dcvNombreTipoDoc: 'Factura', rsmnTotDoc: 2, rsmnMntTotal: 119000 },
    ],
  };

  // restore() backs withSession; it scripts the RCV facade's requestJson + TOKEN cookie.
  function makeRcvRuntime(requestJson: () => unknown): Runtime {
    return {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          requestJson,
          cookies: { TOKEN: 't' },
        },
      }),
    };
  }

  it('rcv summary prints the resumen rows for a period', async () => {
    const rt = makeRcvRuntime(() => RESUMEN_ENV);
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'rcv', 'summary', '2026-06');
    expect(out).toContain('RCV COMPRA 2026-06');
    expect(out).toContain('33');
    expect(out).toContain('Total documentos: 2');
  });

  it('rcv summary requires a session (NotAuthenticated → exit 2)', async () => {
    const rt = makeRcvRuntime(() => RESUMEN_ENV); // no login
    await expect(run(rt, 'rcv', 'summary', '2026-06')).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
  });
});

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

describe('sii f29 command (fake runtime, no SII)', () => {
  const PROPUESTA = {
    metaData: { errors: null },
    data: {
      tipopropuesta: 40,
      estado: 0,
      descripcionEstado: null,
      listCodPropuestos: [
        { codigo: '503', valor: '1000000' }, // debitos
        { codigo: '538', valor: '190000' }, // debitos (TOTAL DÉBITOS)
        { codigo: '511', valor: '50000' }, // creditos
        { codigo: '151', valor: '30000' }, // retenciones
      ],
      listCodAdministrativos: [{ codigo: '9114', valor: '1' }], // otros
      listCodBase: [{ codigo: '05', valor: 'PII NAME' }], // identity PII → dropped
    },
  };
  const ESTADO = {
    metaData: { errors: null },
    data: [
      {
        estadoDeclaracionId: 1,
        estado: 'Vigente',
        folio: 7654321,
        declFechaCreacion: '12/06/2026',
        monto: 880000, // declared total a pagar → surfaced
      },
    ],
  };
  function makeF29Runtime(): Runtime {
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
            url.includes('getDeclaracionConCondicionesYTipoPropuesta')
              ? PROPUESTA
              : url.includes('getDeclaracionConEstados')
                ? ESTADO
                : { metaData: {}, data: null },
        },
      }),
    };
  }

  it('f29 formulario <periodo> prints the propuesta grouped + labeled (PII dropped)', async () => {
    const rt = makeF29Runtime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'f29', 'formulario', '2026-05');
    expect(out).toContain('F29 2026-05');
    expect(out).toContain('fuente: propuesta');
    expect(out).toContain('Débitos (ventas):');
    expect(out).toContain('TOTAL DÉBITOS'); // glosa from the taxonomy
    expect(out).toContain('Créditos (compras):');
    expect(out).not.toContain('PII NAME'); // listCodBase never prints
  });

  it('f29 overview <año> lists the per-month position with total', async () => {
    const rt = makeF29Runtime();
    await run(rt, 'auth', 'login');
    const json = (await runJson(rt, 'f29', 'overview', '2026')) as {
      desde: string;
      hasta: string;
      meses: { periodo: string; estado: string | null; total: number | null }[];
    };
    expect(json.desde).toBe('2026-01');
    expect(json.hasta).toBe('2026-12');
    expect(json.meses).toHaveLength(12);
    expect(json.meses.every((m) => m.estado === 'Vigente' && m.total === 880000)).toBe(true);
  });

  it('f29 status <periodo> lists the presented declaración with total', async () => {
    const rt = makeF29Runtime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'f29', 'status', '2026-05');
    expect(out).toContain('(estado)');
    expect(out).toContain('Vigente');
    expect(out).toContain('folio 7654321');
    expect(out).toContain('880.000'); // total surfaced (es-CL)
  });

  it('f29 formulario requires a session (NotAuthenticated)', async () => {
    await expect(run(makeF29Runtime(), 'f29', 'formulario', '2026-05')).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
  });
});

describe('sii bte command (fake runtime, no SII)', () => {
  const META = { total_boletas: '1', suma_liquido: '256500', nombre_contribuyente: 'PII-OWN-XYZ' };
  const ARR = {
    nroboleta_1: '101',
    fechaemision_1: '15/05/2026',
    rutreceptor_1: '12345670',
    dvreceptor_1: 'K',
    nombrereceptor_1: 'Cliente Uno SpA',
    honorariosliquidos_1: '256.500',
    estado_1: 'N',
  };
  // restoreSession.evaluate serves BOTH the login DatosCntrNow probe and the BTE inline maps.
  const evaluate = (expr: string): unknown =>
    expr.includes('arr_informe_mensual') ? ARR : expr.includes('xml_values') ? META : datos();
  const makeBteRuntime = (): Runtime => ({
    clock: new testing.FixedClock(new Date('2026-06-30T12:00:00Z')),
    audit: new testing.RecordingAuditSink(),
    store: new testing.InMemoryKeyValueStore(),
    portal: new testing.FakePortalDriver({
      loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
      restoreSession: { landingUrl: HOSTS.miSii, evaluate },
    }),
  });

  it('bte list <periodo> prints the month boletas (EMITIDAS by default)', async () => {
    const rt = makeBteRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'bte', 'list', '2026-05');
    expect(out).toContain('BHE EMITIDAS 2026-05');
    expect(out).toContain('folio=101');
    expect(out).toContain('1 boleta(s)');
    expect(out).not.toContain('PII-OWN-XYZ'); // own-identity meta never prints
  });

  it('JSON default: bte list emits the curated object (no --rut concept)', async () => {
    const rt = makeBteRuntime();
    await run(rt, 'auth', 'login');
    const json = (await runJson(rt, 'bte', 'list', '2026-05', '--recibidas')) as {
      side: string;
      boletas: { folio: number }[];
    };
    expect(json.side).toBe('RECIBIDAS');
    expect(json.boletas.map((b) => b.folio)).toEqual([101]);
  });

  it('bte list requires a session (NotAuthenticated → exit 2)', async () => {
    await expect(run(makeBteRuntime(), 'bte', 'list', '2026-05')).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
  });
});

describe('sii dte command (fake runtime, no SII)', () => {
  // Public consulta: no login. The driver scripts requestPublic (no session/cookies).
  const AUTHORIZED_HTML = `
    <table>
      <tr><td>Rut</td><td>20.000.042-0</td></tr>
      <tr><td>Razon Social/Nombres</td><td>EMPRESA SINTETICA SPA</td></tr>
      <tr><td>N Resolucion</td><td>80</td></tr>
    </table>
    <table>
      <tr><td>33</td><td>FACTURA ELECTRONICA</td><td>01-08-2014</td><td></td></tr>
      <tr><td>61</td><td>NOTA CREDITO ELECTRONICA</td><td>01-08-2014</td><td>15-01-2020</td></tr>
    </table>`;
  const NOT_AUTHORIZED_HTML =
    '<table><tr><td>El rut que ha ingresado, no corresponde a una empresa autorizada a emitir Facturas Electronicas.</td></tr></table>';

  const makeDteRuntime = (requestPublic: () => string): Runtime => ({
    clock: new testing.FixedClock(new Date('2026-06-29T12:00:00Z')),
    audit: new testing.RecordingAuditSink(),
    store: new testing.InMemoryKeyValueStore(),
    portal: new testing.FakePortalDriver({ requestPublic }),
  });

  it('dte authorized <rut> prints the authorized documents WITHOUT any login', async () => {
    const out = await run(
      makeDteRuntime(() => AUTHORIZED_HTML),
      'dte',
      'authorized',
      '20000042-0',
    );
    expect(out).toContain('DTE autorizados — 20.000.042-0');
    expect(out).toContain('EMPRESA SINTETICA SPA');
    expect(out).toContain('33');
    expect(out).toContain('desautorizado 15-01-2020'); // 61's desautorización surfaced
    expect(out).toContain('2 tipo(s) de documento.');
  });

  it('dte authorized for a non-emisor RUT prints the verbatim SII message', async () => {
    const out = await run(
      makeDteRuntime(() => NOT_AUTHORIZED_HTML),
      'dte',
      'authorized',
      '20000042-0',
    );
    expect(out).toContain('no corresponde a una empresa autorizada');
  });

  it('JSON default: dte authorized emits the curated report object', async () => {
    const json = (await runJson(
      makeDteRuntime(() => AUTHORIZED_HTML),
      'dte',
      'authorized',
      '20000042-0',
    )) as { rut: string; autorizado: boolean; documentos: { codigo: number }[] };
    expect(json).toMatchObject({ rut: '20000042-0', autorizado: true });
    expect(json.documentos.map((d) => d.codigo)).toEqual([33, 61]);
  });

  it('dte authorized requires the rut argument', async () => {
    await expect(
      run(
        makeDteRuntime(() => AUTHORIZED_HTML),
        'dte',
        'authorized',
      ),
    ).rejects.toThrow();
  });
});

describe('exit-code mapping (errors.ts contract)', () => {
  it('maps domain errors to documented codes', () => {
    expect(exitCodeFor(new NotAuthenticatedError('x'))).toBe(2);
    expect(exitCodeFor(new SessionExpiredError('x'))).toBe(2); // subclass of NotAuthenticated
    expect(exitCodeFor(new LoginFailedError('x'))).toBe(3);
    expect(exitCodeFor(new RateLimitError('x'))).toBe(4);
    expect(exitCodeFor(new Error('x'))).toBe(1);
  });
});
