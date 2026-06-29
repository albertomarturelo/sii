import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { Runtime } from '../seams/index.js';
import { NotAuthenticatedError, ValidationError } from '../errors/index.js';
import { initOperateState, setOperatingRut } from '../identity/index.js';
import { writeSession } from '../auth/index.js';
import { f22Status, f22Overview, f22Observaciones, f22Historial } from './f22.js';
import type { JsonRequest } from '../seams/index.js';

// Synthetic data (no SII, no real PII): persona 20.000.042-0, empresa 77.777.777-7.
const SELF = '20000042-0';
const EMPRESA = '77777777-7';

const BUSCA_ENV = {
  metaData: { errors: [] },
  data: {
    decls: [{ folio: '12345', vgte: 'S', codConc: 'C1', fecIng: '15/04/2025', nombres: 'PII' }],
    glosas: [{ codConclusion: 'C1', descripcion: 'Vigente' }],
  },
};
const GRID_ENV = {
  metaData: {},
  data: [
    { codigo: '305', valor: '-150000', glosa: 'RESULTADO LIQUIDACIÓN ANUAL' },
    { codigo: '3', valor: '20000042-0', glosa: 'RUT' }, // header PII → excluded
  ],
};
// A rich f22Compacto grid (the `--full` source) covering every group + a non-PII unclassified
// código (→ otros) + identity/bank PII that must be dropped.
const RICH_GRID_ENV = {
  metaData: {},
  data: [
    { codigo: '110', valor: '3000000', glosa: 'Rentas honorarios' }, // ingreso
    { codigo: '494', valor: '900000', glosa: 'Gastos presuntos' }, // deducción
    { codigo: '198', valor: '300000', glosa: 'Retenciones' }, // retención
    { codigo: '305', valor: '-150000', glosa: 'RESULTADO LIQUIDACIÓN ANUAL' }, // resultado
    { codigo: '8865', valor: '1', glosa: 'Código Emisión' }, // non-PII unclassified → otros
    { codigo: '9920', valor: 'CALLE FALSA 123', glosa: 'Dirección Origen' }, // address PII → dropped
  ],
};
const OBS_ENV = {
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
};

// Two events for the vigente folio, oldest-first (wire order); the task sorts most-recent-first.
const EVENTOS_ENV = {
  data: [
    {
      folio: '12345',
      codEvento: '48',
      nombre: 'Declaración recibida, solicita Devolución por $9.999.',
      fechaEvento: '08/04/2025',
      tipoEvento: '0',
      codCarta: '000483',
      idCarta: null,
      referencia: '000483  ',
      fechaCitacion: '',
      unidadSii: '',
    },
    {
      folio: '12345',
      codEvento: '2',
      nombre: 'Su devolución solicitada fue autorizada.',
      fechaEvento: '16/04/2025',
      tipoEvento: '0',
      codCarta: '000400',
      idCarta: null,
      referencia: '000400',
      fechaCitacion: '',
      unidadSii: '',
    },
  ],
  respCod: 0,
  errorMsg: null,
  metaData: { errors: null },
};

function makeRuntime(): Runtime {
  return {
    clock: new FixedClock(new Date('2026-06-27T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver({
      restoreSession: {
        cookies: { TOKEN: 't' },
        requestJson: (url) => {
          if (url.includes('buscaDeclVgte')) return BUSCA_ENV;
          if (url.includes('f22Compacto')) return GRID_ENV;
          if (url.includes('situacionObservacion')) return OBS_ENV;
          if (url.includes('buscaEventos')) return EVENTOS_ENV;
          return { metaData: {}, data: null };
        },
      },
    }),
  };
}

async function seed(
  runtime: Runtime,
  accountType: 'persona' | 'empresa' = 'persona',
): Promise<void> {
  await writeSession(runtime.store, { rut: SELF, cookies: ['c'], savedAt: '2026-06-27T12:00:00Z' });
  await initOperateState(runtime.store, {
    selfRut: SELF,
    accountType,
    operable: [
      { rut: SELF, razonSocial: 'Juan Pérez', isSelf: true },
      { rut: EMPRESA, razonSocial: 'Mi Empresa SpA', isSelf: false },
    ],
  });
}

const entries = (rt: Runtime) => (rt.audit as RecordingAuditSink).entries;
const slept = (rt: Runtime) => (rt.clock as FixedClock).slept;

