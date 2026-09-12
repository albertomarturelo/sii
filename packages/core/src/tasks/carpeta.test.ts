import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { Runtime } from '../seams/index.js';
import { CarpetaError, NotAuthenticatedError } from '../errors/index.js';
import { initOperateState, setOperatingRut } from '../identity/index.js';
import { writeSession } from '../auth/index.js';
import { carpetaInstituciones } from './carpeta.js';

// Synthetic data (no SII, no real PII): persona 20.000.042-0, empresa 77.777.777-7.
const SELF = '20000042-0';
const EMPRESA = '77777777-7';
const BLANK = { tipo: null, rut: null, vigenteDesde: null, vigenteHasta: null };
const LIST = [
  { enfinCodigo: '001', enfinDescripcion: 'Banco Sintético Uno', enfinAbreviacion: 'BSU' },
  { enfinCodigo: '042', enfinDescripcion: 'Cooperativa de Prueba', enfinAbreviacion: 'CDP' },
];

function makeRuntime(): Runtime & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    clock: new FixedClock(new Date('2026-09-11T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver({
      restoreSession: {
        requestText: (url) => {
          calls.push(url);
          return JSON.stringify({ userId: SELF, userAuthType: 'CT' });
        },
        requestJson: (url) => {
          calls.push(url);
          return url.endsWith('/instituciones') ? LIST : null;
        },
      },
    }),
  };
}

async function seed(runtime: Runtime): Promise<void> {
  await writeSession(runtime.store, { rut: SELF, cookies: ['c'], savedAt: '2026-09-11T12:00:00Z' });
  await initOperateState(runtime.store, {
    selfRut: SELF,
    accountType: 'persona',
    operable: [
      { rut: SELF, razonSocial: 'Juan Pérez', isSelf: true },
      { rut: EMPRESA, razonSocial: 'Mi Empresa SpA', isSelf: false },
    ],
  });
}

const entries = (rt: Runtime) => (rt.audit as RecordingAuditSink).entries;

describe('carpeta instituciones task (fakes, no SII)', () => {
  it('reads the www2 app session, then the live list keyed by its userId, and returns curated rows', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const res = await carpetaInstituciones(rt);
    expect(res).toEqual([
      { codigo: '001', descripcion: 'Banco Sintético Uno', abreviacion: 'BSU', ...BLANK },
      { codigo: '042', descripcion: 'Cooperativa de Prueba', abreviacion: 'CDP', ...BLANK },
    ]);
    // the app-session read first, then the cte-api read keyed by its userId
    expect(rt.calls[0]).toContain('/app/session/status?originalUrl=');
    expect(rt.calls[1]).toContain(`/cte-api-carpetatributaria/${SELF}/`);
  });

  it('audits rut + count only (public catalog rows, no PII either way)', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await carpetaInstituciones(rt);
    const e = entries(rt).find((x) => x.action === 'carpeta_instituciones' && x.result === 'ok')!;
    expect(e).toMatchObject({ rut: SELF, count: 2 });
    expect(JSON.stringify(e)).not.toContain('Banco Sintético');
  });

  it('is session-keyed: rejects a representing operate pointer BEFORE opening a session', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await setOperatingRut(rt.store, EMPRESA);
    await expect(carpetaInstituciones(rt)).rejects.toThrow(CarpetaError);
    await expect(carpetaInstituciones(rt)).rejects.toThrow(/session-keyed/);
    expect(rt.portal instanceof FakePortalDriver && rt.portal.restoreCalls).toBe(0);
    expect(entries(rt).every((x) => x.result === 'failed')).toBe(true);
  });

  it('surfaces the www2 app-session gap actionably (401 on /app/session/status, no cte-api call)', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const blocked: Runtime = {
      ...rt, // same seeded store; www2 has no app session for this jar
      portal: new FakePortalDriver({
        restoreSession: {
          requestText: () => ({ status: 401, body: '' }),
          requestJson: () => {
            throw new Error('must not be called');
          },
        },
      }),
    };
    await expect(carpetaInstituciones(blocked)).rejects.toThrow(/plataforma www2/);
    expect(entries(blocked).some((x) => x.result === 'failed')).toBe(true);
  });

  it('raises NotAuthenticated when there is no session', async () => {
    const rt = makeRuntime();
    await expect(carpetaInstituciones(rt)).rejects.toThrow(NotAuthenticatedError);
  });
});
