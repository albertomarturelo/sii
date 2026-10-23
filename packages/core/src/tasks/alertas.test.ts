import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { JsonRequest, Runtime } from '../seams/index.js';
import { NotAuthenticatedError, RateLimitError, ValidationError } from '../errors/index.js';
import { initOperateState, setOperatingRut } from '../identity/index.js';
import { writeSession } from '../auth/index.js';
import { Periodo } from '../periodo/index.js';
import { encodeOk } from '../portal/__fixtures__/gwt-encode.js';
import { alertas, vencimientoF29, type Alerta } from './alertas.js';

// Synthetic data (no SII, no real PII): persona 20.000.042-0, empresa 77.777.777-7.
const SELF = '20000042-0';
const EMPRESA = '77777777-7';

const BUSCA_ENV = {
  metaData: { errors: [] },
  data: {
    decls: [{ folio: '12345', vgte: 'S', codConc: 'C1', fecIng: '15/04/2025' }],
    glosas: [{ codConclusion: 'C1', descripcion: 'Vigente' }],
  },
};
const OBS_ENV = {
  data: [
    {
      codigo: 'B102',
      descripcion: 'Control ganancia de capital',
      url: 'http://www.sii.cl/B102.pdf',
    },
    { codigo: 'G37', descripcion: 'Control de retiros y dividendos', url: null },
  ],
  respCod: null,
  errorMsg: null,
  metaData: { errors: null },
};
const F22_DOWN = {
  data: null,
  errorMsg: 'Servicio no disponible (sintético).',
  metaData: { errors: null },
};

const vigente = (folio: number) => ({
  estadoDeclaracionId: 1,
  estado: 'Vigente',
  folio,
  declFechaCreacion: '12/01/2026',
  monto: 0,
});
/** F29 estado rows per período (YYYY-MM); anything unlisted is Vigente. */
type F29Script = Record<string, unknown[]>;
const F29_MIXED: F29Script = {
  '2026-09': [], // nothing filed, due 2026-10-20 → sin declarar on 2026-10-23
  '2026-08': [
    { estadoDeclaracionId: 10, estado: 'Guardada', folio: 0, declFechaCreacion: '05/09/2026' },
  ],
  '2026-07': [
    {
      estadoDeclaracionId: 70,
      estado: 'Rechazada por pago inconcluso',
      folio: 777,
      declFechaCreacion: '20/08/2026',
    },
  ],
  '2026-06': [vigente(555), { estadoDeclaracionId: 10, estado: 'Guardada', folio: 0 }], // filed → nothing
  '2026-05': [{ estadoDeclaracionId: 99, estado: 'Estado sintético', folio: null }],
};

const PETICIONES = encodeOk([
  {
    numero: 42,
    materiaGlosa: 'Materia sintética',
    estados: [
      {
        glosa: 'Peticion en espera de Antecedentes',
        fechaMs: new Date('2026-10-02T12:00:00Z').getTime(),
        nota: 'Falta un documento sintético.',
      },
    ],
  },
]);

interface Script {
  f29?: F29Script | 'empty';
  f22?: 'ok' | 'down';
  peticiones?: 'ok' | 'rate_limited';
  now?: Date;
  dead?: boolean;
  /** Mi SII `DatosCntrNow.contribuyente` extras (the F29 window and regime); none ⇒ no bounds. */
  regimen?: Record<string, string | null>;
  /** Mi SII `DatosCntrNow.atributos` (the account's SII registrations, #208). */
  atributos?: unknown;
  /** Mi SII answers a page without `DatosCntrNow` (a changed page, not a dead session). */
  miSiiSinDatos?: boolean;
  /** A non-SII error escapes a facade (a bug in our code). Peticiones' facade does not wrap
   *  seam errors (F22's turns any into an F22Error), so it is injected there. */
  bug?: boolean;
}