describe('f22 tasks (fakes, no SII)', () => {
  it('f22Status composes decls + grid, curates códigos (PII excluded), paces the 2nd POST, audits', async () => {
    const rt = makeRuntime();
    await seed(rt);

    const res = await f22Status(rt, { anio: '2025' });
    expect(res).toMatchObject({
      rut: SELF,
      anio: '2025',
      tieneDeclaracion: true,
      folio: '12345',
      estado: 'Vigente',
    });
    expect(res.codigos.map((c) => c.codigo)).toEqual(['305']); // header código '3' excluded
    expect(res.codigos[0]?.valor).toBe(-150000);
    expect(JSON.stringify(res)).not.toContain('PII'); // decl identity PII never surfaces
    expect(slept(rt)).toEqual([1000]); // one pace before the grid POST
    expect(entries(rt).at(-1)).toMatchObject({
      action: 'f22_estado',
      result: 'ok',
      rut: SELF,
      period: '2025',
    });
  });

  it('full=true groups the f22Compacto grid (ingresos/deducciones/retenciones/resultado/otros), drops PII, paces + audits', async () => {
    const rt: Runtime = {
      ...makeRuntime(),
      portal: new FakePortalDriver({
        restoreSession: {
          cookies: { TOKEN: 't' },
          requestJson: (url) => (url.includes('buscaDeclVgte') ? BUSCA_ENV : RICH_GRID_ENV), // f22Compacto → rich grid
        },
      }),
    };
    await seed(rt);

    const res = await f22Status(rt, { anio: '2025', full: true });
    // Same grid as a non-full read (PII dropped); --full ADDS the grouping. Nothing tax-relevant hidden.
    expect(res.codigos.map((c) => c.codigo).sort()).toEqual(['110', '198', '305', '494', '8865']);
    expect(res.grupos).toBeDefined();
    expect(res.grupos?.ingresos.map((c) => c.codigo)).toEqual(['110']);
    expect(res.grupos?.deducciones.map((c) => c.codigo)).toEqual(['494']);
    expect(res.grupos?.creditos.map((c) => c.codigo)).toEqual(['198']);
    expect(res.grupos?.resultado.map((c) => c.codigo)).toEqual(['305']);
    expect(res.grupos?.otros.map((c) => c.codigo)).toEqual(['8865']); // non-PII, unmapped → still shown
    expect(JSON.stringify(res)).not.toContain('CALLE FALSA 123'); // address PII never surfaces
    expect(slept(rt)).toEqual([1000]); // one pace before the grid POST
    expect(entries(rt).at(-1)).toMatchObject({ action: 'f22_estado', result: 'ok', rut: SELF });
  });

  it('without full, the output is unchanged: flat grid, no grupos', async () => {
    const rt = makeRuntime();
    await seed(rt);

    const res = await f22Status(rt, { anio: '2025' });
    expect(res.codigos.map((c) => c.codigo)).toEqual(['305']); // header código '3' excluded
    expect(res.grupos).toBeUndefined();
  });

  it('is session-keyed: ignores the operate pointer (queries SELF even when operating as an empresa)', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await setOperatingRut(rt.store, EMPRESA); // pointer = empresa

    const res = await f22Status(rt, { anio: '2025' });
    expect(res.rut).toBe(SELF); // NOT the empresa — F22 authorizes by the session principal
  });

  it('no declaración → tieneDeclaracion false, no grid POST, folio null', async () => {
    const rt: Runtime = {
      ...makeRuntime(),
      portal: new FakePortalDriver({
        restoreSession: {
          cookies: { TOKEN: 't' },
          requestJson: () => ({ metaData: {}, data: { decls: null } }),
        },
      }),
    };
    await seed(rt);
    const res = await f22Status(rt, { anio: '2025' });
    expect(res).toMatchObject({ tieneDeclaracion: false, folio: null, estado: null });
    expect(res.codigos).toEqual([]);
    expect(slept(rt)).toEqual([]); // no 2nd POST → no pace
  });

  it('f22Overview lists the last N years (most recent first), paced, one POST per year', async () => {
    const rt = makeRuntime();
    await seed(rt);

    const res = await f22Overview(rt, { years: 3 });
    expect(res.anios.map((a) => a.anio)).toEqual(['2026', '2025', '2024']); // current year from the clock
    expect(res.anios.every((a) => a.tieneDeclaracion)).toBe(true);
    expect(slept(rt)).toEqual([1000, 1000]); // paced between the 3 years (2 gaps)
    expect(entries(rt).at(-1)).toMatchObject({ action: 'f22_overview', result: 'ok', years: 3 });
  });

  it('no session → NotAuthenticated with a failed audit', async () => {
    const rt = makeRuntime(); // not seeded
    await expect(f22Status(rt, { anio: '2025' })).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(entries(rt).at(-1)).toMatchObject({ action: 'f22_estado', result: 'failed' });
  });

  it('f22Observaciones composes decls + situacionObservacion, session-keyed, paces, audits', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await setOperatingRut(rt.store, EMPRESA); // pointer = empresa → ignored (session-keyed)

    const res = await f22Observaciones(rt, { anio: '2025' });
    expect(res).toMatchObject({ rut: SELF, anio: '2025', tieneDeclaracion: true, folio: '12345' });
    expect(res.observaciones.map((o) => o.codigo)).toEqual(['B102', 'G37']);
    expect(slept(rt)).toEqual([1000]); // one pace before the observaciones POST
    expect(entries(rt).at(-1)).toMatchObject({
      action: 'f22_observaciones',
      result: 'ok',
      rut: SELF,
      period: '2025',
    });
  });

  it('f22Observaciones: no declaración → sin observaciones, no 2nd POST', async () => {
    const rt: Runtime = {
      ...makeRuntime(),
      portal: new FakePortalDriver({
        restoreSession: {
          cookies: { TOKEN: 't' },
          requestJson: () => ({ metaData: {}, data: { decls: null } }),
        },
      }),
    };
    await seed(rt);
    const res = await f22Observaciones(rt, { anio: '2025' });
    expect(res).toMatchObject({ tieneDeclaracion: false, folio: null });
    expect(res.observaciones).toEqual([]);
    expect(slept(rt)).toEqual([]);
  });

  it('f22Observaciones: a non-numeric --folio fails fast (ValidationError, no session)', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await expect(f22Observaciones(rt, { anio: '2025', folio: 'abc' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    // Thrown before withSession → no observaciones audit receipt, no POST/pace.
    expect(entries(rt).some((e) => e.action === 'f22_observaciones')).toBe(false);
    expect(slept(rt)).toEqual([]);
  });

  it('f22Historial composes decls + buscaEventos, sorts most-recent-first, session-keyed, paces, audits', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await setOperatingRut(rt.store, EMPRESA); // pointer = empresa → ignored (session-keyed)

    const res = await f22Historial(rt, { anio: '2025' });
    expect(res).toMatchObject({ rut: SELF, anio: '2025', tieneDeclaracion: true });
    expect(res.folios).toEqual(['12345']);
    // Wire is oldest-first (08/04 then 16/04); the task returns most-recent-first.
    expect(res.eventos.map((e) => e.codigo)).toEqual(['2', '48']);
    expect(res.eventos[0]).toMatchObject({ fecha: '16/04/2025', referencia: '000400' });
    expect(res.foliosConError).toEqual([]); // happy path: no folio errored
    expect(slept(rt)).toEqual([1000]); // one pace before the single buscaEventos POST
    expect(entries(rt).at(-1)).toMatchObject({
      action: 'f22_historial',
      result: 'ok',
      rut: SELF,
      period: '2025',
    });
  });

  it('f22Historial: same-date events come out most-recent-first (reverse wire), not envío→aceptación', async () => {
    // Mirrors live AT 2026: a rectificatoria's two events share a date (28/06); the wire is
    // oldest-first (enviada then aceptada). Most-recent-first must put "aceptada" first.
    const SAME_DAY = {
      data: [
        {
          folio: '12345',
          codEvento: '44',
          nombre: 'Declaración Rectificatoria.',
          fechaEvento: '28/06/2026',
          tipoEvento: '0',
        },
        {
          folio: '12345',
          codEvento: '505',
          nombre: 'Rectificatoria Aceptada.',
          fechaEvento: '28/06/2026',
          tipoEvento: '1',
        },
      ],
      respCod: 0,
      errorMsg: null,
      metaData: { errors: null },
    };
    const rt: Runtime = {
      ...makeRuntime(),
      portal: new FakePortalDriver({
        restoreSession: {
          cookies: { TOKEN: 't' },
          requestJson: (url) => (url.includes('buscaEventos') ? SAME_DAY : BUSCA_ENV),
        },
      }),
    };
    await seed(rt);
    const res = await f22Historial(rt, { anio: '2026' });
    expect(res.eventos.map((e) => e.codigo)).toEqual(['505', '44']); // aceptada (later) before enviada
  });

  it('f22Historial reads EVERY folio of the año (rectificatorias) and merges events most-recent-first', async () => {
    // Two declaraciones (folios 12345 + 67890); buscaEventos returns a distinct event per folio.
    const TWO_DECLS = {
      metaData: { errors: [] },
      data: {
        decls: [
          { folio: '12345', vgte: 'N', codConc: 'C1', fecIng: '15/04/2025' },
          { folio: '67890', vgte: 'S', codConc: 'C1', fecIng: '10/05/2025' },
        ],
        glosas: [{ codConclusion: 'C1', descripcion: 'Vigente' }],
      },
    };
    const eventFor = (folio: string, fecha: string, cod: string) => ({
      data: [
        { folio, codEvento: cod, nombre: `evento ${folio}`, fechaEvento: fecha, tipoEvento: '0' },
      ],
      respCod: 0,
      errorMsg: null,
      metaData: { errors: null },
    });
    const rt: Runtime = {
      ...makeRuntime(),
      portal: new FakePortalDriver({
        restoreSession: {
          cookies: { TOKEN: 't' },
          requestJson: (url, options?: JsonRequest) => {
            if (url.includes('buscaDeclVgte')) return TWO_DECLS;
            if (url.includes('buscaEventos')) {
              const folio = String(
                (options?.body as { data?: { folio?: unknown } } | undefined)?.data?.folio ?? '',
              );
              return folio === '67890'
                ? eventFor('67890', '20/05/2025', 'B')
                : eventFor('12345', '08/04/2025', 'A');
            }
            return { metaData: {}, data: null };
          },
        },
      }),
    };
    await seed(rt);

    const res = await f22Historial(rt, { anio: '2025' });
    expect(res.folios).toEqual(['12345', '67890']); // both folios read
    expect(res.eventos.map((e) => e.codigo)).toEqual(['B', 'A']); // 20/05 before 08/04
    expect(slept(rt)).toEqual([1000, 1000]); // one pace per buscaEventos POST
  });

  it('f22Historial is per-folio resilient: one folio errors → its SII msg recorded, the rest still return', async () => {
    // Mirrors live AT 2026: vigente folio 12345 returns events; superseded folio 67890 hits an
    // SII server-side parse error. The good folio's events must survive.
    const TWO_DECLS = {
      metaData: { errors: [] },
      data: {
        decls: [
          { folio: '12345', vgte: 'S', codConc: 'C1', fecIng: '15/04/2025' },
          { folio: '67890', vgte: 'N', codConc: 'C1', fecIng: '10/05/2025' },
        ],
        glosas: [{ codConclusion: 'C1', descripcion: 'Vigente' }],
      },
    };
    const rt: Runtime = {
      ...makeRuntime(),
      portal: new FakePortalDriver({
        restoreSession: {
          cookies: { TOKEN: 't' },
          requestJson: (url, options?: JsonRequest) => {
            if (url.includes('buscaDeclVgte')) return TWO_DECLS;
            if (url.includes('buscaEventos')) {
              const folio = String(
                (options?.body as { data?: { folio?: unknown } } | undefined)?.data?.folio ?? '',
              );
              return folio === '67890'
                ? {
                    data: null,
                    // Synthetic stand-in for SII's real parse error (space-padding preserved,
                    // digits synthetic).
                    errorMsg: 'For input string: "    000000"',
                    metaData: { errors: null },
                  }
                : {
                    data: [
                      {
                        folio: '12345',
                        codEvento: '2',
                        nombre: 'Devolución autorizada.',
                        fechaEvento: '16/04/2025',
                        tipoEvento: '0',
                      },
                    ],
                    respCod: 0,
                    errorMsg: null,
                    metaData: { errors: null },
                  };
            }
            return { metaData: {}, data: null };
          },
        },
      }),
    };
    await seed(rt);

    const res = await f22Historial(rt, { anio: '2025' });
    expect(res.folios).toEqual(['12345', '67890']); // both attempted
    expect(res.eventos.map((e) => e.codigo)).toEqual(['2']); // the good folio's event survives
    expect(res.foliosConError).toEqual([
      { folio: '67890', error: 'For input string: "    000000"' }, // verbatim, not hidden
    ]);
    // A folio error is NOT a task failure — the receipt is still ok.
    expect(entries(rt).at(-1)).toMatchObject({ action: 'f22_historial', result: 'ok' });
  });

  it('f22Historial: no declaración → sin eventos, no buscaEventos POST', async () => {
    const rt: Runtime = {
      ...makeRuntime(),
      portal: new FakePortalDriver({
        restoreSession: {
          cookies: { TOKEN: 't' },
          requestJson: () => ({ metaData: {}, data: { decls: null } }),
        },
      }),
    };
    await seed(rt);
    const res = await f22Historial(rt, { anio: '2025' });
    expect(res).toMatchObject({ tieneDeclaracion: false, folios: [], eventos: [] });
    expect(slept(rt)).toEqual([]); // no folio → no POST → no pace
  });

  it('f22Historial: a --folio scopes to one folio; a non-numeric one fails fast (no session)', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const scoped = await f22Historial(rt, { anio: '2025', folio: '99999' });
    expect(scoped.folios).toEqual(['99999']); // the override, not the decls' folio

    await expect(f22Historial(rt, { anio: '2025', folio: 'abc' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
