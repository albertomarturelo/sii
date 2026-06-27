import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index';
import type { Runtime } from '../seams/index';
import { initOperateState } from '../identity/index';
import { operate, operateSelf, operatingStatus } from './operate';

function makeRuntime(): Runtime {
  return {
    clock: new FixedClock(new Date('2026-06-27T00:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver(),
  };
}

async function seedPersona(runtime: Runtime): Promise<void> {
  await initOperateState(runtime.store, {
    selfRut: '20000042-0',
    accountType: 'persona',
    operable: [
      { rut: '20000042-0', razonSocial: 'Juan Pérez', isSelf: true },
      { rut: '78362507-5', razonSocial: 'Mi Empresa SpA', isSelf: false },
    ],
  });
}

describe('operate task', () => {
  it('switches + audits rutAuth, never logs razón social (PII)', async () => {
    const rt = makeRuntime();
    await seedPersona(rt);
    const res = await operate(rt, '78.362.507-5');
    expect(res.context.operatingRut).toBe('78362507-5');

    const entry = (rt.audit as RecordingAuditSink).entries[0]!;
    expect(entry.action).toBe('operate');
    expect(entry.rut).toBe('78362507-5');
    expect(entry.rutAuth).toBe('20000042-0');
    expect(JSON.stringify(entry)).not.toContain('Mi Empresa');
  });

  it('operateSelf returns to self', async () => {
    const rt = makeRuntime();
    await seedPersona(rt);
    await operate(rt, '78362507-5');
    const res = await operateSelf(rt);
    expect(res.context.isSelf).toBe(true);
    expect((await operatingStatus(rt))?.isSelf).toBe(true);
  });
});
