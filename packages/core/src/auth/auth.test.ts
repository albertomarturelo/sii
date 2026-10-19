import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  InMemorySecretStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { Runtime } from '../seams/index.js';
import { HOSTS, LOGIN_URL, LOGOUT_URL, WWW2_SESSION_CLOSE_URL } from '../config/index.js';
import {
  CredentialNotFoundError,
  LoginBlockedError,
  LoginFailedError,
  LoginQueuedError,
  NotAuthenticatedError,
  SessionExpiredError,
  UnexpectedResponseError,
  ValidationError,
} from '../errors/index.js';
import {
  consoleLogin,
  keyringLogin,
  localStatus,
  login,
  logout,
  statusRefresh,
  suppliedClaveLogin,
  unblockLogin,
  whoami,
} from './auth.js';
import { readLoginBlock, tripLoginBlock } from './login-block.js';
import { WRONG_CLAVE_CODIGO } from './login-error.js';
import { readSession, writeSession } from './session.js';
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
    // The headed `login` runs on the browser engine (ADR-027); console/keyring + reads use
    // `portal`. The same fake driver backs both, so a test's scripted session serves whichever.
    browser: driver,
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

// A login session that ALSO completes the www2 OAuth step (ADR-026): its storageState grows the
// www2 cookie after the (scripted) OAuth navigation, and /app/session/status then answers a
// session JSON. Synthetic cookies + expiry (no SII, no PII).
const WWW2_EXPIRES = 1_789_006_000; // epoch s
function www2Driver(): FakePortalDriver {
  let www2Done = false;
  return new FakePortalDriver({
    loginSession: {
      landingUrl: HOSTS.miSii,
      evaluate: (e) => (e.includes('DatosCntrNow') ? personaDatos() : null),
      // classic cookies before the www2 step; +X-SII-STATE-CT after it (the OAuth page also wipes
      // the classic ones from the real context — the merge is what puts them back)
      storageState: () =>
        www2Done
          ? {
              cookies: [
                { name: 'X-SII-STATE-CT', domain: '.sii.cl', path: '/', expires: WWW2_EXPIRES },
              ],
            }
          : { cookies: [{ name: 'TOKEN', domain: '.sii.cl', path: '/', value: 'c' }] },
      // Only /app/session/status is scripted; `undefined` for Mi SII lets the fake synthesise
      // the identity HTML from `evaluate` (ADR-027 reads identity from HTML, not `evaluate`).
      requestText: (url: string) => {
        if (!url.includes('/app/session/status')) return undefined;
        if (!www2Done) {
          www2Done = true; // first status read after goto = still logging in
          return { status: 401, body: '' };
        }
        return JSON.stringify({ userId: '20000042-0', userAuthType: 'CT', seconds: 5999 });
      },
    },
    // the warm-session probe (restore) mirrors the state: once the www2 step ran, /app/session/
    // status answers there too (so statusRefresh sees the layer live).
    restoreSession: {
      landingUrl: HOSTS.miSii,
      evaluate: (e) => (e.includes('DatosCntrNow') ? personaDatos() : null),
      requestText: (url: string) =>
        !url.includes('/app/session/status')
          ? undefined
          : www2Done
            ? JSON.stringify({ userId: '20000042-0', userAuthType: 'CT', seconds: 5999 })
            : ({ status: 401, body: '' } as const),
    },
  });
}

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

  it('login --www2 mints both layers: classic cookies kept + the www2 cookie, expiry stored', async () => {
    const rt = makeRuntime(www2Driver());
    const res = await login(rt, { www2: true });
    expect(res.reason).toBe('browser_login');
    expect(res.www2).toEqual({
      authenticated: true,
      expiresAt: new Date(WWW2_EXPIRES * 1000).toISOString(),
    });
    const stored = await readSession(rt.store);
    const names = (stored!.cookies as { cookies: { name: string }[] }).cookies.map((c) => c.name);
    expect(names).toContain('TOKEN'); // classic cookie survived the OAuth-page wipe (merge)
    expect(names).toContain('X-SII-STATE-CT'); // www2 cookie added
    expect(stored!.www2?.expiresAt).toBe(new Date(WWW2_EXPIRES * 1000).toISOString());
  });

  it('--www2 on a warm classic session WITHOUT the layer audits no false already_authenticated', async () => {
    const rt = makeRuntime(www2Driver());
    await login(rt); // warm the classic session only
    (rt.audit as RecordingAuditSink).entries.length = 0;
    const res = await login(rt, { www2: true }); // classic warm, www2 missing ⇒ browser reopens
    expect(res.reason).toBe('browser_login');
    const reasons = (rt.audit as RecordingAuditSink).entries
      .filter((e) => e.action === 'auth_login')
      .map((e) => e.reason);
    // the probe must not leave a receipt for an outcome that did not happen (ADR-004)
    expect(reasons).not.toContain('already_authenticated');
    expect(reasons).toContain('browser_login');
  });

  it('--www2 with BOTH layers already live returns already_authenticated without reopening', async () => {
    const driver = www2Driver();
    const rt = makeRuntime(driver);
    await login(rt, { www2: true });
    expect(driver.interactiveLoginCalls).toBe(1);
    const again = await login(rt, { www2: true });
    expect(again).toMatchObject({ reason: 'already_authenticated' });
    expect(again.www2?.authenticated).toBe(true);
    expect(driver.interactiveLoginCalls).toBe(1); // browser NOT reopened
    const e = (rt.audit as RecordingAuditSink).entries.find(
      (x) => x.reason === 'already_authenticated',
    );
    expect(e).toMatchObject({ action: 'auth_login', result: 'ok' });
  });

  /** A fake SII holding BOTH layers, with one jar PER restored session (#146). The www2 close
   *  (the SPA's `$logout`) answers by leaving its path and wipes the classic cookies from THAT
   *  jar, as observed, so an `autTermino.cgi` sent on the same jar ends nothing. The www2 layer
   *  survives both closes unless `www2Revokes`; `failWww2Close` makes that GET throw, and
   *  `failStatus` makes the www2 liveness read throw (an inconclusive probe). */
  function www2LogoutDriver(
    opts: { www2Revokes?: boolean; failWww2Close?: boolean; failStatus?: boolean } = {},
  ) {
    let classicClosed = false;
    let www2Revoked = false;
    const sessionJson = JSON.stringify({ userId: '20000042-0', userAuthType: 'CT', seconds: 5999 });
    return new FakePortalDriver({
      restoreSession: () => {
        let jarWiped = false;
        return {
          landingUrl: HOSTS.miSii,
          gotoLanding: (url: string) => {
            if (url.startsWith(WWW2_SESSION_CLOSE_URL)) {
              if (opts.failWww2Close) throw new Error('network down');
              jarWiped = true;
              if (opts.www2Revokes) www2Revoked = true;
              return 'https://accounts.example.invalid/logout'; // the 307 left the close path
            }
            if (url === LOGOUT_URL) {
              if (!jarWiped) classicClosed = true;
              return LOGOUT_URL;
            }
            return url === HOSTS.miSii && (classicClosed || jarWiped) ? LOGIN_URL : undefined;
          },
          requestText: (url: string) => {
            if (!url.includes('/app/session/status')) return undefined;
            if (opts.failStatus) throw new Error('network down');
            return www2Revoked || jarWiped ? ({ status: 401, body: '' } as const) : sessionJson;
          },
        };
      },
    });
  }

  const WWW2_UNTIL = '2026-06-27T13:40:00.000Z';
  async function storeBothLayers(rt: Runtime, expiresAt: string = WWW2_UNTIL): Promise<void> {
    await writeSession(rt.store, {
      rut: '20000042-0',
      cookies: { cookies: [] },
      savedAt: '2026-06-27T12:00:00.000Z',
      www2: { savedAt: '2026-06-27T12:00:00.000Z', expiresAt },
    });
  }

  it('logout with a www2 layer still closes the classic session, each close on its own jar (#146)', async () => {
    const driver = www2LogoutDriver();
    const rt = makeRuntime(driver);
    await storeBothLayers(rt);
    const res = await logout(rt);
    // On one shared jar the www2 close wiped the classic cookies first, so autTermino.cgi ended
    // nothing and serverClosed read false.
    expect(res).toMatchObject({ loggedOut: true, serverClosed: true });
    // www2 close, classic close, classic probe, www2 probe: one fresh session each.
    expect(driver.restoreCalls).toBe(4);
  });

  it('logout reports a www2 layer SII keeps valid: www2Closed false + when it expires (#146)', async () => {
    const rt = makeRuntime(www2LogoutDriver());
    await storeBothLayers(rt);
    const res = await logout(rt);
    // The old landing-URL test read the 307 as "closed"; the probe with the original cookies
    // still passes /app/session/status, so it is not.
    expect(res).toMatchObject({ www2Closed: false, www2ValidUntil: WWW2_UNTIL });
    const e = (rt.audit as RecordingAuditSink).entries.find((x) => x.action === 'logout');
    expect(e).toMatchObject({ result: 'ok', www2Closed: false });
    expect(await readSession(rt.store)).toBeNull();
  });

  it('logout proves a www2 close that does take, and then reports no expiry', async () => {
    const rt = makeRuntime(www2LogoutDriver({ www2Revokes: true }));
    await storeBothLayers(rt);
    const res = await logout(rt);
    expect(res).toMatchObject({ serverClosed: true, www2Closed: true });
    expect(res.www2ValidUntil).toBeUndefined();
    const e = (rt.audit as RecordingAuditSink).entries.find((x) => x.action === 'logout');
    expect(e).toMatchObject({ www2Closed: true });
  });

  it('a failed www2 close GET skips its probe; the classic close still runs and is proven', async () => {
    const driver = www2LogoutDriver({ failWww2Close: true });
    const rt = makeRuntime(driver);
    await storeBothLayers(rt);
    const res = await logout(rt);
    expect(res).toMatchObject({
      serverClosed: true,
      www2Closed: false,
      www2ValidUntil: WWW2_UNTIL,
    });
    expect(driver.restoreCalls).toBe(3); // no www2 probe after a close that never ran
    expect(await readSession(rt.store)).toBeNull();
  });

  it('an inconclusive www2 probe is not a proof: www2Closed false, still valid until expiry', async () => {
    const rt = makeRuntime(www2LogoutDriver({ failStatus: true }));
    await storeBothLayers(rt);
    const res = await logout(rt);
    expect(res).toMatchObject({
      serverClosed: true,
      www2Closed: false,
      www2ValidUntil: WWW2_UNTIL,
    });
  });

  it('a stored www2 expiry already past is never reported as "still valid until"', async () => {
    // The runtime clock is 2026-06-27T12:00Z; the layer's stored expiry is an hour before.
    const rt = makeRuntime(www2LogoutDriver({ failStatus: true }));
    await storeBothLayers(rt, '2026-06-27T11:00:00.000Z');
    const res = await logout(rt);
    expect(res.www2Closed).toBe(false);
    expect(res.www2ValidUntil).toBeUndefined();
  });

  it('logout without a www2 layer reports www2Closed false and omits it from the receipt', async () => {
    const rt = makeRuntime(successDriver());
    await login(rt);
    const res = await logout(rt);
    expect(res.www2Closed).toBe(false);
    expect(res.www2ValidUntil).toBeUndefined();
    const e = (rt.audit as RecordingAuditSink).entries.find((x) => x.action === 'logout')!;
    expect(e.www2Closed).toBeUndefined();
  });

  it('a stored www2 layer with no expiry is reported live (nothing local proves it dead)', async () => {
    const rt = makeRuntime(successDriver());
    await login(rt);
    const stored = await readSession(rt.store);
    await rt.store.write('session', {
      ...stored,
      www2: { savedAt: '2026-09-12T00:00:00Z', expiresAt: null },
    });
    expect((await localStatus(rt.store, new Date('2027-01-01T00:00:00Z'))).www2).toEqual({
      authenticated: true,
      expiresAt: null,
    });
  });

  it('login WITHOUT --www2 stores no www2 layer, and status reports it absent', async () => {
    const rt = makeRuntime(successDriver());
    const res = await login(rt);
    expect(res.www2).toBeUndefined();
    expect((await localStatus(rt.store, rt.clock.now())).www2).toEqual({
      authenticated: false,
      expiresAt: null,
    });
  });

  it('localStatus marks the www2 layer expired once its stored expiry has passed', async () => {
    const past = new Date('2026-09-12T00:00:00Z').toISOString();
    const rt = makeRuntime(successDriver());
    await login(rt);
    const stored = await readSession(rt.store);
    await rt.store.write('session', { ...stored, www2: { savedAt: past, expiresAt: past } });
    const st = await localStatus(rt.store, new Date('2026-09-12T02:00:00Z'));
    expect(st.www2).toEqual({ authenticated: false, expiresAt: past });
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
    expect(await localStatus(rt.store, rt.clock.now())).toMatchObject({
      authenticated: false,
      sessionSource: 'none',
    });
    await login(rt);
    expect(await localStatus(rt.store, rt.clock.now())).toMatchObject({
      authenticated: true,
      rut: '20000042-0',
      sessionSource: 'cached',
    });
  });

  /** A fake SII whose `autTermino.cgi` answers on its own path (no redirect, as over the HTTP
   *  driver) and, when `serverCloses`, kills the session: from then on Mi SII bounces ANY
   *  session restored from the old cookies to the login (#135). `failClose` makes the close
   *  GET itself throw, like a network error. */
  function logoutDriver(opts: { serverCloses?: boolean; failClose?: boolean }): FakePortalDriver {
    let closed = false;
    return new FakePortalDriver({
      loginSession: {
        landingUrl: HOSTS.miSii,
        evaluate: (e) => (e.includes('DatosCntrNow') ? personaDatos() : null),
        storageState: {},
      },
      restoreSession: {
        landingUrl: HOSTS.miSii,
        gotoLanding: (url) => {
          if (url === LOGOUT_URL) {
            if (opts.failClose) throw new Error('network down');
            if (opts.serverCloses) closed = true;
            return LOGOUT_URL;
          }
          return url === HOSTS.miSii && closed ? LOGIN_URL : undefined;
        },
      },
    });
  }

  it('logout proves the server close with the pre-logout cookies (#135)', async () => {
    const driver = logoutDriver({ serverCloses: true });
    const rt = makeRuntime(driver);
    await login(rt);
    const before = driver.restoreCalls;
    const res = await logout(rt);
    // The close GET landed on autTermino.cgi itself; the old URL test read that as "not
    // closed". The probe with the original cookies bounces to the login, which is the proof.
    expect(res).toMatchObject({ loggedOut: true, serverClosed: true });
    expect(driver.restoreCalls - before).toBe(2); // the close, then the probe
    const e = (rt.audit as RecordingAuditSink).entries.find((x) => x.action === 'logout');
    expect(e).toMatchObject({ result: 'ok', serverClosed: true });
    expect(await readSession(rt.store)).toBeNull();
    expect(await readOperateState(rt.store)).toBeNull();
  });

  it('logout whose server close does not take reports it, and the receipt says local_only', async () => {
    const rt = makeRuntime(logoutDriver({ serverCloses: false }));
    await login(rt);
    const res = await logout(rt);
    expect(res).toMatchObject({ loggedOut: true, serverClosed: false });
    const e = (rt.audit as RecordingAuditSink).entries.find((x) => x.action === 'logout');
    expect(e).toMatchObject({ result: 'local_only', serverClosed: false });
    expect(await readSession(rt.store)).toBeNull(); // the local wipe always runs
  });

  it('a failed close GET skips the probe and still wipes the local session', async () => {
    const driver = logoutDriver({ failClose: true });
    const rt = makeRuntime(driver);
    await login(rt);
    const before = driver.restoreCalls;
    const res = await logout(rt);
    expect(res).toMatchObject({ loggedOut: true, serverClosed: false });
    expect(driver.restoreCalls - before).toBe(1); // no probe after a close that never ran
    expect(await readSession(rt.store)).toBeNull();
    expect(await readOperateState(rt.store)).toBeNull();
  });

  it('statusRefresh requires a session', async () => {
    const rt = makeRuntime(new FakePortalDriver({}));
    await expect(statusRefresh(rt)).rejects.toBeInstanceOf(NotAuthenticatedError);
  });
});

