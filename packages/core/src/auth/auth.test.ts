import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { Runtime } from '../seams/index.js';
import { HOSTS } from '../config/index.js';
import { LoginFailedError, NotAuthenticatedError } from '../errors/index.js';
import { localStatus, login, logout, readSession, statusRefresh } from './auth.js';
import { readOperateState } from '../identity/index.js';

function personaDatos(): unknown {
  return { contribuyente: { rut: 20000042, dv: '0', nombres: 'Juan', apellidoPaterno: 'Pérez' } };
}

function makeRuntime(driver: FakePortalDriver): Runtime {
  return {
    clock: new FixedClock(new Date('2026-06-27T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: driver,
  };
}

const successDriver = (): FakePortalDriver =>
  new FakePortalDriver({
    loginSession: {
      landingUrl: HOSTS.miSii,
      evaluate: (e) => (e.includes('DatosCntrNow') ? personaDatos() : null),
      storageState: { cookies: ['c'] },
    },
  });

describe('auth', () => {
  it('browser login persists a cookies-only session + defaults operate to self', async () => {
    const rt = makeRuntime(successDriver());
    const res = await login(rt);
    expect(res).toMatchObject({ authenticated: true, rut: '20000042-0', reason: 'browser_login' });
    expect((await readSession(rt.store))?.rut).toBe('20000042-0');
    const op = await readOperateState(rt.store);
    expect(op?.operatingRut).toBe('20000042-0');
    expect(op?.accountType).toBe('persona');
  });

  it('login still on the auth page raises LoginFailedError, writes no session', async () => {
    const rt = makeRuntime(
      new FakePortalDriver({ loginSession: { landingUrl: 'https://zeusr.sii.cl/AUT2000/x' } }),
    );
    await expect(login(rt)).rejects.toBeInstanceOf(LoginFailedError);
    expect(await readSession(rt.store)).toBeNull();
  });

  it('login propagates a driver failure (timeout / window closed), no session', async () => {
    const rt = makeRuntime(
      new FakePortalDriver({ failLogin: new LoginFailedError('window closed') }),
    );
    await expect(login(rt)).rejects.toBeInstanceOf(LoginFailedError);
    expect(await readSession(rt.store)).toBeNull();
  });

  it('localStatus reflects the cached jar without a portal call', async () => {
    const rt = makeRuntime(successDriver());
    expect(await localStatus(rt.store)).toMatchObject({
      authenticated: false,
      sessionSource: 'none',
    });
    await login(rt);
    expect(await localStatus(rt.store)).toMatchObject({
      authenticated: true,
      rut: '20000042-0',
      sessionSource: 'cached',
    });
  });

  it('logout wipes local session + operate, best-effort server close', async () => {
    const rt = makeRuntime(
      new FakePortalDriver({
        loginSession: {
          landingUrl: HOSTS.miSii,
          evaluate: (e) => (e.includes('DatosCntrNow') ? personaDatos() : null),
          storageState: {},
        },
        restoreSession: { landingUrl: 'https://www.sii.cl//' },
      }),
    );
    await login(rt);
    const res = await logout(rt);
    expect(res).toMatchObject({ loggedOut: true, serverClosed: true });
    expect(await readSession(rt.store)).toBeNull();
    expect(await readOperateState(rt.store)).toBeNull();
  });

  it('statusRefresh requires a session', async () => {
    const rt = makeRuntime(new FakePortalDriver({}));
    await expect(statusRefresh(rt)).rejects.toBeInstanceOf(NotAuthenticatedError);
  });
});
