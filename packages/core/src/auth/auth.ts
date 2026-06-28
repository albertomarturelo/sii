import { HOSTS } from '../config/index.js';
import { LoginFailedError, NotAuthenticatedError } from '../errors/index.js';
import { Rut } from '../rut/index.js';
import { recordAudit } from '../audit/index.js';
import { clearOperateState, initOperateState } from '../identity/index.js';
import type { AccountType, OperableEntry } from '../identity/index.js';
import type { PortalSession, Runtime } from '../seams/index.js';

// Distinct KeyValueStore key (ADR-007) — never shares a file with `identity`'s 'operate'.
const SESSION_KEY = 'session';
// Server-side logout endpoint; the close redirects OFF this path (sii-py, observed).
const LOGOUT_URL = 'https://zeusr.sii.cl/cgi_AUT2000/autTermino.cgi';
const DEFAULT_LOGIN_TIMEOUT_MS = 180_000;
// Console login submits machine-fast (no human typing in the browser) and fails
// fast on a rejected Clave, so it needs a far smaller budget than the headed flow.
const CONSOLE_LOGIN_TIMEOUT_MS = 60_000;
// The Mi-SII landing serves this inline JS object with the contribuyente snapshot.
const DATOS_EXPR = "typeof DatosCntrNow !== 'undefined' ? DatosCntrNow : null";

export interface StoredSession {
  /** Canonical session-principal RUT (read from the portal, not a credential). */
  readonly rut: string;
  /** Cookies-only storage state (opaque to the core). */
  readonly cookies: unknown;
  readonly savedAt: string;
}

interface DatosContribuyente {
  rut?: number | string;
  dv?: string;
  razonSocial?: string;
  nombres?: string;
  apellidoPaterno?: string;
  apellidoMaterno?: string;
}
interface DatosCntr {
  contribuyente?: DatosContribuyente;
}

export interface AuthIdentity {
  readonly rut: string;
  readonly nombre: string | null;
  readonly accountType: AccountType;
}

export interface AuthStatusLocal {
  /** LOCAL-only: a cookie jar exists on disk. NOT a server-side liveness claim. */
  readonly authenticated: boolean;
  readonly rut: string | null;
  readonly sessionSource: 'cached' | 'none';
}

export interface AuthLoginResult {
  readonly authenticated: true;
  readonly rut: string;
  readonly reason: 'browser_login' | 'console_login' | 'already_authenticated';
}

export interface AuthLogoutResult {
  readonly loggedOut: boolean;
  readonly serverClosed: boolean;
}

export async function readSession(store: Runtime['store']): Promise<StoredSession | null> {
  return store.read<StoredSession>(SESSION_KEY);
}

/** Pure local read — NO portal call (sii-py "local-only" labelling). */
export async function localStatus(store: Runtime['store']): Promise<AuthStatusLocal> {
  const session = await readSession(store);
  return session
    ? { authenticated: true, rut: session.rut, sessionSource: 'cached' }
    : { authenticated: false, rut: null, sessionSource: 'none' };
}

function identityFromDatos(datos: DatosCntr | null): AuthIdentity {
  const c = datos?.contribuyente;
  if (!c || c.rut === undefined || c.dv === undefined) {
    throw new LoginFailedError('No se pudo leer la identidad del portal (DatosCntrNow ausente).');
  }
  const rut = Rut.parse(`${c.rut}-${c.dv}`).canonical;
  const accountType: AccountType = c.razonSocial ? 'empresa' : 'persona';
  const joined = [c.nombres, c.apellidoPaterno, c.apellidoMaterno].filter(Boolean).join(' ').trim();
  const nombre = c.razonSocial ?? (joined || null);
  return { rut, nombre, accountType };
}

function landedOnLoginHost(landed: string): boolean {
  return new URL(landed).hostname === 'zeusr.sii.cl';
}

async function probeLive(runtime: Runtime, session: StoredSession): Promise<boolean> {
  let s: PortalSession | null = null;
  try {
    s = await runtime.portal.restore(session.cookies);
    return !landedOnLoginHost(await s.goto(HOSTS.miSii));
  } catch {
    return false;
  } finally {
    await s?.close();
  }
}

/** If a cached session is still live, return `already_authenticated` (no mint).
 *  Shared by both login paths so neither re-mints over a warm session. */
async function reuseLiveSession(runtime: Runtime): Promise<AuthLoginResult | null> {
  const existing = await readSession(runtime.store);
  if (existing && (await probeLive(runtime, existing))) {
    recordAudit(runtime, {
      action: 'auth_login',
      result: 'ok',
      rut: existing.rut,
      reason: 'already_authenticated',
    });
    return { authenticated: true, rut: existing.rut, reason: 'already_authenticated' };
  }
  return null;
}

/** Turn a freshly-minted PortalSession into a persisted cookies-only session:
 *  confirm we landed off the login host, read identity, persist cookies (NO
 *  secret), default operate to self. Shared by the browser + console paths. */
