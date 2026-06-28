import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FakePortalSession,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { PortalSession, Runtime } from '../seams/index.js';
import { NotAuthenticatedError, ValidationError } from '../errors/index.js';
import { initOperateState, setOperatingRut } from '../identity/index.js';
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

  it('no override → uses the operate pointer (self by default, or a selected empresa)', async () => {
    const rt = makeRuntime(new FakePortalDriver({ restoreSession: {} }));
    await seedSession(rt);

    // Default pointer is self.
    expect((await withSession(rt, async (_s, c) => c)).operatingRut).toBe(SELF);
    // Point at a represented empresa → no-override resolves to it (the MIDDLE tier).
    await setOperatingRut(rt.store, EMPRESA);
    expect((await withSession(rt, async (_s, c) => c)).operatingRut).toBe(EMPRESA);
  });

  it('--rut override beats the pointer and is validated against the operable set', async () => {
    const rt = makeRuntime(new FakePortalDriver({ restoreSession: {} }));
    await seedSession(rt);
    await setOperatingRut(rt.store, EMPRESA); // pointer = empresa

    // Override back to self wins over the pointer.
    expect((await withSession(rt, async (_s, c) => c, { rut: SELF })).operatingRut).toBe(SELF);

    // A valid RUT OUTSIDE the operable set is rejected LOCALLY (never sent to SII).
    await expect(withSession(rt, async (_s, c) => c, { rut: '12345670-K' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(rt.portal.restoreCalls).toBe(1); // only the successful override restored
  });

  it('an empresa account cannot override --rut to another RUT (no operate capability)', async () => {
    const rt = makeRuntime(new FakePortalDriver({ restoreSession: {} }));
    await writeSession(rt.store, { rut: EMPRESA, cookies: ['c'], savedAt: '2026-06-27T12:00:00Z' });
    await initOperateState(rt.store, {
      selfRut: EMPRESA,
      accountType: 'empresa',
      operable: [{ rut: EMPRESA, razonSocial: 'Mi Empresa SpA', isSelf: true }],
    });
    await expect(withSession(rt, async (_s, c) => c, { rut: SELF })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('an override with a session but no operate state → NotAuthenticated (broken state)', async () => {
    const rt = makeRuntime(new FakePortalDriver({ restoreSession: {} }));
    await writeSession(rt.store, { rut: SELF, cookies: ['c'], savedAt: '2026-06-27T12:00:00Z' });
    // No initOperateState — an override cannot be validated, so reject (re-login).
    await expect(withSession(rt, async (_s, c) => c, { rut: EMPRESA })).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
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
