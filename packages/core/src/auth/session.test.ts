import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FakePortalSession,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { PortalSession, Runtime } from '../seams/index.js';
import { NotAuthenticatedError } from '../errors/index.js';
import { initOperateState } from '../identity/index.js';
import { withSession, writeSession } from './session.js';

// Synthetic, Mod-11-valid RUTs (CONVENTIONS): persona 20.000.042-0, empresa 78.362.507-5.
const SELF = '20000042-0';
const EMPRESA = '78362507-5';

/** A driver that hands out — and remembers — the sessions it restores, so a test
 *  can assert each one was closed. */
class TrackingDriver extends FakePortalDriver {
  readonly sessions: FakePortalSession[] = [];
  override async restore(): Promise<PortalSession> {
    this.restoreCalls++;
    const s = new FakePortalSession();
    this.sessions.push(s);
    return s;
  }
}

function makeRuntime(driver: FakePortalDriver): Runtime {
  return {
    clock: new FixedClock(new Date('2026-06-27T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: driver,
  };
}

/** Seed a persisted session + operate state (operating as self) without a login. */
async function seedSession(runtime: Runtime): Promise<void> {
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

describe('withSession (session-acquisition primitive)', () => {
  it('raises NotAuthenticated when there is no stored session — fn never runs, no restore', async () => {
    const rt = makeRuntime(new FakePortalDriver());
    let ran = false;
    await expect(
      withSession(rt, async () => {
        ran = true;
      }),
    ).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(ran).toBe(false);
    expect(rt.portal.restoreCalls).toBe(0);
  });

  it('restores a live session and hands fn the session + the resolved RUT (self by default)', async () => {
    const rt = makeRuntime(new FakePortalDriver({ restoreSession: {} }));
    await seedSession(rt);

    const ctx = await withSession(rt, async (session, c) => {
      expect(session).toBeInstanceOf(FakePortalSession);
      return c;
    });
    expect(ctx).toEqual({ sessionRut: SELF, operatingRut: SELF });
    expect(rt.portal.restoreCalls).toBe(1);
  });

  it('resolves operatingRut by precedence: --rut override > pointer > self', async () => {
    const rt = makeRuntime(new FakePortalDriver({ restoreSession: {} }));
    await seedSession(rt);

    // Override wins (a represented empresa in the operable set).
    const overridden = await withSession(rt, async (_s, c) => c, { rut: EMPRESA });
    expect(overridden.operatingRut).toBe(EMPRESA);

    // No override → the operate pointer (here still self) is used.
    const pointer = await withSession(rt, async (_s, c) => c);
    expect(pointer.operatingRut).toBe(SELF);
  });

  it('always closes the session — when fn resolves AND when fn throws', async () => {
    const driver = new TrackingDriver();
    const rt = makeRuntime(driver);
    await seedSession(rt);

    await withSession(rt, async () => 'ok');
    await expect(
      withSession(rt, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(driver.sessions).toHaveLength(2);
    expect(driver.sessions.every((s) => s.closed)).toBe(true); // closed in finally, both paths
  });
});
