// f29 submit (#161) over a FAKE chain: every branch of the task, with synthetic data (persona
// 20.000.042-0, empresa 77.777.777-7). The chain itself is tested in portal/f29-rfi.test.ts and,
// privately, byte for byte against the captures.
import { describe, expect, it } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import { writeSession } from '../auth/index.js';
import {
  F29Error,
  F29RechazoError,
  SessionExpiredError,
  ValidationError,
} from '../errors/index.js';
import { initOperateState, setOperatingRut } from '../identity/index.js';
import { Periodo } from '../periodo/index.js';
import type { F29Estado, F29Propuesta } from '../portal/f29.js';
import type { F29BorradorValidado } from '../portal/f29-rfi.js';
import type { Gwt7Node } from '../portal/gwt.js';
import type { Runtime } from '../seams/index.js';
import { type F29SubmitChain, f29SubmitTasks } from './f29-submit.js';

const f29SubmitPreview = (
  rt: Runtime,
  args: { periodo: string; sinMovimiento?: boolean },
  chain: F29SubmitChain,
) => f29SubmitTasks(chain).f29SubmitPreview(rt, args);
const f29Submit = (
  rt: Runtime,
  args: { periodo: string; total: number | string; sinMovimiento?: boolean },
  chain: F29SubmitChain,
) => f29SubmitTasks(chain).f29Submit(rt, args);

const SELF = '20000042-0';
const EMPRESA = '77777777-7';
const TOTAL = 125000;

const propuesta = (tiene = true): F29Propuesta => ({
  rut: SELF,
  periodo: '2026-10',
  tienePropuesta: tiene,
  tipoPropuesta: 40,
  estado: 0,
  descripcionEstado: null,
  codigos: tiene
    ? [
        { codigo: '538', valor: 190000 },
        { codigo: '511', valor: 65000 },
        { codigo: '91', valor: TOTAL },
      ]
    : [],
  codigosAdministrativos: [],
});
const estado = (rows: { estadoId: number; estado: string; folio: number }[] = []): F29Estado => ({
  rut: SELF,
  periodo: '2026-10',
  tieneDeclaracion: rows.length > 0,
  declaraciones: rows.map((r) => ({
    ...r,
    fecha: '20/11/2026',
    total: TOTAL,
    enNegocio: false,
    codigo: 1,
  })),
});
const BORRADOR: Gwt7Node = { cls: 'cl.sii.sdi.dim.rfi.to.Borrador', values: [] };
const validado = (over: Partial<F29BorradorValidado> = {}): F29BorradorValidado => ({
  borrador: BORRADOR,
  declarados: new Map([
    ['538', 190000],
    ['511', 65000],
    ['537', 65000],
    ['91', TOTAL],
  ]),
  total: TOTAL,
  campos: [
    { codigo: '538', valor: '190000', formula: false, numerico: true },
    { codigo: '511', valor: '65000', formula: false, numerico: true },
    { codigo: '537', valor: '65000', formula: true, numerico: true },
    { codigo: '91', valor: '125000', formula: true, numerico: true },
  ],
  textos: new Map(),
  ...over,
});

type Step = keyof F29SubmitChain;
function fakeChain(over: Partial<F29SubmitChain> = {}): { chain: F29SubmitChain; steps: Step[] } {
  const steps: Step[] = [];
  let filed = false;
  const base: F29SubmitChain = {
    // The months before 2026-10 are already filed (the sin movimiento route reads the previous).
    estado: (_s, p) =>
      Promise.resolve(
        filed || p.periodo.formatted !== '2026-10'
          ? estado([{ estadoId: 1, estado: 'Vigente', folio: 9001 }])
          : estado(),
      ),
    propuesta: () => Promise.resolve(propuesta()),
    validar: () => Promise.resolve(validado()),
    guardar: () => Promise.resolve(BORRADOR),
    inyectar: () => {
      filed = true;
      return Promise.resolve();
    },
    inicioActividades: () => Promise.resolve(null),
  };
  const merged = { ...base, ...over };
  const chain = Object.fromEntries(
    (Object.keys(merged) as Step[]).map((k) => [
      k,
      (...a: unknown[]) => {
        steps.push(k);
        return (merged[k] as (...x: unknown[]) => Promise<unknown>)(...a);
      },
    ]),
  ) as unknown as F29SubmitChain;
  return { chain, steps };
}