function makeRuntime(s: Script = {}): { rt: Runtime; calls: string[] } {
  const calls: string[] = [];
  const f29 = s.f29 ?? F29_MIXED;
  const rt: Runtime = {
    // Local time on purpose: the task reads "today" in local time, like the rest of the core.
    clock: new FixedClock(s.now ?? new Date(2026, 9, 23, 12)),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver({
      restoreSession: {
        cookies: { TOKEN: 't' },
        // The fake synthesises the Mi SII HTML (DatosCntrNow) from this for requestText(miSii).
        datos: () => ({
          contribuyente: { rut: 20000042, dv: '0', ...s.regimen },
          ...(s.atributos !== undefined && { atributos: s.atributos }),
        }),
        requestJson: (url: string, options?: JsonRequest) => {
          if (s.dead) throw new NotAuthenticatedError('Sesión expirada (sintético).');
          if (url.includes('buscaDeclVgte')) {
            calls.push('f22:decls');
            return s.f22 === 'down' ? F22_DOWN : BUSCA_ENV;
          }
          if (url.includes('situacionObservacion')) {
            calls.push('f22:obs');
            return OBS_ENV;
          }
          if (url.includes('getDeclaracionConEstados')) {
            const d = (options?.body as { data: { mes: string; anno: string } }).data;
            const key = `${d.anno}-${d.mes}`;
            calls.push(`f29:${key}`);
            const rows = f29 === 'empty' ? [] : (f29[key] ?? [vigente(100)]);
            return { metaData: { errors: null }, data: rows };
          }
          return { metaData: {}, data: null };
        },
        requestText: (url: string) => {
          if (!url.endsWith('/peticion')) {
            // Mi SII: the fake synthesises DatosCntrNow, unless the page lost it.
            return s.miSiiSinDatos ? '<html><body>Mi SII</body></html>' : undefined;
          }
          calls.push('peticiones');
          if (s.bug) throw new TypeError('bug sintético');
          if (s.peticiones === 'rate_limited')
            throw new RateLimitError('Demasiadas consultas (sintético).');
          return PETICIONES;
        },
      },
    }),
  };
  return { rt, calls };
}

async function seed(rt: Runtime): Promise<void> {
  await writeSession(rt.store, { rut: SELF, cookies: ['c'], savedAt: '2026-10-23T12:00:00Z' });
  await initOperateState(rt.store, {
    selfRut: SELF,
    accountType: 'persona',
    operable: [
      { rut: SELF, razonSocial: 'Juan Pérez', isSelf: true },
      { rut: EMPRESA, razonSocial: 'Mi Empresa SpA', isSelf: false },
    ],
  });
}

const byId = (as: readonly Alerta[]) => new Map(as.map((a) => [a.id, a]));
const entries = (rt: Runtime) => (rt.audit as RecordingAuditSink).entries;

