import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { Runtime } from '../seams/index.js';
import { NotAuthenticatedError, ValidationError } from '../errors/index.js';
import { initOperateState } from '../identity/index.js';
import { writeSession } from '../auth/index.js';
import { peticionesList } from './peticiones.js';
import { encodeOk } from '../portal/__fixtures__/gwt-encode.js';

// Synthetic data (no SII, no real PII): persona 20.000.042-0, empresa 77.777.777-7.
const SELF = '20000042-0';
const EMPRESA = '77777777-7';

const OK = encodeOk([
  {
    numero: 42,
    materiaGlosa: 'Materia sintética',
    estados: [
      {
        glosa: 'Peticion en espera de Antecedentes',
        fechaMs: new Date('2026-02-01T12:00:00Z').getTime(),
        nota: 'Falta un documento sintético.',
      },
    ],
  },
]);

function makeRuntime(): Runtime {
  return {
    clock: new FixedClock(new Date('2026-06-27T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver({
      restoreSession: {
        requestText: (url) => (url.endsWith('/peticion') ? OK : ''),
        cookies: { TOKEN: 't' },
      },
    }),
  };
}

async function seed(runtime: Runtime): Promise<void> {
  await writeSession(runtime.store, { rut: SELF, cookies: ['c'], savedAt: '2026-06-27T12:00:00Z' });
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

describe('peticiones task (fakes, no SII)', () => {
  it('acquires a session, reads as self, returns curated petitions', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const res = await peticionesList(rt);
    expect(res.rut).toBe(SELF);
    expect(res.peticiones).toHaveLength(1);
    expect(res.peticiones[0]!.estadoActual).toBe('Peticion en espera de Antecedentes');
  });

  it('audits the read with rut + count ONLY — never petition contents (PII)', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await peticionesList(rt);
    const e = entries(rt).find((x) => x.action === 'peticiones_list' && x.result === 'ok')!;
    expect(e).toMatchObject({ rut: SELF, count: 1 });
    // no materia / estado / mensaje / razonSocial anywhere in the audit line
    const blob = JSON.stringify(e);
    expect(blob).not.toContain('Materia sintética');
    expect(blob).not.toContain('espera de Antecedentes');
    expect(blob).not.toContain('documento');
  });

  it('is body-RUT: --rut reaches a represented empresa and records rutAuth', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const res = await peticionesList(rt, { rut: EMPRESA });
    expect(res.rut).toBe(EMPRESA);
    const e = entries(rt).find((x) => x.result === 'ok')!;
    expect(e).toMatchObject({ rut: EMPRESA, rutAuth: SELF });
  });

  it('rejects a --rut outside the operable set (ValidationError)', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await expect(peticionesList(rt, { rut: '11111111-1' })).rejects.toThrow(ValidationError);
  });

  it('raises NotAuthenticated when there is no session', async () => {
    const rt = makeRuntime();
    await expect(peticionesList(rt)).rejects.toThrow(NotAuthenticatedError);
  });
});