async function makeRuntime(): Promise<Runtime> {
  const rt: Runtime = {
    clock: new FixedClock(new Date('2026-11-05T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver({ restoreSession: { cookies: { TOKEN: 't' } } }),
  };
  await writeSession(rt.store, { rut: SELF, cookies: ['c'], savedAt: '2026-11-05T12:00:00Z' });
  await initOperateState(rt.store, {
    selfRut: SELF,
    accountType: 'persona',
    operable: [
      { rut: SELF, razonSocial: 'Persona', isSelf: true },
      { rut: EMPRESA, razonSocial: 'Empresa', isSelf: false },
    ],
  });
  return rt;
}
const audits = (rt: Runtime) => (rt.audit as RecordingAuditSink).entries;

describe('f29SubmitPreview', () => {
  it("returns the propuesta, what SII's formulas compute, SII's total, and no disagreement", async () => {
    const rt = await makeRuntime();
    const { chain, steps } = fakeChain();
    const p = await f29SubmitPreview(rt, { periodo: '2026-10' }, chain);
    expect(p).toMatchObject({
      rut: SELF,
      periodo: '2026-10',
      total: TOTAL,
      desacuerdos: [],
      listoParaPresentar: true,
      borradorGuardado: true,
    });
    expect(p.propuesta.debitos.map((l) => l.codigo)).toEqual(['538']);
    expect(p.calculados.map((l) => l.codigo)).toEqual(['91', '537']);
    expect(steps).toEqual(['estado', 'propuesta', 'validar']); // stops before guardar
    expect(audits(rt).at(-1)).toMatchObject({
      action: 'f29_submit_preview',
      result: 'ok',
      rut: SELF,
    });
    expect(JSON.stringify(audits(rt))).not.toContain(String(TOTAL));
  });

  it('reports every disagreement instead of hiding it', async () => {
    const rt = await makeRuntime();
    const { chain } = fakeChain({
      validar: () => Promise.resolve(validado({ declarados: new Map([['538', 190000]]) })),
    });
    const p = await f29SubmitPreview(rt, { periodo: '2026-10' }, chain);
    expect(p.listoParaPresentar).toBe(false);
    expect(p.desacuerdos).toEqual([
      { codigo: '91', motivo: 'falta' },
      { codigo: '511', motivo: 'falta' },
      { codigo: '537', motivo: 'falta' },
    ]);
  });

  it('refuses a late filing, where SII adds the recargo block, before saving (#235)', async () => {
    const rt = await makeRuntime();
    const late = (): Promise<F29BorradorValidado> =>
      Promise.resolve(
        validado({
          declarados: new Map([
            ['538', 190000],
            ['511', 65000],
            ['537', 65000],
            ['91', TOTAL],
            ['92', 1000],
            ['94', TOTAL + 1000],
          ]),
          textos: new Map([['922', 'X']]),
        }),
      );
    const preview = fakeChain({ validar: late });
    await expect(f29SubmitPreview(rt, { periodo: '2026-10' }, preview.chain)).rejects.toThrow(
      'SII agrega recargos a 2026-10 (códigos 92, 94, 922)',
    );
    expect(audits(rt).at(-1)).toMatchObject({ action: 'f29_submit_preview', result: 'refused' });
    const submit = fakeChain({ validar: late });
    await expect(f29Submit(rt, { periodo: '2026-10', total: TOTAL }, submit.chain)).rejects.toThrow(
      'el plazo legal para declararlo venció',
    );
    expect(submit.steps).not.toContain('guardar');
    expect(submit.steps).not.toContain('inyectar');
  });

  it('refuses a período with no propuesta, and one already Vigente', async () => {
    const rt = await makeRuntime();
    const none = fakeChain({ propuesta: () => Promise.resolve(propuesta(false)) });
    await expect(f29SubmitPreview(rt, { periodo: '2026-10' }, none.chain)).rejects.toThrow(
      'no tiene una propuesta',
    );
    expect(none.steps).not.toContain('validar');
    const vigente = fakeChain({
      estado: () => Promise.resolve(estado([{ estadoId: 1, estado: 'Vigente', folio: 77 }])),
    });
    await expect(f29SubmitPreview(rt, { periodo: '2026-10' }, vigente.chain)).rejects.toThrow(
      'rectificatoria',
    );
    expect(vigente.steps).toEqual(['estado']);
    expect(audits(rt).at(-1)).toMatchObject({ action: 'f29_submit_preview', result: 'refused' });
  });

  it('refuses while operating as an empresa, before any session', async () => {
    const rt = await makeRuntime();
    await setOperatingRut(rt.store, EMPRESA);
    const { chain, steps } = fakeChain();
    await expect(f29SubmitPreview(rt, { periodo: '2026-10' }, chain)).rejects.toThrow(
      'session-keyed',
    );
    expect(steps).toEqual([]);
  });
});

describe('sin movimiento (#221)', () => {
  // SYNTHETIC: SII validates every código at zero (the shape of run3, 2026-10-29).
  const nada = (): Promise<F29BorradorValidado> =>
    Promise.resolve(
      validado({
        declarados: new Map(),
        total: 0,
        campos: [{ codigo: '89', valor: '', formula: true, numerico: true }],
      }),
    );
  const sinMov = (over: Partial<F29SubmitChain> = {}) =>
    fakeChain({ propuesta: () => Promise.resolve(propuesta(false)), validar: nada, ...over });

  it('previews a período with no propuesta through the sin movimiento route', async () => {
    const rt = await makeRuntime();
    const rutas: string[] = [];
    const { chain, steps } = sinMov({
      validar: (_s, p) => {
        rutas.push(p.ruta);
        return nada();
      },
    });
    const p = await f29SubmitPreview(rt, { periodo: '2026-10', sinMovimiento: true }, chain);
    expect(p).toMatchObject({ total: 0, desacuerdos: [], listoParaPresentar: true });
    expect(rutas).toEqual(['sinMovimiento']);
    expect(steps).toEqual(['estado', 'estado', 'propuesta', 'validar']); // this month, the last
    expect(audits(rt).at(-1)).toMatchObject({
      action: 'f29_submit_preview',
      result: 'ok',
      ruta: 'sinMovimiento',
    });
  });

  it('refuses a período that has not ended, before any SII call', async () => {
    const rt = await makeRuntime(); // its clock reads 2026-11-05
    for (const periodo of ['2026-11', '2027-01']) {
      const { chain, steps } = sinMov();
      await expect(f29SubmitPreview(rt, { periodo, sinMovimiento: true }, chain)).rejects.toThrow(
        'todavía no termina',
      );
      expect(steps).toEqual([]);
    }
    expect(audits(rt).at(-1)).toMatchObject({ result: 'refused', ruta: 'sinMovimiento' });
  });

  it('requires the previous month filed, so no remanente is dropped', async () => {
    const rt = await makeRuntime();
    const sinAnterior = (inicio: string | null) =>
      sinMov({
        estado: () => Promise.resolve(estado()), // nothing filed, this month or the last
        inicioActividades: () => Promise.resolve(inicio === null ? null : Periodo.parse(inicio)),
      });
    // the previous month pending: refused before the propuesta is even read
    const pendiente = sinAnterior(null);
    await expect(
      f29SubmitPreview(rt, { periodo: '2026-10', sinMovimiento: true }, pendiente.chain),
    ).rejects.toThrow('El F29 de 2026-09 no está presentado');
    expect(pendiente.steps).toEqual(['estado', 'estado', 'inicioActividades']);
    // the first month of activity has no previous one to wait for
    const primero = sinAnterior('2026-10');
    await expect(
      f29SubmitPreview(rt, { periodo: '2026-10', sinMovimiento: true }, primero.chain),
    ).resolves.toMatchObject({ listoParaPresentar: true });
    // a month before the activity started has no F29 at all
    const antes = sinAnterior('2026-11');
    await expect(
      f29SubmitPreview(rt, { periodo: '2026-10', sinMovimiento: true }, antes.chain),
    ).rejects.toThrow('anterior al inicio de actividades');
  });

  it('refuses when SII has a propuesta, and points the plain route to the flag', async () => {
    const rt = await makeRuntime();
    const conPropuesta = fakeChain();
    await expect(
      f29SubmitPreview(rt, { periodo: '2026-10', sinMovimiento: true }, conPropuesta.chain),
    ).rejects.toThrow('SII tiene una propuesta de F29 para 2026-10');
    expect(conPropuesta.steps).not.toContain('validar');
    const vacio = fakeChain({ propuesta: () => Promise.resolve(propuesta(false)) });
    await expect(f29SubmitPreview(rt, { periodo: '2026-10' }, vacio.chain)).rejects.toThrow(
      '`sii f29 submit 2026-10 --sin-movimiento`',
    );
  });

  it('blocks any código SII declares with a value, even one a formula explains', async () => {
    const rt = await makeRuntime();
    const { chain } = sinMov({
      validar: () =>
        Promise.resolve(
          validado({
            declarados: new Map([['537', 65000]]),
            total: 0,
            campos: [{ codigo: '537', valor: '65000', formula: true, numerico: true }],
          }),
        ),
    });
    const p = await f29SubmitPreview(rt, { periodo: '2026-10', sinMovimiento: true }, chain);
    expect(p.desacuerdos).toEqual([{ codigo: '537', motivo: 'sobra' }]);
    expect(p.listoParaPresentar).toBe(false);
    const submit = sinMov({ validar: chain.validar });
    await expect(
      f29Submit(rt, { periodo: '2026-10', total: 0, sinMovimiento: true }, submit.chain),
    ).rejects.toThrow('no es sin movimiento');
    expect(submit.steps).not.toContain('guardar');
  });

  it('files with --confirm 0, saving on the sin movimiento route', async () => {
    const rt = await makeRuntime();
    const rutas: string[] = [];
    const { chain, steps } = sinMov({
      guardar: (_s, b, ruta) => {
        rutas.push(ruta);
        return Promise.resolve(b);
      },
    });
    const r = await f29Submit(rt, { periodo: '2026-10', total: 0, sinMovimiento: true }, chain);
    expect(r).toMatchObject({ total: 0, folio: 9001, estado: 'Vigente', pagoUrl: null });
    expect(rutas).toEqual(['sinMovimiento']);
    expect(steps).toEqual([
      'estado',
      'estado',
      'propuesta',
      'validar',
      'guardar',
      'inyectar',
      'estado',
    ]);
    expect(audits(rt).at(-1)).toMatchObject({ result: 'ok', ruta: 'sinMovimiento', folio: 9001 });
  });
});

describe('f29Submit', () => {
  it('re-runs the chain, saves, files once, and returns the folio', async () => {
    const rt = await makeRuntime();
    const { chain, steps } = fakeChain();
    const r = await f29Submit(rt, { periodo: '2026-10', total: '125.000' }, chain);
    expect(r).toEqual({
      rut: SELF,
      periodo: '2026-10',
      folio: 9001,
      total: TOTAL,
      estado: 'Vigente',
      pagoUrl: null,
    });
    expect(steps).toEqual(['estado', 'propuesta', 'validar', 'guardar', 'inyectar', 'estado']);
    const a = audits(rt).at(-1)!;
    expect(a).toMatchObject({ action: 'f29_submit', result: 'ok', rut: SELF, folio: 9001 });
    expect(Object.keys(a).sort()).toEqual(
      ['action', 'durationMs', 'folio', 'period', 'result', 'rut', 'ts'].sort(),
    );
  });

  it('refuses a total that is not SII’s, without saving or filing', async () => {
    const rt = await makeRuntime();
    const { chain, steps } = fakeChain();
    await expect(f29Submit(rt, { periodo: '2026-10', total: 125001 }, chain)).rejects.toThrow(
      ValidationError,
    );
    expect(steps).not.toContain('guardar');
    expect(audits(rt).at(-1)).toMatchObject({ action: 'f29_submit', result: 'refused' });
  });

  it('refuses on any disagreement, naming códigos and never amounts', async () => {
    const rt = await makeRuntime();
    const { chain, steps } = fakeChain({
      validar: () =>
        Promise.resolve(
          validado({
            declarados: new Map([
              ['538', 190000],
              ['511', 65000],
              ['91', TOTAL],
            ]),
          }),
        ),
    });
    const e = await f29Submit(rt, { periodo: '2026-10', total: TOTAL }, chain).catch((x) => x);
    expect(e).toBeInstanceOf(F29Error);
    expect((e as Error).message).toContain('537 (falta)');
    expect((e as Error).message).not.toContain('65000');
    expect(steps).not.toContain('guardar');
  });

  it('a malformed confirmation is a validation error before any session', async () => {
    const rt = await makeRuntime();
    const { chain, steps } = fakeChain();
    await expect(f29Submit(rt, { periodo: '2026-10', total: '-5' }, chain)).rejects.toThrow(
      ValidationError,
    );
    expect(steps).toEqual([]);
  });

  it.each(['estado', 'propuesta', 'validar', 'guardar'] as const)(
    'a SII error at %s surfaces verbatim and files nothing',
    async (step) => {
      const rt = await makeRuntime();
      const { chain, steps } = fakeChain({
        [step]: () => Promise.reject(new F29Error('SII rechazó la operación: X')),
      });
      await expect(f29Submit(rt, { periodo: '2026-10', total: TOTAL }, chain)).rejects.toThrow(
        'SII rechazó la operación: X',
      );
      expect(steps).not.toContain('inyectar');
    },
  );

  it('a session that dies mid-chain is session_expired and files nothing', async () => {
    const rt = await makeRuntime();
    const { chain, steps } = fakeChain({
      validar: () => Promise.reject(new SessionExpiredError('Sesión expirada')),
    });
    await expect(f29Submit(rt, { periodo: '2026-10', total: TOTAL }, chain)).rejects.toThrow(
      SessionExpiredError,
    );
    expect(steps).not.toContain('guardar');
  });

  it("SII's refusal of the filing is surfaced verbatim when its state shows nothing filed", async () => {
    const rt = await makeRuntime();
    const { chain, steps } = fakeChain({
      inyectar: () => Promise.reject(new F29RechazoError('SII rechazó la operación: Y')),
    });
    await expect(f29Submit(rt, { periodo: '2026-10', total: TOTAL }, chain)).rejects.toThrow(
      'SII rechazó la operación: Y',
    );
    expect(steps.filter((s) => s === 'inyectar')).toHaveLength(1); // never retried
  });

  it('a filing failure that is not SII refusing it is unconfirmed, never "nothing filed"', async () => {
    // e.g. SII filed but its answer could not be decoded: only a //EX proves no effect.
    const rt = await makeRuntime();
    const { chain, steps } = fakeChain({
      inyectar: () =>
        Promise.reject(new F29Error('No se pudo interpretar el formulario de SII (scraper roto)')),
    });
    const e = await f29Submit(rt, { periodo: '2026-10', total: TOTAL }, chain).catch((x) => x);
    expect((e as Error).message).toContain('NO lo vuelvas a enviar');
    expect(steps.filter((x) => x === 'inyectar')).toHaveLength(1);
    expect(audits(rt).at(-1)).toMatchObject({ action: 'f29_submit', result: 'unconfirmed' });
  });

  it('a lost answer after filing is resolved by reading SII, never by resending', async () => {
    const rt = await makeRuntime();
    let filed = false;
    const lost = fakeChain({
      inyectar: () => {
        filed = true;
        return Promise.reject(new Error('socket hang up'));
      },
      estado: () =>
        Promise.resolve(
          filed ? estado([{ estadoId: 1, estado: 'Vigente', folio: 9002 }]) : estado(),
        ),
    });
    const r = await f29Submit(rt, { periodo: '2026-10', total: TOTAL }, lost.chain);
    expect(r.folio).toBe(9002);
    expect(lost.steps.filter((s) => s === 'inyectar')).toHaveLength(1);

    const unknown = fakeChain({
      inyectar: () => Promise.reject(new Error('socket hang up')),
    });
    const e = await f29Submit(rt, { periodo: '2026-10', total: TOTAL }, unknown.chain).catch(
      (x) => x,
    );
    expect((e as Error).message).toContain('NO lo vuelvas a enviar');
    expect(unknown.steps.filter((s) => s === 'inyectar')).toHaveLength(1);
    expect(audits(rt).at(-1)).toMatchObject({ action: 'f29_submit', result: 'unconfirmed' });
  });
});