describe('alertas (ADR-030; fakes, synthetic data, no SII)', () => {
  it('reads the three sources in one session and maps each alerta', async () => {
    const { rt } = makeRuntime();
    await seed(rt);
    const res = await alertas(rt);
    expect(res.rut).toBe(SELF);
    expect(res.incompleto).toBe(false);
    expect(res.fuentes).toEqual([
      { origen: 'f22', estado: 'ok' },
      { origen: 'f29', estado: 'ok' },
      { origen: 'peticiones', estado: 'ok' },
    ]);
    const ids = byId(res.alertas);
    // F22: the last 3 años tributarios (2026, 2025, 2024), one alerta per observación código.
    expect(ids.get('f22:2026:12345:B102')).toMatchObject({
      tipo: 'f22_observacion',
      anio: '2026',
      folio: '12345',
      codigo: 'B102',
      mensaje: 'Control ganancia de capital',
      url: 'http://www.sii.cl/B102.pdf',
      fecha: null,
    });
    expect(res.alertas.filter((a) => a.origen === 'f22')).toHaveLength(6);
    // F29, decided per período.
    expect(ids.get('f29:2026-09:sin_declarar')).toEqual({
      id: 'f29:2026-09:sin_declarar',
      tipo: 'f29_sin_declarar',
      origen: 'f29',
      periodo: '2026-09',
      anio: null,
      folio: null,
      peticion: null,
      codigo: null,
      estado: null,
      mensaje: null,
      url: null,
      fecha: '2026-10-20',
      vencimiento: { conPago: '2026-10-20', sinPago: '2026-10-28', estimado: true },
    });
    expect(ids.get('f29:2026-08:guardada')).toMatchObject({
      tipo: 'f29_guardada',
      estado: 'Guardada',
      folio: null, // a borrador's folio 0 is not a folio
      fecha: '2026-09-05',
    });
    expect(ids.get('f29:2026-07:rechazada:777')).toMatchObject({
      tipo: 'f29_rechazada',
      estado: 'Rechazada por pago inconcluso',
      folio: '777',
      fecha: '2026-08-20',
    });
    // An estado we never observed is surfaced, never dropped.
    expect(ids.get('f29:2026-05:otro_estado:99')).toMatchObject({
      tipo: 'f29_otro_estado',
      estado: 'Estado sintético',
    });
    // A período with a Vigente declaración raises nothing, even with an old borrador next to it.
    expect(res.alertas.some((a) => a.periodo === '2026-06')).toBe(false);
    // Peticiones: the latest transition, SII's note verbatim.
    const pet = res.alertas.find((a) => a.origen === 'peticiones')!;
    expect(pet).toMatchObject({
      tipo: 'peticion_estado',
      peticion: 42,
      estado: 'Peticion en espera de Antecedentes',
      mensaje: 'Falta un documento sintético.',
      fecha: '2026-10-02',
    });
    expect(pet.id).toMatch(/^peticion:42:2026-10-02T/);
  });

  it('ids are deterministic across runs', async () => {
    const a = makeRuntime();
    await seed(a.rt);
    const b = makeRuntime();
    await seed(b.rt);
    const ids = async (rt: Runtime) => (await alertas(rt)).alertas.map((x) => x.id);
    expect(await ids(a.rt)).toEqual(await ids(b.rt));
  });

  it('reads the 12 períodos before the current month, paced, and nothing else for f29', async () => {
    const { rt, calls } = makeRuntime();
    await seed(rt);
    await alertas(rt, { fuentes: 'f29' });
    expect(calls).toEqual(
      Array.from({ length: 12 }, (_, i) => {
        const d = new Date(2025, 9 + i, 1);
        return `f29:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }),
    );
    // One pause between consecutive requests: the Mi SII read, then 12 estados (ADR-004).
    expect((rt.clock as FixedClock).slept).toHaveLength(12);
  });

  it('a período is not "sin declarar" until its due date has passed', async () => {
    const on = makeRuntime({ now: new Date(2026, 9, 20, 23) }); // the due day itself
    await seed(on.rt);
    expect((await alertas(on.rt, { fuentes: 'f29' })).alertas.map((a) => a.id)).not.toContain(
      'f29:2026-09:sin_declarar',
    );
    const after = makeRuntime({ now: new Date(2026, 9, 21, 9) });
    await seed(after.rt);
    expect((await alertas(after.rt, { fuentes: 'f29' })).alertas.map((a) => a.id)).toContain(
      'f29:2026-09:sin_declarar',
    );
  });

  it('the due date moves off a weekend and December rolls into January', () => {
    // 2026-06-20 is a Saturday → Monday the 22nd.
    expect(vencimientoF29(Periodo.of(2026, 5)).conPago.getDate()).toBe(22);
    const dic = vencimientoF29(Periodo.of(2026, 12));
    expect([dic.conPago.getFullYear(), dic.conPago.getMonth(), dic.conPago.getDate()]).toEqual([
      2027, 0, 20,
    ]);
    expect(dic.sinPago.getDate()).toBe(28);
  });

  // Live 2026-10-23: an empresa with inicio de actividades in March got five "sin declarar"
  // for the months before it existed. Its own DatosCntrNow bounds the window.
  const NADA_HASTA_MARZO: F29Script = Object.fromEntries(
    ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02'].map((p) => [p, []]),
  );
  const sinDeclarar = async (s: Script) => {
    const { rt } = makeRuntime(s);
    await seed(rt);
    return (await alertas(rt, { fuentes: 'f29' })).alertas
      .filter((a) => a.tipo === 'f29_sin_declarar')
      .map((a) => a.periodo);
  };

  it('no sin_declarar before the month of inicio de actividades', async () => {
    expect(await sinDeclarar({ f29: NADA_HASTA_MARZO })).toEqual([
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(
      await sinDeclarar({
        f29: NADA_HASTA_MARZO,
        regimen: { fechaInicioActividades: '2026-03-26 00:00:00.0' },
      }),
    ).toEqual([]);
    // The inicio month itself is due.
    expect(
      await sinDeclarar({
        f29: NADA_HASTA_MARZO,
        regimen: { fechaInicioActividades: '2026-02-10 00:00:00.0' },
      }),
    ).toEqual(['2026-02']);
  });

  it('no sin_declarar after the month of término de giro', async () => {
    expect(await sinDeclarar({ regimen: { fechaTerminoGiro: '2026-06-30 00:00:00.0' } })).toEqual(
      [],
    );
    expect(await sinDeclarar({ regimen: { fechaTerminoGiro: null } })).toEqual(['2026-09']);
  });

  it('autorizadoDeclararDia20 picks the 20th or the 12th', async () => {
    const at = (day: number) => new Date(2026, 9, day, 12);
    // "N": due Monday 2026-10-12, so the 13th already alerts.
    expect(await sinDeclarar({ now: at(13), regimen: { autorizadoDeclararDia20: 'N' } })).toEqual([
      '2026-09',
    ]);
    // "S" (observed) and an unknown value keep the 20th: nothing on the 13th.
    expect(await sinDeclarar({ now: at(13), regimen: { autorizadoDeclararDia20: 'S' } })).toEqual(
      [],
    );
    expect(await sinDeclarar({ now: at(13), regimen: { autorizadoDeclararDia20: '?' } })).toEqual(
      [],
    );
    // A day-12 due date on a Sunday moves to Monday (2026-07-12 is a Sunday).
    expect(vencimientoF29(Periodo.of(2026, 6), 12).conPago.getDate()).toBe(13);
  });

  it('an account with no Vigente F29 in the window is no_declarante: no sin_declarar noise', async () => {
    const { rt } = makeRuntime({ f29: 'empty' });
    await seed(rt);
    const res = await alertas(rt, { fuentes: 'f29' });
    expect(res.fuentes.find((f) => f.origen === 'f29')).toEqual({
      origen: 'f29',
      estado: 'no_declarante',
    });
    expect(res.alertas).toEqual([]);
    expect(res.incompleto).toBe(false);
  });

  // #208: a new business that never filed has no Vigente F29 to prove it files. SII's own
  // primera-categoría regime atributo does, from the month of inicio de actividades.
  const atributo = (atrCodigo: string, extra: Record<string, unknown> = {}) => ({
    rut: 20000042,
    dv: '0',
    atrCodigo,
    fechaInicio: '10-08-2026',
    fechaTermino: null,
    eliminado: null,
    ...extra,
  });
  const NUEVA = { fechaInicioActividades: '2026-08-10 00:00:00.0' };
  const f29De = async (s: Script) => {
    const { rt } = makeRuntime({ f29: 'empty', ...s });
    await seed(rt);
    const res = await alertas(rt, { fuentes: 'f29' });
    return {
      estado: res.fuentes.find((f) => f.origen === 'f29')?.estado,
      sinDeclarar: res.alertas.filter((a) => a.tipo === 'f29_sin_declarar').map((a) => a.periodo),
    };
  };

  it('an account in a primera-categoría regime gets its first F29s from inicio (#208)', async () => {
    // 2026-08 due 2026-09-21 (the 20th is a Sunday), 2026-09 due 2026-10-20: both passed.
    expect(await f29De({ regimen: NUEVA, atributos: [atributo('14D1')] })).toEqual({
      estado: 'ok',
      sinDeclarar: ['2026-08', '2026-09'],
    });
  });

  it('the obligation starts at the later of inicio and the regime (#209 review)', async () => {
    // From honorarios (inicio long before the window) into Pro Pyme in August: nothing before.
    const antigua = { fechaInicioActividades: '2019-05-02 00:00:00.0' };
    expect(
      await f29De({
        regimen: antigua,
        atributos: [atributo('14D1', { fechaInicio: '15-08-2026' })],
      }),
    ).toEqual({ estado: 'ok', sinDeclarar: ['2026-08', '2026-09'] });
    // An established obligated account that filed nothing in the window owes every month,
    // sin movimiento included (FAQ 001_130_1053).
    const todo = await f29De({
      regimen: antigua,
      atributos: [atributo('14D1', { fechaInicio: '02-05-2019' })],
    });
    expect(todo.estado).toBe('ok');
    expect(todo.sinDeclarar).toHaveLength(12);
    expect(todo.sinDeclarar[0]).toBe('2025-10');
  });

  it('without a known active regime it falls back to no_declarante (#208)', async () => {
    const noDeclarante = { estado: 'no_declarante', sinDeclarar: [] };
    // A persona with only honorarios: an inicio de actividades, no regime atributo (observed).
    expect(
      await f29De({ regimen: NUEVA, atributos: [atributo('NOTI'), atributo('SGPE')] }),
    ).toEqual(noDeclarante);
    // An unobserved code is not guessed; an ended or deleted regime no longer obliges.
    expect(await f29De({ regimen: NUEVA, atributos: [atributo('14XX')] })).toEqual(noDeclarante);
    expect(
      await f29De({
        regimen: NUEVA,
        atributos: [atributo('14D1', { fechaTermino: '31-08-2026' })],
      }),
    ).toEqual(noDeclarante);
    expect(
      await f29De({ regimen: NUEVA, atributos: [atributo('14D1', { eliminado: 'S' })] }),
    ).toEqual(noDeclarante);
    // No inicio: no lower bound, so the regime alone would raise months before the account.
    expect(await f29De({ atributos: [atributo('14D1')] })).toEqual(noDeclarante);
    // An active regime whose start does not parse: when the obligation began is unknown.
    expect(
      await f29De({ regimen: NUEVA, atributos: [atributo('14D1', { fechaInicio: '2026-08-10' })] }),
    ).toEqual(noDeclarante);
    // No atributos at all, or a shape we do not know.
    expect(await f29De({ regimen: NUEVA })).toEqual(noDeclarante);
    expect(await f29De({ regimen: NUEVA, atributos: 'otra forma' })).toEqual(noDeclarante);
  });

  it('--fuentes reads only those, in canonical order, and reports the rest as omitted', async () => {
    const { rt, calls } = makeRuntime();
    await seed(rt);
    const res = await alertas(rt, { fuentes: ' Peticiones ,f22 ' });
    expect(calls.some((c) => c.startsWith('f29'))).toBe(false);
    expect(res.fuentes).toEqual([
      { origen: 'f22', estado: 'ok' },
      { origen: 'f29', estado: 'omitida' },
      { origen: 'peticiones', estado: 'ok' },
    ]);
    expect((await alertas(rt, { fuentes: ['f29'] })).fuentes[1]).toEqual({
      origen: 'f29',
      estado: 'ok',
    });
  });

  it('rejects an unknown or empty fuente and a bad --desde before opening a session', async () => {
    const { rt, calls } = makeRuntime();
    await seed(rt);
    await expect(alertas(rt, { fuentes: 'f22,tgr' })).rejects.toThrow(ValidationError);
    await expect(alertas(rt, { fuentes: ' , ' })).rejects.toThrow(ValidationError);
    await expect(alertas(rt, { desde: '2026-02-30' })).rejects.toThrow(ValidationError);
    await expect(alertas(rt, { desde: '23/10/2026' })).rejects.toThrow(ValidationError);
    expect(calls).toEqual([]);
  });

  it('--desde drops older dated alertas and keeps the undated ones', async () => {
    const { rt } = makeRuntime();
    await seed(rt);
    const res = await alertas(rt, { desde: '2026-09-01' });
    const ids = res.alertas.map((a) => a.id);
    expect(ids).toContain('f29:2026-09:sin_declarar'); // 2026-10-20
    expect(ids).toContain('f29:2026-08:guardada'); // 2026-09-05
    expect(ids).not.toContain('f29:2026-07:rechazada:777'); // 2026-08-20
    expect(ids).toContain('f22:2026:12345:B102'); // undated: kept
    expect(ids).toContain('f29:2026-05:otro_estado:99'); // undated: kept
  });

  it('a failing source is recorded with its kind and the others still run', async () => {
    const { rt } = makeRuntime({ f22: 'down' });
    await seed(rt);
    const res = await alertas(rt);
    expect(res.incompleto).toBe(true);
    expect(res.fuentes[0]).toEqual({
      origen: 'f22',
      estado: 'error',
      error: { type: 'sii_error', error: 'Servicio no disponible (sintético).' },
    });
    expect(res.fuentes.slice(1).map((f) => f.estado)).toEqual(['ok', 'ok']);
    expect(res.alertas.some((a) => a.origen === 'f29')).toBe(true);
    expect(entries(rt).find((e) => e.action === 'alertas')).toMatchObject({ result: 'partial' });
  });

  it('a Mi SII page without DatosCntrNow only loses the bounds: no window, the 20th', async () => {
    const { rt } = makeRuntime({ miSiiSinDatos: true, f29: NADA_HASTA_MARZO });
    await seed(rt);
    const res = await alertas(rt, { fuentes: 'f29' });
    expect(res.fuentes[1]).toEqual({ origen: 'f29', estado: 'ok' });
    const sd = res.alertas.filter((a) => a.tipo === 'f29_sin_declarar');
    expect(sd.map((a) => a.periodo)).toEqual([
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(sd[0]!.vencimiento?.conPago).toBe('2025-11-20');
  });

  it('a bug (not a SiiError) propagates instead of hiding as a source error', async () => {
    const { rt } = makeRuntime({ bug: true });
    await seed(rt);
    await expect(alertas(rt)).rejects.toThrow(TypeError);
    expect(entries(rt).find((e) => e.action === 'alertas')).toMatchObject({ result: 'failed' });
  });

  it('a dead session aborts the whole read', async () => {
    const { rt } = makeRuntime({ dead: true });
    await seed(rt);
    await expect(alertas(rt)).rejects.toThrow(NotAuthenticatedError);
    expect(entries(rt).find((e) => e.action === 'alertas')).toMatchObject({ result: 'failed' });
  });

  it("SII's rate limit aborts the read: no source is asked again against a block", async () => {
    const { rt } = makeRuntime({ peticiones: 'rate_limited' });
    await seed(rt);
    await expect(alertas(rt)).rejects.toThrow(RateLimitError);
  });

  it('refuses a representing operate pointer up front (session-keyed)', async () => {
    const { rt, calls } = makeRuntime();
    await seed(rt);
    await setOperatingRut(rt.store, EMPRESA);
    await expect(alertas(rt)).rejects.toThrow(/session-keyed/);
    expect(calls).toEqual([]);
  });

  it('with no session it raises NotAuthenticated', async () => {
    const { rt } = makeRuntime();
    await expect(alertas(rt)).rejects.toThrow(NotAuthenticatedError);
  });

  it('the audit receipt carries counts only, never SII text', async () => {
    const { rt } = makeRuntime();
    await seed(rt);
    const res = await alertas(rt);
    const e = entries(rt).find((x) => x.action === 'alertas')!;
    expect(e).toMatchObject({
      result: 'ok',
      rut: SELF,
      count: res.alertas.length,
      fuentes: { f22: 'ok', f29: 'ok', peticiones: 'ok' },
    });
    const blob = JSON.stringify(e);
    for (const text of ['ganancia de capital', 'Antecedentes', 'documento sintético', 'Guardada']) {
      expect(blob).not.toContain(text);
    }
  });
});