// ---------------------------------------------------------------------------
// Real-SII flow replicated against the fake driver. The fixtures below mirror
// the shapes OBSERVED live on 2026-06-28 (docs/sii-contract/auth-login.md):
// the landed Mi-SII URL and the full `DatosCntrNow` object. All values are
// SYNTHETIC (Mod-11-valid RUTs, fake names) — no real PII (CONVENTIONS).
// ---------------------------------------------------------------------------

/** Mirrors the real `DatosCntrNow` persona shape (~45 contribuyente fields) so
 *  the parser is proven to read only the curated subset and ignore the rest. */
function realPersonaDatos(): unknown {
  return {
    codigoError: 0,
    descripcionError: '',
    sysdate: null,
    contribuyente: {
      codigoError: 0,
      descripcionError: '',
      sysdate: null,
      rut: 20000042,
      dv: '0',
      nombres: 'Juan Sintético',
      apellidoPaterno: 'Pérez',
      apellidoMaterno: 'Soto',
      razonSocial: null, // null ⇒ persona (drives accountType)
      tipoContribuyenteCodigo: '1',
      tipoContribuyenteDescripcion: 'PERSONA NATURAL',
      subtipoContribuyenteCodigo: '1',
      subtipoContribuyenteDescrip: 'CON INICIO',
      paisCodigo: '997',
      sexo: 'M',
      numeroPasaporte: null,
      fechaConstitucion: null,
      fechaNacimiento: '1990-01-01',
      fechaDefuncion: null,
      eMail: 'sintetico@example.cl',
      fechaCreaRegistroCntr: '2010-01-01',
      fechaModiRegistroCntr: '2020-01-01',
      telefonoMovil: '+56900000000',
      fechaTerminoGiro: null,
      autorizadoDeclararDia20: 'N',
      fechaInicioActividades: '2010-01-01',
      unidadOperativaCodigo: '13',
      unidadOperativaDescripcion: 'SANTIAGO CENTRO',
      unidadOperativaDireccion: 'SINTÉTICA 123',
      unidadOperativaGcCodigo: null,
      unidadOperativaGcDescripcion: null,
      unidadOperativaGcDireccion: null,
      capitalPorEnterar: '0',
      capitalEnterado: '0',
      fIndVerificacion: null,
      fechaCreaRegistroNeg: '2010-01-01',
      fechaModiRegistroNeg: '2020-01-01',
      segmentoCodigo: '1',
      segmentoDescripcion: 'MICRO',
      personaEmpresa: 'P',
      glosaActividad: 'SERVICIOS SINTÉTICOS',
      tipoActuacion: null,
      descripcionActuacion: null,
      declaraTG: 'N',
      personaMiSii: 'S',
    },
    direcciones: [{ calle: 'SINTÉTICA 123' }],
    atributos: [{ codigo: '1' }, { codigo: '2' }],
    alertas: [],
  };
}

