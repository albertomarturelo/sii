import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { Runtime } from '../seams/index.js';
import { NotAuthenticatedError } from '../errors/index.js';
import { initOperateState, setOperatingRut } from '../identity/index.js';
import { writeSession } from '../auth/index.js';
import { f22Status, f22Overview } from './f22.js';

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
});
