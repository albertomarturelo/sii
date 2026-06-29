import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { Runtime } from '../seams/index.js';
import { F29Error, NotAuthenticatedError, ValidationError } from '../errors/index.js';
import { initOperateState, setOperatingRut } from '../identity/index.js';
import { writeSession } from '../auth/index.js';
import { f29Draft, f29Status } from './f29.js';

// Synthetic data (no SII, no real PII): persona 20.000.042-0, empresa 77.777.777-7.
const SELF = '20000042-0';
const EMPRESA = '77777777-7';

const PROPUESTA_ENV = {
  metaData: { errors: null },
  data: {
    tipopropuesta: 40,
    estado: 0,
    descripcionEstado: null,
    listCodPropuestos: [
      { codigo: '511', valor: '1097' },
      { codigo: '538', valor: '7482' },
    ],
    listCodAdministrativos: [{ codigo: '9114', valor: '1097' }],
    listCodBase: [{ codigo: '05', valor: 'PII NAME' }], // identity PII → must be dropped
    resultadoCalculoPP29: { traza: 'RUT[20000042] Periodo[202605]' }, // embeds RUT → dropped
  },
};
const ESTADO_ENV = {
  metaData: { errors: null },
  data: [
    {
      estadoDeclaracionId: 1,
      estado: 'Vigente',
      folio: 7654321,
      declFechaCreacion: '12/06/2026',
      monto: 999999, // financial PII → must be dropped
      enNegocio: false,
    },
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
          if (url.includes('getDeclaracionConCondicionesYTipoPropuesta')) return PROPUESTA_ENV;
          if (url.includes('getDeclaracionConEstados')) return ESTADO_ENV;
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

describe('f29 tasks (fakes, no SII)', () => {
  it('f29Draft reads the IVA propuesta for self, curates tax códigos (PII dropped), audits', async () => {
    const rt = makeRuntime();
    await seed(rt);

    const res = await f29Draft(rt, { periodo: '2026-05' });
    expect(res).toMatchObject({ rut: SELF, periodo: '2026-05', tienePropuesta: true });
    expect(res.codigos.map((c) => c.codigo)).toEqual(['511', '538']);
    expect(res.codigosAdministrativos.map((c) => c.codigo)).toEqual(['9114']);
    expect(JSON.stringify(res)).not.toContain('PII NAME'); // listCodBase never surfaces
    expect(JSON.stringify(res)).not.toContain('20000042]'); // the traza's RUT never surfaces
    expect(slept(rt)).toEqual([]); // single POST → no pacing
    expect(entries(rt).at(-1)).toMatchObject({
      action: 'f29_propuesta',
      result: 'ok',
      rut: SELF,
      period: '202605',
    });
  });

  it('f29Status reads the presented-F29 records for self (monto dropped), audits', async () => {
    const rt = makeRuntime();
    await seed(rt);

    const res = await f29Status(rt, { periodo: '2026-05' });
    expect(res).toMatchObject({ rut: SELF, periodo: '2026-05', tieneDeclaracion: true });
    expect(res.declaraciones[0]).toMatchObject({ estado: 'Vigente', folio: 7654321 });
    expect(JSON.stringify(res)).not.toContain('999999'); // monto never surfaces
    expect(entries(rt).at(-1)).toMatchObject({
      action: 'f29_estado',
      result: 'ok',
      rut: SELF,
      period: '202605',
    });
  });

  it('is session-keyed: a representing operate pointer is REJECTED up front (no session, no audit)', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await setOperatingRut(rt.store, EMPRESA); // pointer = empresa

    // Both verbs reject before any session/POST, with the actionable empresa RUT in the message.
    await expect(f29Draft(rt, { periodo: '2026-05' })).rejects.toBeInstanceOf(F29Error);
    await expect(f29Status(rt, { periodo: '2026-05' })).rejects.toThrow('77.777.777-7');
    // Rejected before withSession → no F29 audit receipt at all (not even a 'failed' one).
    expect(entries(rt).some((e) => String(e.action).startsWith('f29_'))).toBe(false);
    // The razón social is PII and must NOT leak into the message.
    await expect(f29Draft(rt, { periodo: '2026-05' })).rejects.not.toThrow('Mi Empresa SpA');
  });

  it('operating as self (pointer cleared) is allowed — reads self normally', async () => {
    const rt = makeRuntime();
    await seed(rt); // operatingRut defaults to self
    const res = await f29Draft(rt, { periodo: '2026-05' });
    expect(res.rut).toBe(SELF);
  });

  it('propuesta data:null → tienePropuesta false (clean "sin propuesta")', async () => {
    const rt: Runtime = {
      ...makeRuntime(),
      portal: new FakePortalDriver({
        restoreSession: {
          cookies: { TOKEN: 't' },
          requestJson: () => ({ metaData: { errors: null }, data: null }),
        },
      }),
    };
    await seed(rt);
    const res = await f29Draft(rt, { periodo: '2026-05' });
    expect(res).toMatchObject({ tienePropuesta: false });
    expect(res.codigos).toEqual([]);
  });

  it('estado data:[] → tieneDeclaracion false (clean "nada presentado")', async () => {
    const rt: Runtime = {
      ...makeRuntime(),
      portal: new FakePortalDriver({
        restoreSession: {
          cookies: { TOKEN: 't' },
          requestJson: () => ({ metaData: { errors: null }, data: [] }),
        },
      }),
    };
    await seed(rt);
    const res = await f29Status(rt, { periodo: '2026-05' });
    expect(res).toMatchObject({ tieneDeclaracion: false, declaraciones: [] });
  });

  it('no session → NotAuthenticated with a failed audit', async () => {
    const rt = makeRuntime(); // not seeded
    await expect(f29Draft(rt, { periodo: '2026-05' })).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
    expect(entries(rt).at(-1)).toMatchObject({ action: 'f29_propuesta', result: 'failed' });
  });

  it('a bad período fails fast (ValidationError) before any session/audit', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await expect(f29Draft(rt, { periodo: 'nope' })).rejects.toBeInstanceOf(ValidationError);
    expect(entries(rt).some((e) => String(e.action).startsWith('f29_'))).toBe(false);
  });
});