/** Synthetic empresa: `razonSocial` present ⇒ accountType 'empresa'. */
function realEmpresaDatos(): unknown {
  return {
    contribuyente: {
      rut: 96500000,
      dv: '3',
      razonSocial: 'Comercial Sintética SpA',
      nombres: null,
      apellidoPaterno: null,
      apellidoMaterno: null,
    },
  };
}

const datosEval =
  (datos: () => unknown) =>
  (expression: string): unknown =>
    expression.includes('DatosCntrNow') ? datos() : null;

/** A driver whose interactiveLogin lands on Mi-SII serving `datos`, and whose
 *  restore (used by probeLive / statusRefresh) lands on `restoreUrl`. */
const liveDriver = (datos: () => unknown, restoreUrl: string = HOSTS.miSii): FakePortalDriver =>
  new FakePortalDriver({
    loginSession: {
      landingUrl: HOSTS.miSii,
      evaluate: datosEval(datos),
      storageState: { cookies: ['session-cookie'] },
    },
    restoreSession: { landingUrl: restoreUrl, evaluate: datosEval(datos) },
  });

describe('auth — real-SII flow (replicated, synthetic data)', () => {
  it('parses identity from the full real DatosCntrNow shape, ignoring the ~45 extra fields', async () => {
    const rt = makeRuntime(liveDriver(realPersonaDatos));
    const res = await login(rt);
    expect(res).toMatchObject({ authenticated: true, rut: '20000042-0', reason: 'browser_login' });
    const op = await readOperateState(rt.store);
    expect(op).toMatchObject({ operatingRut: '20000042-0', accountType: 'persona' });
    // Curated nombre = nombres + apellidos (the extra fields must not leak in).
    expect(op?.operable[0]?.razonSocial).toBe('Juan Sintético Pérez Soto');
  });

  it('idempotent: a live cached session returns already_authenticated without reopening the browser', async () => {
    const driver = liveDriver(realPersonaDatos);
    const rt = makeRuntime(driver);
    await login(rt); // mint
    expect(driver.interactiveLoginCalls).toBe(1);

    const again = await login(rt); // warm session is probed via restore, not re-minted
    expect(again).toMatchObject({ authenticated: true, reason: 'already_authenticated' });
    expect(driver.interactiveLoginCalls).toBe(1); // browser NOT reopened
    expect(driver.restoreCalls).toBeGreaterThanOrEqual(1); // probed instead
  });

  it('re-mints when the cached session is dead (probe lands back on the login host)', async () => {
    const driver = liveDriver(realPersonaDatos, 'https://zeusr.sii.cl/AUT2000/x');
    const rt = makeRuntime(driver);
    await login(rt); // first mint (no probe — store empty)
    expect(driver.interactiveLoginCalls).toBe(1);

    const again = await login(rt); // probe fails ⇒ reopen browser
    expect(again).toMatchObject({ reason: 'browser_login' });
    expect(driver.interactiveLoginCalls).toBe(2);
  });

  it('statusRefresh reads curated identity from the portal on a live session', async () => {
    const rt = makeRuntime(liveDriver(realPersonaDatos));
    await login(rt);
    const id = await statusRefresh(rt);
    expect(id).toEqual({
      rut: '20000042-0',
      nombre: 'Juan Sintético Pérez Soto',
      accountType: 'persona',
      // no www2 layer scripted on this driver → reported absent, never an error (ADR-026)
      www2: { authenticated: false, expiresAt: null },
    });
  });

  it('statusRefresh reports the www2 layer live when the app session answers', async () => {
    const rt = makeRuntime(www2Driver());
    await login(rt, { www2: true });
    const id = await statusRefresh(rt);
    expect(id.www2.authenticated).toBe(true);
    expect(id.www2.expiresAt).toBe(new Date(WWW2_EXPIRES * 1000).toISOString());
  });

  it('statusRefresh on an expired session (lands back on the login host) raises SessionExpired', async () => {
    const rt = makeRuntime(liveDriver(realPersonaDatos, 'https://zeusr.sii.cl/AUT2000/x'));
    await login(rt);
    // SessionExpired, not the parent NotAuthenticated: the error kind an unattended caller
    // branches on must say "log in again", not "no session" (GH-139).
    await expect(statusRefresh(rt)).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('an empresa account (razonSocial present) is typed empresa with razonSocial as nombre', async () => {
    const rt = makeRuntime(liveDriver(realEmpresaDatos));
    const res = await login(rt);
    expect(res.rut).toBe('96500000-3');
    const op = await readOperateState(rt.store);
    expect(op).toMatchObject({ accountType: 'empresa', operatingRut: '96500000-3' });
    expect(op?.operable[0]?.razonSocial).toBe('Comercial Sintética SpA');
  });

  it('login with DatosCntrNow absent raises LoginFailedError and writes no session', async () => {
    const rt = makeRuntime(liveDriver(() => null));
    await expect(login(rt)).rejects.toBeInstanceOf(LoginFailedError);
    expect(await readSession(rt.store)).toBeNull();
  });

  it('login with an incomplete contribuyente (missing dv) raises LoginFailedError', async () => {
    const rt = makeRuntime(liveDriver(() => ({ contribuyente: { rut: 20000042 } })));
    await expect(login(rt)).rejects.toBeInstanceOf(LoginFailedError);
    expect(await readSession(rt.store)).toBeNull();
  });
});

describe('whoami — authenticated principal identity + email (own PII)', () => {
  it('persona: nombre + email, live read from the session principal', async () => {
    const rt = makeRuntime(liveDriver(realPersonaDatos));
    await login(rt);
    const who = await whoami(rt);
    expect(who).toEqual({
      rut: '20000042-0',
      accountType: 'persona',
      nombre: 'Juan Sintético Pérez Soto',
      email: 'sintetico@example.cl',
    });
  });

  it('empresa: nombre = razón social; email null when the portal omits it', async () => {
    const rt = makeRuntime(liveDriver(realEmpresaDatos));
    await login(rt);
    const who = await whoami(rt);
    expect(who).toEqual({
      rut: '96500000-3',
      accountType: 'empresa',
      nombre: 'Comercial Sintética SpA',
      email: null,
    });
  });

  it('audit records ONLY the rut — never the razón social / email values (PII off the receipt)', async () => {
    const rt = makeRuntime(liveDriver(realPersonaDatos));
    await login(rt);
    await whoami(rt);
    const whoamiEntries = (rt.audit as RecordingAuditSink).entries.filter(
      (e) => e.action === 'whoami',
    );
    expect(whoamiEntries).toHaveLength(1);
    expect(whoamiEntries[0]).toMatchObject({ action: 'whoami', result: 'ok', rut: '20000042-0' });
    const serialized = JSON.stringify(whoamiEntries);
    expect(serialized).not.toContain('sintetico@example.cl');
    expect(serialized).not.toContain('Juan');
  });

  it('a Mi SII page that did not bounce but has no DatosCntrNow is a broken scraper, not a failed login (GH-139)', async () => {
    const driver = new FakePortalDriver({
      credentialSession: {
        landingUrl: HOSTS.miSii,
        evaluate: datosEval(realPersonaDatos),
        storageState: { cookies: ['session-cookie'] },
      },
      restoreSession: { landingUrl: HOSTS.miSii },
    });
    const rt = makeRuntime(driver);
    await consoleLogin(rt, CRED);
    await expect(whoami(rt)).rejects.toBeInstanceOf(UnexpectedResponseError);
    await expect(statusRefresh(rt)).rejects.toBeInstanceOf(UnexpectedResponseError);
  });

  it('a dead session bounced to the login host is SessionExpired on whoami', async () => {
    const rt = makeRuntime(credDriver(realPersonaDatos, 'https://zeusr.sii.cl/AUT2000/x'));
    await consoleLogin(rt, CRED);
    // The subclass, not the parent: it is what the error kind `session_expired` keys on.
    await expect(whoami(rt)).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('normalizes a blank email to null (portal serves "   ")', async () => {
    const blankEmail = (): unknown => ({
      contribuyente: {
        rut: 11111111,
        dv: '1',
        nombres: 'Juan',
        apellidoPaterno: 'Pérez',
        eMail: '   ',
      },
    });
    const rt = makeRuntime(liveDriver(blankEmail));
    await login(rt);
    expect((await whoami(rt)).email).toBeNull();
  });

  it('requires a session (raises NotAuthenticated when none)', async () => {
    const rt = makeRuntime(new FakePortalDriver({}));
    await expect(whoami(rt)).rejects.toBeInstanceOf(NotAuthenticatedError);
  });
});

// ---------------------------------------------------------------------------
// Console login (ADR-010): RUT + Clave typed in the terminal, headless form-fill,
// cookies-only result — the Clave is used once and NEVER persisted.
// ---------------------------------------------------------------------------

/** A driver whose credentialLogin lands on Mi-SII serving `datos`; restore (used
 *  by the warm-session probe) lands on `restoreUrl`. */
const credDriver = (datos: () => unknown, restoreUrl: string = HOSTS.miSii): FakePortalDriver =>
  new FakePortalDriver({
    credentialSession: {
      landingUrl: HOSTS.miSii,
      evaluate: datosEval(datos),
      storageState: { cookies: ['session-cookie'] },
    },
    restoreSession: { landingUrl: restoreUrl, evaluate: datosEval(datos) },
  });

const CRED = { rut: '20000042-0', clave: 'synthetic-clave-XYZ' };

describe('auth — console login (ADR-010, synthetic data)', () => {
  it('persists a cookies-only session + defaults operate to self, reason console_login', async () => {
    const rt = makeRuntime(credDriver(realPersonaDatos));
    const res = await consoleLogin(rt, CRED);
    expect(res).toMatchObject({ authenticated: true, rut: '20000042-0', reason: 'console_login' });
    const op = await readOperateState(rt.store);
    expect(op).toMatchObject({ operatingRut: '20000042-0', accountType: 'persona' });
  });

  it('forwards RUT + Clave to the driver but NEVER persists the Clave', async () => {
    const driver = credDriver(realPersonaDatos);
    const rt = makeRuntime(driver);
    await consoleLogin(rt, CRED);
    // The Clave reached the driver (to fill the form)...
    expect(driver.lastCredential).toEqual(CRED);
    // ...but nothing on disk carries it: the stored session is cookies-only.
    const session = await readSession(rt.store);
    expect(session && Object.keys(session)).toEqual(['rut', 'cookies', 'savedAt']);
    expect(JSON.stringify(session)).not.toContain(CRED.clave);
  });

  it('idempotent: a live cached session returns already_authenticated, no form-fill', async () => {
    const driver = credDriver(realPersonaDatos);
    const rt = makeRuntime(driver);
    await consoleLogin(rt, CRED); // mint
    expect(driver.credentialLoginCalls).toBe(1);
    const again = await consoleLogin(rt, CRED);
    expect(again).toMatchObject({ reason: 'already_authenticated' });
    expect(driver.credentialLoginCalls).toBe(1); // form NOT re-filled
  });

  it('a cached session that does not bounce but serves no identity is NOT live: it mints (GH-139)', async () => {
    // Over HTTP a dead jar once read as live (Mi SII's JS-only redirect), and every login then
    // answered already_authenticated forever. The probe now needs Mi SII to serve the identity.
    const driver = new FakePortalDriver({
      credentialSession: {
        landingUrl: HOSTS.miSii,
        evaluate: datosEval(realPersonaDatos),
        storageState: { cookies: ['session-cookie'] },
      },
      restoreSession: { landingUrl: HOSTS.miSii }, // no bounce, and no DatosCntrNow
    });
    const rt = makeRuntime(driver);
    await consoleLogin(rt, CRED);
    const again = await consoleLogin(rt, CRED);
    expect(again).toMatchObject({ reason: 'console_login' });
    expect(driver.credentialLoginCalls).toBe(2);
  });

  it('a failed console login (lands back on the login host) raises LoginFailedError, no session', async () => {
    // credentialLogin "succeeds" but lands back on the login host (bad Clave / lock).
    const driver = new FakePortalDriver({
      credentialSession: { landingUrl: 'https://zeusr.sii.cl/AUT2000/x' },
    });
    const rt = makeRuntime(driver);
    await expect(consoleLogin(rt, CRED)).rejects.toBeInstanceOf(LoginFailedError);
    expect(await readSession(rt.store)).toBeNull();
  });

  it('propagates a driver failure (bad Clave / lock / timeout), writes no session', async () => {
    const driver = new FakePortalDriver({
      failCredentialLogin: new LoginFailedError('cuenta bloqueada'),
    });
    const rt = makeRuntime(driver);
    await expect(consoleLogin(rt, CRED)).rejects.toBeInstanceOf(LoginFailedError);
    expect(await readSession(rt.store)).toBeNull();
    expect(driver.interactiveLoginCalls).toBe(0); // never touched the browser path
  });
});

// ---------------------------------------------------------------------------
// Operable-set fetch on login (ADR-005): persona accounts ask SII for the empresas
// they can operate (getDcvEmpresasAutorizadas); best-effort — any failure → [self].
// ---------------------------------------------------------------------------

const EMPRESAS_OK = {
  respEstado: { codRespuesta: 0 },
  data: [
    { usrEmpRut: '96500000', usrEmpDv: '3', razonSocONombreEmp: 'Empresa Sintética SpA' },
    { usrEmpRut: '20000042', usrEmpDv: '0' }, // self (matches realPersonaDatos)
  ],
};

describe('auth — operable fetch on login (ADR-005, synthetic data)', () => {
  it('persona login populates operable with self + represented empresas', async () => {
    const rt = makeRuntime(
      new FakePortalDriver({
        loginSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datosEval(realPersonaDatos),
          storageState: { cookies: ['c'] },
          requestJson: () => EMPRESAS_OK,
          cookies: { TOKEN: 'tok' },
        },
        restoreSession: { landingUrl: HOSTS.miSii, evaluate: datosEval(realPersonaDatos) },
      }),
    );
    await login(rt);
    const op = await readOperateState(rt.store);
    expect(op?.operable.map((e) => e.rut).sort()).toEqual(['20000042-0', '96500000-3']);
    expect(op?.operable.find((e) => e.rut === '96500000-3')).toMatchObject({
      razonSocial: 'Empresa Sintética SpA',
      isSelf: false,
    });
    expect(op?.operable.find((e) => e.rut === '20000042-0')?.isSelf).toBe(true);
  });

  it('falls back to [self] when the operable fetch fails (login still succeeds)', async () => {
    const rt = makeRuntime(
      new FakePortalDriver({
        loginSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datosEval(realPersonaDatos),
          storageState: { cookies: ['c'] },
          requestJson: () => ({ respEstado: { codRespuesta: '-1', msgeRespuesta: 'falló' } }),
        },
        restoreSession: { landingUrl: HOSTS.miSii, evaluate: datosEval(realPersonaDatos) },
      }),
    );
    const res = await login(rt);
    expect(res.authenticated).toBe(true); // operable failure never fails the login
    const op = await readOperateState(rt.store);
    expect(op?.operable).toHaveLength(1);
    expect(op?.operable[0]).toMatchObject({ rut: '20000042-0', isSelf: true });
  });

  it('empresa accounts skip the fetch — operable is just self', async () => {
    let fetchCalled = false;
    const driver = new FakePortalDriver({
      loginSession: {
        landingUrl: HOSTS.miSii,
        evaluate: datosEval(realEmpresaDatos),
        storageState: { cookies: ['c'] },
        // Must NOT be called for an empresa account (no representación).
        requestJson: () => {
          fetchCalled = true;
          return null;
        },
      },
    });
    const rt = makeRuntime(driver);
    await login(rt);
    expect(fetchCalled).toBe(false);
    const op = await readOperateState(rt.store);
    expect(op?.accountType).toBe('empresa');
    expect(op?.operable).toHaveLength(1);
    expect(op?.operable[0]).toMatchObject({ rut: '96500000-3', isSelf: true });
  });
});

// ---------------------------------------------------------------------------
// Keyring login (ADR-025): the Clave comes from the SecretStore seam instead of the
// terminal — same one-attempt, cookies-only outcome as the console path. Synthetic
// RUT + Clave; the real keyring is never touched (the fake store stands in).
// ---------------------------------------------------------------------------

const keyringRuntime = (driver: FakePortalDriver, secrets: InMemorySecretStore): Runtime => ({
  ...makeRuntime(driver),
  secrets,
});

describe('auth — keyring login (ADR-025, synthetic data)', () => {
  it('reads the Clave from the keyring and mints a cookies-only session', async () => {
    const driver = credDriver(realPersonaDatos);
    const secrets = new InMemorySecretStore(new Map([['20000042-0', CRED.clave]]));
    const res = await keyringLogin(keyringRuntime(driver, secrets), { rut: '20000042-0' });
    expect(res).toMatchObject({ authenticated: true, rut: '20000042-0', reason: 'keyring_login' });
    expect(driver.lastCredential).toEqual(CRED);
  });

  it('tries the RUT renderings a human plausibly stored, canonical first', async () => {
    const driver = credDriver(realPersonaDatos);
    // Stored the human way, with dots — the canonical lookup misses, the next one hits.
    const secrets = new InMemorySecretStore(new Map([['20.000.042-0', CRED.clave]]));
    const rt = keyringRuntime(driver, secrets);
    await keyringLogin(rt, { rut: '20000042-0' });
    expect(secrets.reads).toEqual(['20000042-0', '20.000.042-0']);
    // Whatever rendering the entry used, SII is always given the canonical RUT.
    expect(driver.lastCredential?.rut).toBe('20000042-0');
  });

  it('never persists the Clave: the stored session stays cookies-only', async () => {
    const driver = credDriver(realPersonaDatos);
    const secrets = new InMemorySecretStore(new Map([['20000042-0', CRED.clave]]));
    const rt = keyringRuntime(driver, secrets);
    await keyringLogin(rt, { rut: '20000042-0' });
    const session = await readSession(rt.store);
    expect(session && Object.keys(session)).toEqual(['rut', 'cookies', 'savedAt']);
    expect(JSON.stringify(session)).not.toContain(CRED.clave);
  });

  it('the audit receipt records the reason + RUT, never the Clave', async () => {
    const driver = credDriver(realPersonaDatos);
    const secrets = new InMemorySecretStore(new Map([['20000042-0', CRED.clave]]));
    const audit = new RecordingAuditSink();
    const rt: Runtime = { ...keyringRuntime(driver, secrets), audit };
    await keyringLogin(rt, { rut: '20000042-0' });
    const entry = audit.entries.find((e) => e.action === 'auth_login');
    expect(entry).toMatchObject({ result: 'ok', rut: '20000042-0', reason: 'keyring_login' });
    expect(JSON.stringify(audit.entries)).not.toContain(CRED.clave);
  });

  it('a live session short-circuits BEFORE the keyring is read (no unlock prompt)', async () => {
    const driver = credDriver(realPersonaDatos);
    const secrets = new InMemorySecretStore(new Map([['20000042-0', CRED.clave]]));
    const rt = keyringRuntime(driver, secrets);
    await keyringLogin(rt, { rut: '20000042-0' }); // mint
    secrets.reads.length = 0;
    const again = await keyringLogin(rt, { rut: '20000042-0' });
    expect(again).toMatchObject({ reason: 'already_authenticated' });
    expect(secrets.reads).toEqual([]); // the Clave was never pulled into memory
  });

  it('no entry in the keyring → CredentialNotFoundError, and SII is never contacted', async () => {
    const driver = credDriver(realPersonaDatos);
    const rt = keyringRuntime(driver, new InMemorySecretStore());
    await expect(keyringLogin(rt, { rut: '20000042-0' })).rejects.toThrow(
      /secret-tool store[\s\S]*security add-generic-password/,
    );
    expect(driver.credentialLoginCalls).toBe(0);
  });

  it('no SecretStore wired (embedded consumer) → actionable CredentialNotFoundError', async () => {
    const rt = makeRuntime(credDriver(realPersonaDatos)); // no `secrets` seam
    await expect(keyringLogin(rt, { rut: '20000042-0' })).rejects.toBeInstanceOf(
      CredentialNotFoundError,
    );
  });

  it('a malformed RUT is rejected locally — no keyring read, no login attempt (ADR-004)', async () => {
    const driver = credDriver(realPersonaDatos);
    const secrets = new InMemorySecretStore(new Map([['20000042-0', CRED.clave]]));
    await expect(
      keyringLogin(keyringRuntime(driver, secrets), { rut: '20000042-9' }),
    ).rejects.toThrow();
    expect(secrets.reads).toEqual([]);
    expect(driver.credentialLoginCalls).toBe(0);
  });

  it('ONE attempt: a rejected Clave propagates and is never retried (ADR-004)', async () => {
    const driver = new FakePortalDriver({
      failCredentialLogin: new LoginFailedError('Clave incorrecta'),
    });
    const secrets = new InMemorySecretStore(new Map([['20000042-0', 'stale-clave']]));
    const rt = keyringRuntime(driver, secrets);
    await expect(keyringLogin(rt, { rut: '20000042-0' })).rejects.toBeInstanceOf(LoginFailedError);
    expect(driver.credentialLoginCalls).toBe(1);
    expect(await readSession(rt.store)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Non-interactive login (ADR-028): the CLI read the Clave from a named env var or stdin.
// Same one-attempt core, plus the RUT-aware live probe and the rejection latch. Synthetic
// RUTs + Clave only; SII is the fake driver.
// ---------------------------------------------------------------------------

const OTHER_RUT = '11111111-1'; // synthetic, Mod-11-valid, not the fixture's principal
const wrongClave = (): LoginFailedError =>
  new LoginFailedError(
    `La Clave Tributaria ingresada no es correcta (código ${WRONG_CLAVE_CODIGO})`,
    {
      reason: 'wrong-clave',
      codigo: WRONG_CLAVE_CODIGO,
    },
  );
const ENV = { rut: CRED.rut, clave: CRED.clave, source: 'env' } as const;

describe('auth — non-interactive login (ADR-028, synthetic data)', () => {
  it('mints a cookies-only session and audits the source, never the Clave', async () => {
    const driver = credDriver(realPersonaDatos);
    const rt = makeRuntime(driver);
    const res = await suppliedClaveLogin(rt, ENV);
    expect(res).toMatchObject({ authenticated: true, rut: CRED.rut, reason: 'env_login' });
    expect(driver.lastCredential).toEqual({ rut: CRED.rut, clave: CRED.clave });
    const audit = rt.audit as RecordingAuditSink;
    expect(audit.entries.find((e) => e.action === 'auth_login')).toMatchObject({
      result: 'ok',
      source: 'env',
    });
    expect(JSON.stringify(audit.entries)).not.toContain(CRED.clave);
    expect(JSON.stringify(await readSession(rt.store))).not.toContain(CRED.clave);
  });

  it('records stdin as its own source', async () => {
    const rt = makeRuntime(credDriver(realPersonaDatos));
    const res = await suppliedClaveLogin(rt, { ...ENV, source: 'stdin' });
    expect(res.reason).toBe('stdin_login');
  });

  it('a live session for the same RUT answers already_authenticated, nothing submitted', async () => {
    const driver = credDriver(realPersonaDatos);
    const rt = makeRuntime(driver);
    await suppliedClaveLogin(rt, ENV);
    const again = await suppliedClaveLogin(rt, ENV);
    expect(again).toMatchObject({ reason: 'already_authenticated', rut: CRED.rut });
    expect(driver.credentialLoginCalls).toBe(1);
  });

  it('a live session for ANOTHER RUT is an error on every Clave source (ADR-005)', async () => {
    const driver = credDriver(realPersonaDatos);
    const rt = makeRuntime(driver);
    await suppliedClaveLogin(rt, ENV); // live as 20000042-0
    await expect(suppliedClaveLogin(rt, { ...ENV, rut: OTHER_RUT })).rejects.toThrow(
      /sesión activa como 20000042-0[\s\S]*sii auth logout/,
    );
    await expect(consoleLogin(rt, { rut: OTHER_RUT, clave: 'x' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(driver.credentialLoginCalls).toBe(1);
  });

  it('a SII rejection with a código trips the latch: {rut, at, codigo}, no secret', async () => {
    const rt = makeRuntime(new FakePortalDriver({ failCredentialLogin: wrongClave() }));
    await expect(suppliedClaveLogin(rt, ENV)).rejects.toBeInstanceOf(LoginFailedError);
    const block = await readLoginBlock(rt.store, CRED.rut);
    expect(block).toEqual({
      rut: CRED.rut,
      at: '2026-06-27T12:00:00.000Z',
      codigo: WRONG_CLAVE_CODIGO,
    });
    expect(JSON.stringify(block)).not.toContain(CRED.clave);
  });

  it('while latched, env / stdin / keyring refuse WITHOUT contacting SII', async () => {
    const driver = credDriver(realPersonaDatos);
    const secrets = new InMemorySecretStore(new Map([[CRED.rut, CRED.clave]]));
    const rt = keyringRuntime(driver, secrets);
    await tripLoginBlock(rt, CRED.rut, WRONG_CLAVE_CODIGO);
    for (const source of ['env', 'stdin'] as const) {
      const err = await suppliedClaveLogin(rt, { ...ENV, source }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LoginBlockedError);
      expect(err).toMatchObject({ reason: 'wrong-clave', codigo: WRONG_CLAVE_CODIGO });
    }
    await expect(keyringLogin(rt, { rut: CRED.rut })).rejects.toBeInstanceOf(LoginBlockedError);
    expect(driver.credentialLoginCalls).toBe(0);
    expect(secrets.reads).toEqual([]); // not even the keyring was read
  });

  it('the latch is per RUT: another RUT logs in normally', async () => {
    const driver = credDriver(realPersonaDatos);
    const rt = makeRuntime(driver);
    await tripLoginBlock(rt, OTHER_RUT, WRONG_CLAVE_CODIGO);
    await expect(suppliedClaveLogin(rt, ENV)).resolves.toMatchObject({ reason: 'env_login' });
    expect(await readLoginBlock(rt.store, OTHER_RUT)).not.toBeNull();
  });

  it('a live session still answers while latched (nothing would be submitted)', async () => {
    const driver = credDriver(realPersonaDatos);
    const rt = makeRuntime(driver);
    await suppliedClaveLogin(rt, ENV);
    await tripLoginBlock(rt, CRED.rut, WRONG_CLAVE_CODIGO);
    await expect(suppliedClaveLogin(rt, ENV)).resolves.toMatchObject({
      reason: 'already_authenticated',
    });
  });

  it.each([
    ['Queue-it', new LoginQueuedError('sala de espera')],
    ['a timeout / changed page (no código)', new LoginFailedError('Login no completado')],
    ['a network error', new Error('fetch failed')],
  ])('never trips on %s: SII never judged the Clave', async (_label, error) => {
    const rt = makeRuntime(new FakePortalDriver({ failCredentialLogin: error }));
    await expect(suppliedClaveLogin(rt, ENV)).rejects.toBe(error);
    expect(await readLoginBlock(rt.store, CRED.rut)).toBeNull();
  });

  it('an unrecognised código (e.g. the unobserved locked-account page) trips too', async () => {
    const locked = new LoginFailedError('Cuenta bloqueada (código 99.99)', { codigo: '99.99' });
    const rt = makeRuntime(new FakePortalDriver({ failCredentialLogin: locked }));
    await expect(suppliedClaveLogin(rt, ENV)).rejects.toBe(locked);
    expect(await readLoginBlock(rt.store, CRED.rut)).toMatchObject({ codigo: '99.99' });
  });

  it('a successful console login (a human typing) lifts the latch for that RUT', async () => {
    const rt = makeRuntime(credDriver(realPersonaDatos));
    await tripLoginBlock(rt, CRED.rut, WRONG_CLAVE_CODIGO);
    await consoleLogin(rt, CRED);
    expect(await readLoginBlock(rt.store, CRED.rut)).toBeNull();
  });

  it('a successful browser login (the MCP auth_login) lifts it too', async () => {
    const rt = makeRuntime(successDriver());
    await tripLoginBlock(rt, '20000042-0', WRONG_CLAVE_CODIGO);
    await login(rt);
    expect(await readLoginBlock(rt.store, '20000042-0')).toBeNull();
  });

  it('a rejected console login trips the latch as well (the attempt counted toward a lock)', async () => {
    const rt = makeRuntime(new FakePortalDriver({ failCredentialLogin: wrongClave() }));
    await expect(consoleLogin(rt, CRED)).rejects.toBeInstanceOf(LoginFailedError);
    expect(await readLoginBlock(rt.store, CRED.rut)).not.toBeNull();
  });

  it('localStatus reports the latch, with or without a session, so a caller checks first', async () => {
    const rt = makeRuntime(credDriver(realPersonaDatos));
    expect((await localStatus(rt.store, rt.clock.now())).loginBlocked).toEqual([]);
    await tripLoginBlock(rt, OTHER_RUT, WRONG_CLAVE_CODIGO);
    const noSession = await localStatus(rt.store, rt.clock.now());
    expect(noSession).toMatchObject({
      authenticated: false,
      loginBlocked: [
        { rut: OTHER_RUT, at: '2026-06-27T12:00:00.000Z', codigo: WRONG_CLAVE_CODIGO },
      ],
    });
    await suppliedClaveLogin(rt, ENV); // another RUT logs in; the latch stays reported
    const withSession = await localStatus(rt.store, rt.clock.now());
    expect(withSession.authenticated).toBe(true);
    expect(withSession.loginBlocked.map((b) => b.rut)).toEqual([OTHER_RUT]);
  });

  it('unblockLogin lifts one RUT or all, and reports which', async () => {
    const rt = makeRuntime(new FakePortalDriver({}));
    await tripLoginBlock(rt, CRED.rut, WRONG_CLAVE_CODIGO);
    await tripLoginBlock(rt, OTHER_RUT, null);
    expect(await unblockLogin(rt, { rut: '20.000.042-0' })).toEqual([CRED.rut]);
    expect(await readLoginBlock(rt.store, OTHER_RUT)).not.toBeNull();
    expect(await unblockLogin(rt)).toEqual([OTHER_RUT]);
    expect(await unblockLogin(rt)).toEqual([]);
  });

  it('a malformed RUT is rejected locally — no attempt (ADR-004)', async () => {
    const driver = credDriver(realPersonaDatos);
    await expect(
      suppliedClaveLogin(makeRuntime(driver), { ...ENV, rut: '20000042-9' }),
    ).rejects.toThrow();
    expect(driver.credentialLoginCalls).toBe(0);
  });
});
