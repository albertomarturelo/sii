import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { Runtime } from '../seams/index.js';
import { BienesRaicesError, NotAuthenticatedError } from '../errors/index.js';
import { initOperateState, setOperatingRut } from '../identity/index.js';
import { writeSession } from '../auth/index.js';
import { bienesRaicesList } from './bienes-raices.js';

// Synthetic data (no SII, no real PII): persona 20.000.042-0, empresa 77.777.777-7.
const SELF = '20000042-0';
const EMPRESA = '77777777-7';

const cuota = (condicion: string, n: number, totalPago: number) => ({
  condicion,
  fechaVencimiento: '2026-11-30',
  agno: 2026,
  semestre: 2,
  cuota: n,
  totalPago,
});
const BODY = JSON.stringify({
  data: {
    a: {
      descripcionComuna: 'COMUNA SINTETICA',
      comuna: 99001,
      manzana: 1,
      predio: 2,
      direccion: 'CALLE FALSA 123',
      destino: 'HABITACIONAL',
      propietario: true,
      cuotas: { x: cuota('VENCIDA', 3, 100), y: cuota('VIGENTE', 4, 200) },
      rol: '1-2',
    },
    b: {
      descripcionComuna: 'COMUNA SINTETICA',
      comuna: 99001,
      manzana: 5,
      predio: 6,
      cuotas: { z: cuota('VENCIDA', 3, 300) },
      rol: '5-6',
    },
  },
  metaData: { errors: null },
});

function makeRuntime(forms: string[] = []): Runtime {
  return {
    clock: new FixedClock(new Date(2026, 9, 28, 12)),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver({
      restoreSession: {
        cookies: { TOKEN: 't' },
        requestForm: (url) => {
          forms.push(url);
          return BODY;
        },
      },
    }),
  };
}

async function seed(rt: Runtime): Promise<void> {
  await writeSession(rt.store, { rut: SELF, cookies: ['c'], savedAt: '2026-10-28T12:00:00Z' });
  await initOperateState(rt.store, {
    selfRut: SELF,
    accountType: 'persona',
    operable: [
      { rut: SELF, razonSocial: 'Persona Sintética', isSelf: true },
      { rut: EMPRESA, razonSocial: 'Empresa Sintética SpA', isSelf: false },
    ],
  });
}

const entries = (rt: Runtime) => (rt.audit as RecordingAuditSink).entries;

describe('bienesRaicesList (ADR-032; fakes, synthetic data, no SII)', () => {
  it('returns the predios of the session principal with the cuota totals', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const r = await bienesRaicesList(rt);
    expect(r.rut).toBe(SELF);
    expect(r.predios.map((p) => p.rol)).toEqual(['1-2', '5-6']);
    expect(r.cuotasVencidas).toBe(2);
    expect(r.cuotasVigentes).toBe(1);
  });

  it('audits the read with counts only — no rol, address or amount', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await bienesRaicesList(rt);
    const [e] = entries(rt);
    expect(e).toMatchObject({ action: 'bienes_raices_list', result: 'ok', rut: SELF, count: 2 });
    const line = JSON.stringify(e);
    for (const leak of ['1-2', 'CALLE FALSA', '99001', 'COMUNA']) {
      expect(line).not.toContain(leak);
    }
  });

  it('refuses a representing pointer before contacting SII (session-keyed)', async () => {
    const forms: string[] = [];
    const rt = makeRuntime(forms);
    await seed(rt);
    await setOperatingRut(rt.store, EMPRESA);
    await expect(bienesRaicesList(rt)).rejects.toBeInstanceOf(BienesRaicesError);
    expect(forms).toEqual([]);
  });

  it('requires a session (NotAuthenticated) and audits the failure', async () => {
    const rt = makeRuntime();
    await expect(bienesRaicesList(rt)).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(entries(rt)).toEqual([
      expect.objectContaining({ action: 'bienes_raices_list', result: 'failed' }),
    ]);
  });
});