async function finalizeFreshSession(
  runtime: Runtime,
  session: PortalSession,
  reason: 'browser_login' | 'console_login',
  start: number,
): Promise<AuthLoginResult> {
  const landed = await session.goto(HOSTS.miSii);
  if (landedOnLoginHost(landed)) {
    throw new LoginFailedError('Login no completado (seguimos en la página de autenticación).');
  }
  const datos = await session.evaluate<DatosCntr | null>(DATOS_EXPR);
  const identity = identityFromDatos(datos);
  const cookies = await session.storageState();
  await runtime.store.write<StoredSession>(SESSION_KEY, {
    rut: identity.rut,
    cookies,
    savedAt: runtime.clock.now().toISOString(),
  });

  // Operate defaults to self. The operable fetch (getDcvEmpresasAutorizadas) is a
  // later portal increment; until then operable = [self].
  const operable: OperableEntry[] = [
    { rut: identity.rut, razonSocial: identity.nombre ?? identity.rut, isSelf: true },
  ];
  await initOperateState(runtime.store, {
    selfRut: identity.rut,
    accountType: identity.accountType,
    operable,
  });

  recordAudit(runtime, {
    action: 'auth_login',
    result: 'ok',
    rut: identity.rut,
    reason,
    durationMs: runtime.clock.now().getTime() - start,
  });
  return { authenticated: true, rut: identity.rut, reason };
}

/** Browser cookies-only login (ADR-006). Only this + `consoleLogin` mint a session
 *  (ADR-019 lineage). Idempotent: a live cached session returns
 *  `already_authenticated` without opening a window. */
export async function login(runtime: Runtime): Promise<AuthLoginResult> {
  const start = runtime.clock.now().getTime();
  const warm = await reuseLiveSession(runtime);
  if (warm) return warm;

  let session: PortalSession | null = null;
  try {
    session = await runtime.portal.interactiveLogin({
      destination: HOSTS.miSii,
      timeoutMs: DEFAULT_LOGIN_TIMEOUT_MS,
    });
    return await finalizeFreshSession(runtime, session, 'browser_login', start);
  } catch (err) {
    recordAudit(runtime, { action: 'auth_login', result: 'failed', reason: 'browser_login' });
    throw err;
  } finally {
    await session?.close();
  }
}

/** CLI-only console login (ADR-010): the Clave is typed into the TERMINAL, used
 *  once to fill SII's real form headless, and never persisted — only cookies are
 *  stored, exactly like the browser path. ONE attempt, never retried (ADR-004).
 *  The Clave never reaches MCP (this task is CLI-only) nor the audit log. */
export async function consoleLogin(
  runtime: Runtime,
  credentials: { rut: string; clave: string },
): Promise<AuthLoginResult> {
  const start = runtime.clock.now().getTime();
  const warm = await reuseLiveSession(runtime);
  if (warm) return warm;

  let session: PortalSession | null = null;
  try {
    session = await runtime.portal.credentialLogin({
      rut: credentials.rut,
      clave: credentials.clave,
      destination: HOSTS.miSii,
      timeoutMs: CONSOLE_LOGIN_TIMEOUT_MS,
    });
    return await finalizeFreshSession(runtime, session, 'console_login', start);
  } catch (err) {
    recordAudit(runtime, { action: 'auth_login', result: 'failed', reason: 'console_login' });
    throw err;
  } finally {
    await session?.close();
  }
}

/** Server-side close (best-effort) + wipe local session + operate context. */
export async function logout(runtime: Runtime): Promise<AuthLogoutResult> {
  const session = await readSession(runtime.store);
  if (!session) {
    recordAudit(runtime, { action: 'logout', result: 'ok', serverClosed: false });
    return { loggedOut: false, serverClosed: false };
  }

  let serverClosed = false;
  let s: PortalSession | null = null;
  try {
    s = await runtime.portal.restore(session.cookies);
    const landed = await s.goto(LOGOUT_URL);
    serverClosed = new URL(landed).pathname !== new URL(LOGOUT_URL).pathname;
  } catch {
    // best-effort server close; the local wipe still runs
  } finally {
    await s?.close();
  }

  await runtime.store.delete(SESSION_KEY);
  await clearOperateState(runtime.store);
  recordAudit(runtime, { action: 'logout', result: 'ok', rut: session.rut, serverClosed });
  return { loggedOut: true, serverClosed };
}

/** Curated identity readback from the portal. Requires a live session (no implicit login). */
export async function statusRefresh(runtime: Runtime): Promise<AuthIdentity> {
  const session = await readSession(runtime.store);
  if (!session) {
    throw new NotAuthenticatedError('No hay sesión. Ejecuta `sii auth login`.');
  }
  let s: PortalSession | null = null;
  try {
    s = await runtime.portal.restore(session.cookies);
    if (landedOnLoginHost(await s.goto(HOSTS.miSii))) {
      throw new NotAuthenticatedError('La sesión expiró. Ejecuta `sii auth login`.');
    }
    const identity = identityFromDatos(await s.evaluate<DatosCntr | null>(DATOS_EXPR));
    recordAudit(runtime, { action: 'auth_status_refresh', result: 'ok', rut: identity.rut });
    return identity;
  } finally {
    await s?.close();
  }
}
