import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
  inlineMapsPage,
} from '../adapters/fake/index.js';
import type { JsonRequest, Runtime } from '../seams/index.js';
import {
  BteError,
  NotAuthenticatedError,
  RateLimitError,
  ValidationError,
} from '../errors/index.js';
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
  regimen?: Record<string, unknown>;
  /** Mi SII `DatosCntrNow.atributos` (the account's SII registrations, #208). */
  atributos?: unknown;
  /** Mi SII answers a page without `DatosCntrNow` (a changed page, not a dead session). */
  miSiiSinDatos?: boolean;
  /** A non-SII error escapes a facade (a bug in our code). Peticiones' facade does not wrap
   *  seam errors (F22's turns any into an F22Error), so it is injected there. */
  bug?: boolean;
  /** Mi SII `opc=34` body (bienes raíces); default: no predios. */
  predios?: string;
  /** BTE emitidas month total `suma_retencion_emisor` per período (YYYY-MM); unlisted ⇒ 0.
   *  `sin_suma`: the informe lacks the total; `down`: SII's BTE error (#245). */
  bte?: Record<string, number | 'sin_suma' | 'down'>;
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
        requestForm: (url: string) => {
          if (s.dead) throw new NotAuthenticatedError('Sesión expirada (sintético).');
          if (url.includes('CViewCarta')) calls.push('bienes_raices');
          return s.predios ?? JSON.stringify({ data: null, metaData: { errors: null } });
        },
        requestText: (url: string) => {
          const bte = /cbanoinformemensual=(\d{4})&cbmesinformemensual=(\d{2})/.exec(url);
          if (bte) {
            const key = `${bte[1]}-${bte[2]}`;
            calls.push(`bte:${key}`);
            const suma = s.bte?.[key] ?? 0;
            if (suma === 'down') throw new BteError('Informe no disponible (sintético).');
            return inlineMapsPage({
              xml_values: {
                total_boletas: '1',
                ...(suma !== 'sin_suma' && { suma_retencion_emisor: suma }),
              },
              arr_informe_mensual: {},
            });
          }
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
  it('reads the four sources in one session and maps each alerta', async () => {
    const { rt } = makeRuntime();
    await seed(rt);
    const res = await alertas(rt);
    expect(res.rut).toBe(SELF);
    expect(res.incompleto).toBe(false);
    expect(res.fuentes).toEqual([
      { origen: 'f22', estado: 'ok' },
      { origen: 'f29', estado: 'ok' },
      { origen: 'peticiones', estado: 'ok' },
      { origen: 'bienes_raices', estado: 'ok' },
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

  // #245: segunda categoría owes F29 only in months whose issued boletas carry retención del
  // emisor. SII registers the category in SGPE's valor (observed text, synthetic account).
  const SEGUNDA = atributo('SGPE', {
    valor: 'Tipo contribuyente=1 y Categoría Contribuyente = 2',
  });
  const ANTIGUA = { fechaInicioActividades: '2019-05-02 00:00:00.0' };

  it('segunda categoría: sin declarar only in the months with retención del emisor (#245)', async () => {
    const { rt, calls } = makeRuntime({
      f29: 'empty',
      regimen: ANTIGUA,
      atributos: [atributo('NOTI'), SEGUNDA],
      bte: { '2026-07': 50000, '2026-09': 12500 },
    });
    await seed(rt);
    const res = await alertas(rt, { fuentes: 'f29' });
    expect(res.fuentes.find((f) => f.origen === 'f29')?.estado).toBe('ok');
    const sin = res.alertas.filter((a) => a.tipo === 'f29_sin_declarar');
    expect(sin.map((a) => a.periodo)).toEqual(['2026-07', '2026-09']);
    // Same id scheme and due date as any other sin declarar (ADR-030: ids never change).
    expect(sin[1]).toMatchObject({ id: 'f29:2026-09:sin_declarar', fecha: '2026-10-20' });
    // One BTE read per candidate período, after the twelve F29 reads.
    expect(calls.filter((c) => c.startsWith('bte:'))).toHaveLength(12);
    expect(calls.findIndex((c) => c.startsWith('bte:'))).toBeGreaterThan(
      calls.lastIndexOf('f29:2026-09'),
    );
  });

  it('segunda categoría: no retención del emisor in the window reads no_declarante (#245)', async () => {
    // Retención by the receptor, or a month with only anuladas, leaves SII's emisor total at 0.
    expect(await f29De({ regimen: ANTIGUA, atributos: [SEGUNDA], bte: { '2026-05': 0 } })).toEqual({
      estado: 'no_declarante',
      sinDeclarar: [],
    });
  });

  it('segunda categoría: a filed month does not make every other month due (#245)', async () => {
    // The activity rule would have raised the other eleven months here.
    const { rt, calls } = makeRuntime({
      f29: Object.fromEntries(
        [
          '2025-10',
          '2025-11',
          '2025-12',
          '2026-01',
          '2026-02',
          '2026-03',
          '2026-04',
          '2026-05',
          '2026-06',
          '2026-07',
          '2026-08',
        ].map((p) => [p, []]),
      ),
      regimen: ANTIGUA,
      atributos: [SEGUNDA],
    });
    await seed(rt);
    const res = await alertas(rt, { fuentes: 'f29' });
    expect(res.fuentes.find((f) => f.origen === 'f29')?.estado).toBe('ok');
    expect(res.alertas).toEqual([]);
    // 2026-09 is Vigente: never a candidate, so its boletas are not read.
    expect(calls).not.toContain('bte:2026-09');
  });

  it('segunda categoría: a BTE failure ends the F29 source as an error, never as not due (#245)', async () => {
    for (const bte of [{ '2026-09': 'down' as const }, { '2026-09': 'sin_suma' as const }]) {
      const { rt } = makeRuntime({
        f29: { ...F29_MIXED, '2026-09': [] },
        regimen: ANTIGUA,
        atributos: [SEGUNDA],
        bte,
      });
      await seed(rt);
      const res = await alertas(rt, { fuentes: 'f29' });
      expect(res.incompleto).toBe(true);
      expect(res.fuentes.find((f) => f.origen === 'f29')).toMatchObject({
        estado: 'error',
        error: { type: 'sii_error' },
      });
      // What the source read before the failure stays (ADR-030).
      expect(res.alertas.map((a) => a.tipo)).toContain('f29_rechazada');
      expect(res.alertas.some((a) => a.tipo === 'f29_sin_declarar')).toBe(false);
    }
  });

  it('segunda categoría as SII sends it over HTTP: the accent as three U+001A (#245)', async () => {
    // Observed live 2026-10-29: « Categor\u001a\u001a\u001aa », and two spaces before the « y ».
    const http = atributo('SGPE', {
      valor: 'Tipo contribuyente=1  y Categor\u001a\u001a\u001aa Contribuyente = 2',
    });
    expect(await f29De({ regimen: ANTIGUA, atributos: [http], bte: { '2026-09': 1000 } })).toEqual({
      estado: 'ok',
      sinDeclarar: ['2026-09'],
    });
  });

  it('only the exact segunda categoría counts; a primera-categoría regime wins (#245)', async () => {
    // « = 1 y 2 » or no valor is unknown: the activity rule stays, no BTE read.
    const ambas = atributo('SGPE', {
      valor: 'Tipo contribuyente=1 y Categoría Contribuyente = 1 y 2',
    });
    const { rt, calls } = makeRuntime({ f29: 'empty', regimen: ANTIGUA, atributos: [ambas] });
    await seed(rt);
    const res = await alertas(rt, { fuentes: 'f29' });
    expect(res.fuentes.find((f) => f.origen === 'f29')?.estado).toBe('no_declarante');
    expect(calls.some((c) => c.startsWith('bte:'))).toBe(false);
    // SGPE next to an active 14D1: every month is due, as #208 says.
    const conRegimen = await f29De({
      regimen: ANTIGUA,
      atributos: [SEGUNDA, atributo('14D1', { fechaInicio: '02-05-2019' })],
    });
    expect(conRegimen.sinDeclarar).toHaveLength(12);
  });

  it('a non-string window field reads as unknown, never as not obligated (#214)', async () => {
    // An unreadable inicio: no lower bound, so the regime alone does not raise anything.
    expect(
      await f29De({
        regimen: { fechaInicioActividades: 1786320000000 },
        atributos: [atributo('14D1')],
      }),
    ).toEqual({ estado: 'no_declarante', sinDeclarar: [] });
    // An unreadable término is no end; an unreadable day keeps the later 20th.
    expect(await sinDeclarar({ regimen: { fechaTerminoGiro: 1782777600000 } })).toEqual([
      '2026-09',
    ]);
    expect(
      await sinDeclarar({
        now: new Date(2026, 9, 13, 12),
        regimen: { autorizadoDeclararDia20: false },
      }),
    ).toEqual([]);
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
      { origen: 'bienes_raices', estado: 'omitida' },
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
    expect(res.fuentes.slice(1).map((f) => f.estado)).toEqual(['ok', 'ok', 'ok']);
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

describe('alertas — source bienes_raices (ADR-032; fakes, synthetic data, no SII)', () => {
  // "Today" is 2026-10-23 (makeRuntime's default): por vencer = due on or before 2026-11-22.
  const cuota = (n: number, condicion: string, fechaVencimiento: unknown, totalPago: unknown) => ({
    condicion,
    fechaVencimiento,
    agno: 2026,
    semestre: n <= 2 ? 1 : 2,
    cuota: n,
    totalPago,
  });
  const PREDIOS = JSON.stringify({
    data: {
      k: {
        descripcionComuna: 'COMUNA SINTETICA',
        comuna: 99001,
        manzana: 123,
        predio: 45,
        direccion: 'CALLE FALSA 123',
        destino: 'HABITACIONAL',
        propietario: false,
        rol: '123-45',
        cuotas: {
          a: cuota(2, 'VENCIDA', '30-06-2026', 45678),
          b: cuota(3, 'VIGENTE', '2026-11-22', '$ 41.234'), // the window's last day
          c: cuota(4, 'VIGENTE', '2026-11-23', 41234), // one day past it
          d: cuota(1, 'VIGENTE', 'sin fecha', null), // unreadable date: shown
        },
      },
    },
    metaData: { errors: null },
  });

  it('turns vencidas and cuotas due within 30 days into alertas with stable ids', async () => {
    const { rt, calls } = makeRuntime({ predios: PREDIOS });
    await seed(rt);
    const res = await alertas(rt, { fuentes: 'bienes_raices' });
    expect(calls).toEqual(['bienes_raices']);
    expect(res.fuentes.find((f) => f.origen === 'bienes_raices')).toEqual({
      origen: 'bienes_raices',
      estado: 'ok',
    });
    expect(res.alertas.map((a) => a.id)).toEqual([
      'bienes_raices:99001-123-45:2026-1-2:vencida',
      'bienes_raices:99001-123-45:2026-2-3:por_vencer',
      'bienes_raices:99001-123-45:2026-1-1:por_vencer',
    ]);
    expect(res.alertas[0]).toEqual({
      id: 'bienes_raices:99001-123-45:2026-1-2:vencida',
      tipo: 'contribuciones_vencida',
      origen: 'bienes_raices',
      periodo: null,
      anio: null,
      folio: null,
      peticion: null,
      codigo: null,
      estado: 'VENCIDA',
      mensaje: null,
      url: null,
      fecha: '2026-06-30',
      contribucion: { rol: '123-45', comuna: 'COMUNA SINTETICA', cuota: '2026-2', monto: 45678 },
    });
    expect(res.alertas[1]).toMatchObject({
      tipo: 'contribuciones_por_vencer',
      fecha: '2026-11-22',
      contribucion: { monto: 41234 },
    });
    expect(res.alertas[2]).toMatchObject({ tipo: 'contribuciones_por_vencer', fecha: null });
  });

  it('keeps the same ids on a second run, and --desde keeps future due dates', async () => {
    const { rt } = makeRuntime({ predios: PREDIOS });
    await seed(rt);
    const a = await alertas(rt, { fuentes: 'bienes_raices' });
    const b = await alertas(rt, { fuentes: 'bienes_raices', desde: '2026-10-01' });
    expect(b.alertas.map((x) => x.id)).toEqual(
      a.alertas.filter((x) => x.tipo === 'contribuciones_por_vencer').map((x) => x.id),
    );
  });

  it("records SII's error for this source and still returns the others", async () => {
    const { rt } = makeRuntime({
      predios: '{"codigoResp":-9,"glosaRespuesta":"Servicio no disponible (sintético)"}',
    });
    await seed(rt);
    const res = await alertas(rt);
    expect(res.incompleto).toBe(true);
    expect(res.fuentes[3]).toEqual({
      origen: 'bienes_raices',
      estado: 'error',
      error: { type: 'sii_error', error: 'Servicio no disponible (sintético)' },
    });
    expect(res.alertas.some((x) => x.origen === 'f29')).toBe(true);
  });

  it("aborts the whole read on Mi SII's missing-session answer", async () => {
    const { rt } = makeRuntime({
      predios: '{"codigoResp":-2, "glosaRespuesta":"Error: Autenticacion"}',
    });
    await seed(rt);
    await expect(alertas(rt)).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it('keeps the rol, address and amounts out of the audit', async () => {
    const { rt } = makeRuntime({ predios: PREDIOS });
    await seed(rt);
    await alertas(rt, { fuentes: 'bienes_raices' });
    const blob = JSON.stringify(entries(rt));
    for (const text of ['123-45', 'CALLE FALSA', 'COMUNA SINTETICA', '45678', '99001']) {
      expect(blob).not.toContain(text);
    }
  });
});
