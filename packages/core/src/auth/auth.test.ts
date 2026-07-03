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
import { consoleLogin, localStatus, login, logout, statusRefresh, whoami } from './auth.js';
import { readSession } from './session.js';
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
    });
  });

  it('statusRefresh on an expired session (lands back on the login host) raises NotAuthenticated', async () => {
    const rt = makeRuntime(liveDriver(realPersonaDatos, 'https://zeusr.sii.cl/AUT2000/x'));
    await login(rt);
    await expect(statusRefresh(rt)).rejects.toBeInstanceOf(NotAuthenticatedError);
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
