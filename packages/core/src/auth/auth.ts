import {
  HOSTS,
  KEYRING_SERVICE,
  LOGIN_HOST,
  LOGOUT_URL,
  WWW2_APP_CARPETA,
  WWW2_SESSION_CLOSE_URL,
} from '../config/index.js';
import {
  CredentialNotFoundError,
  LoginBlockedError,
  LoginFailedError,
  NotAuthenticatedError,
  SessionExpiredError,
  UnexpectedResponseError,
  ValidationError,
} from '../errors/index.js';
import { Rut } from '../rut/index.js';
import { recordAudit } from '../audit/index.js';
import { clearOperateState, initOperateState } from '../identity/index.js';
import type { AccountType, OperableEntry } from '../identity/index.js';
import { fetchEmpresasAutorizadas } from '../portal/representacion.js';
import type { EmpresaAutorizada } from '../portal/representacion.js';
import type { PortalSession, Runtime } from '../seams/index.js';
import {
  deleteSession,
  readSession,
  requireBrowser,
  withSession,
  writeSession,
} from './session.js';
import type { StoredSession } from './session.js';
import { parseDatosCntrNow } from './datos-cntr.js';
import type { DatosCntr } from './datos-cntr.js';
import type { LoginBlockEntry } from './login-block.js';
import {
  clearLoginBlock,
  listLoginBlocks,
  readLoginBlock,
  reasonForCodigo,
  siiJudgedClave,
  tripLoginBlock,
} from './login-block.js';
import { mergeStorageState, waitForWww2Session, www2ExpiresAt } from './www2-login.js';
import { readWww2Session } from '../portal/www2-session.js';
import { Www2SessionError } from '../errors/index.js';

const DEFAULT_LOGIN_TIMEOUT_MS = 180_000;
// Console login submits machine-fast (no human typing in the browser) and fails
// fast on a rejected Clave, so it needs a far smaller budget than the headed flow.
const CONSOLE_LOGIN_TIMEOUT_MS = 60_000;

/** Read the Mi SII identity. The landing serves `DatosCntrNow` as an inline JS literal, so we
 *  fetch the HTML and parse it (ADR-027) — engine-agnostic (works over the HTTP driver and the
 *  browser one), replacing the old `session.evaluate`. `null` ⇒ not present (dead session). */
async function readDatos(session: PortalSession): Promise<DatosCntr | null> {
  const { body } = await session.requestText(HOSTS.miSii, { method: 'GET' });
  return parseDatosCntrNow(body);
}

export interface AuthIdentity {
  readonly rut: string;
  readonly nombre: string | null;
  readonly accountType: AccountType;
}

/** `statusRefresh`: the live identity plus the www2 layer read LIVE (`/app/session/status`). */
export interface AuthIdentityRefresh extends AuthIdentity {
  readonly www2: AuthWww2Status;
}

/** `whoami` — the AUTHENTICATED principal's own identity + contact. Session-keyed:
 *  it reads the login principal's `DatosCntrNow`, NOT the operate pointer (operate
 *  changes which RUT you ACT as, never who you ARE). PII by nature. */
export interface AuthWhoami {
  readonly rut: string;
  readonly accountType: AccountType;
  /** Razón social (empresa) or full name (persona); null if the portal omitted it. */
  readonly nombre: string | null;
  readonly email: string | null;
}

/** The www2 APP-SESSION layer as reported by status (ADR-026). LOCAL: `authenticated` means the
 *  layer was minted and its cookie has not expired by the clock — not a server-side claim. */
export interface AuthWww2Status {
  readonly authenticated: boolean;
  readonly expiresAt: string | null;
}

export interface AuthStatusLocal {
  /** LOCAL-only: a cookie jar exists on disk. NOT a server-side liveness claim. */
  readonly authenticated: boolean;
  readonly rut: string | null;
  readonly sessionSource: 'cached' | 'none';
  readonly www2: AuthWww2Status;
  /** The rejection latch (ADR-028): RUTs whose last unattended login the SII rejected, with
   *  when and SII's código. Non-empty ⇒ env/stdin/keyring logins for those RUTs refuse without
   *  contacting SII until a person lifts it. Reported here so a caller checks it before it
   *  tries. Independent of the session: a live session keeps working while latched. */
  readonly loginBlocked: readonly LoginBlockEntry[];
}

/** Where the Clave came from. Audited on every login (never the value — ADR-028); `browser` is
 *  the user typing at SII's own page (the MCP's `auth_login`). */
export type LoginSource = 'browser' | 'console' | 'keyring' | 'env' | 'stdin';
type FreshLoginReason = `${LoginSource}_login`;

/** A human typed the Clave: a fresh login from one of these lifts the rejection latch. */
const INTERACTIVE_SOURCES: readonly LoginSource[] = ['browser', 'console'];

export interface AuthLoginResult {
  readonly authenticated: true;
  readonly rut: string;
  readonly reason: FreshLoginReason | 'already_authenticated';
  /** Set when `--www2` was requested: the www2 layer's state after this call (ADR-026). */
  readonly www2?: AuthWww2Status;
}

export interface AuthLogoutResult {
  readonly loggedOut: boolean;
  readonly serverClosed: boolean;
  /** Best-effort close of the www2 app session, when one was stored (ADR-026). */
  readonly www2Closed: boolean;
}

const NO_WWW2: AuthWww2Status = { authenticated: false, expiresAt: null };

function www2StatusOf(session: StoredSession | null, now: Date): AuthWww2Status {
  const layer = session?.www2;
  if (!layer) return NO_WWW2;
  const alive = layer.expiresAt === null || new Date(layer.expiresAt).getTime() > now.getTime();
  return { authenticated: alive, expiresAt: layer.expiresAt };
}

/** Pure local read — NO portal call (sii-py "local-only" labelling). `now` decides whether the
 *  stored www2 layer is still within its cookie's own expiry. */
export async function localStatus(store: Runtime['store'], now: Date): Promise<AuthStatusLocal> {
  const session = await readSession(store);
  const loginBlocked = await listLoginBlocks(store);
  return session
    ? {
        authenticated: true,
        rut: session.rut,
        sessionSource: 'cached',
        www2: www2StatusOf(session, now),
        loginBlocked,
      }
    : { authenticated: false, rut: null, sessionSource: 'none', www2: NO_WWW2, loginBlocked };
}

/** The principal's identity from `DatosCntrNow`, or null when the page carries none. Each
 *  caller decides what "none" means: a failed login right after the POST, a broken scraper on
 *  a read, "not live" for the login probe (GH-139). */
function identityOf(datos: DatosCntr | null): AuthIdentity | null {
  const c = datos?.contribuyente;
  if (!c || c.rut === undefined || c.dv === undefined) return null;
  const rut = Rut.parse(`${c.rut}-${c.dv}`).canonical;
  const accountType: AccountType = c.razonSocial ? 'empresa' : 'persona';
  const joined = [c.nombres, c.apellidoPaterno, c.apellidoMaterno].filter(Boolean).join(' ').trim();
  const nombre = c.razonSocial ?? (joined || null);
  return { rut, nombre, accountType };
}

/** The login path: no identity after the POST means the login did not complete. */
function identityFromDatos(datos: DatosCntr | null): AuthIdentity {
  const identity = identityOf(datos);
  if (!identity) {
    throw new LoginFailedError('No se pudo leer la identidad del portal (DatosCntrNow ausente).');
  }
  return identity;
}

/** A read path (`whoami`, `status --refresh`): the session did NOT bounce to the login, so a
 *  page without `DatosCntrNow` is a changed portal, not a failed login (GH-139). Never retried. */
function identityOnRead(datos: DatosCntr | null): AuthIdentity {
  const identity = identityOf(datos);
  if (!identity) {
    throw new UnexpectedResponseError(
      'Mi SII respondió sin la identidad del contribuyente (DatosCntrNow ausente) y sin ' +
        'redirigir al login: la página cambió (scraper roto). No se reintenta.',
    );
  }
  return identity;
}

function landedOnLoginHost(landed: string): boolean {
  return new URL(landed).hostname === LOGIN_HOST;
}

/** The session-principal RUT if the cached session is still live on the portal, else
 *  null — never throws (the login path needs "is it warm?", not an error). A single
 *  `withSession` acquisition (no separate pre-read); a missing/expired session → null.
 *  Live means POSITIVE proof: Mi SII served the principal's identity. "No bounce seen" is not
 *  enough: over HTTP a dead jar once read as live (a JS-only redirect, GH-139), and every login
 *  then answered `already_authenticated` without minting, so an unattended caller never
 *  recovered. A probe that is wrong in this direction only costs one fresh login. */
async function liveSessionRut(runtime: Runtime): Promise<string | null> {
  try {
    return await withSession(runtime, async (s) => {
      if (landedOnLoginHost(await s.goto(HOSTS.miSii))) return null;
      return identityOf(await readDatos(s))?.rut ?? null;
    });
  } catch {
    return null;
  }
}

/** If a cached session is still live, the `already_authenticated` result (no mint) — WITHOUT
 *  auditing it. The receipt is written by the caller that actually RETURNS this outcome: a
 *  `--www2` login can find the classic session warm and still need the browser (for the www2
 *  layer), and the audit must record what happened, not what was probed (ADR-004). */
async function liveSessionResult(runtime: Runtime): Promise<AuthLoginResult | null> {
  const rut = await liveSessionRut(runtime);
  return rut ? { authenticated: true, rut, reason: 'already_authenticated' } : null;
}

/** The receipt for a login that ENDED as "already authenticated". */
function auditAlreadyAuthenticated(
  runtime: Runtime,
  warm: AuthLoginResult,
  source: LoginSource,
): void {
  recordAudit(runtime, {
    action: 'auth_login',
    result: 'ok',
    rut: warm.rut,
    reason: warm.reason,
    source,
  });
}

/** Best-effort operable-set fetch on login (ADR-005). Persona accounts ask SII for
 *  the empresas they can operate (getDcvEmpresasAutorizadas); empresa accounts have
 *  no representación, so operable = [self]. ANY failure degrades to [self] — a login
 *  must never fail because the operable lookup did. Razón social is PII → never
 *  audited (only the count). */
async function resolveOperable(
  runtime: Runtime,
  session: PortalSession,
  identity: AuthIdentity,
): Promise<OperableEntry[]> {
  const self: OperableEntry = {
    rut: identity.rut,
    razonSocial: identity.nombre ?? identity.rut,
    isSelf: true,
  };
  if (identity.accountType === 'empresa') return [self];
  try {
    const { empresas } = await fetchEmpresasAutorizadas(session, identity.rut);
    const entries: OperableEntry[] = empresas
      .filter((e): e is EmpresaAutorizada & { rut: string } => e.rut !== null)
      .map((e) => ({
        rut: e.rut,
        razonSocial: e.razonSocial ?? e.rut,
        isSelf: e.rut === identity.rut,
      }));
    // The endpoint includes self, but be defensive: guarantee exactly one self row.
    const operable = entries.some((e) => e.isSelf) ? entries : [self, ...entries];
    recordAudit(runtime, {
      action: 'operable_fetch',
      result: 'ok',
      rut: identity.rut,
      count: operable.length,
    });
    return operable;
  } catch {
    recordAudit(runtime, { action: 'operable_fetch', result: 'failed', rut: identity.rut });
    return [self];
  }
}

/** Turn a freshly-minted PortalSession into a persisted cookies-only session:
 *  confirm we landed off the login host, read identity, persist cookies (NO
 *  secret), default operate to self. Shared by the browser + console paths. */
async function finalizeFreshSession(
  runtime: Runtime,
  session: PortalSession,
  source: LoginSource,
  start: number,
): Promise<AuthLoginResult> {
  const reason: FreshLoginReason = `${source}_login`;
  const landed = await session.goto(HOSTS.miSii);
  if (landedOnLoginHost(landed)) {
    throw new LoginFailedError('Login no completado (seguimos en la página de autenticación).');
  }
  const datos = await readDatos(session);
  const identity = identityFromDatos(datos);
  const cookies = await session.storageState();
  await writeSession(runtime.store, {
    rut: identity.rut,
    cookies,
    savedAt: runtime.clock.now().toISOString(),
  });

  // Operate defaults to self; the operable set is fetched best-effort (ADR-005).
  const operable = await resolveOperable(runtime, session, identity);
  await initOperateState(runtime.store, {
    selfRut: identity.rut,
    accountType: identity.accountType,
    operable,
  });

  // A human just proved a working Clave, which is the reset ADR-028 names for the latch.
  if (INTERACTIVE_SOURCES.includes(source)) await clearLoginBlock(runtime.store, identity.rut);

  recordAudit(runtime, {
    action: 'auth_login',
    result: 'ok',
    rut: identity.rut,
    reason,
    source,
    durationMs: runtime.clock.now().getTime() - start,
  });
  return { authenticated: true, rut: identity.rut, reason };
}

export interface LoginOptions {
  /** Also mint the www2 APP-SESSION layer (ADR-026): after the classic login, the same headed
   *  browser opens the www2 app page and the user completes SII's OAuth login there. */
  readonly www2?: boolean;
}

/** Is the stored www2 layer live on the server? One cheap read via a headless restore; never
 *  throws (the login path needs "is it warm?", not an error). */
async function liveWww2(runtime: Runtime): Promise<boolean> {
  try {
    await withSession(runtime, async (s) => readWww2Session(s, WWW2_APP_CARPETA));
    return true;
  } catch {
    return false;
  }
}

/** The www2 step (ADR-026), run on the still-open headed `session` AFTER the classic login has
 *  been persisted: snapshot the classic jar, let the user log in at SII's OAuth page, then store
 *  classic + www2 cookies together with the layer's own expiry. On timeout the classic session
 *  stays saved and `LoginFailedError` says so. */
async function mintWww2Layer(runtime: Runtime, session: PortalSession): Promise<AuthWww2Status> {
  const stored = await readSession(runtime.store);
  if (!stored) throw new NotAuthenticatedError('No hay sesión. Ejecuta `sii auth login`.');
  const start = runtime.clock.now().getTime();
  try {
    const classicJar = await session.storageState();
    await waitForWww2Session(runtime, session);
    const www2Jar = await session.storageState();
    const expiresAt = www2ExpiresAt(www2Jar);
    const savedAt = runtime.clock.now().toISOString();
    await writeSession(runtime.store, {
      ...stored,
      cookies: mergeStorageState(classicJar, www2Jar),
      www2: { savedAt, expiresAt },
    });
    recordAudit(runtime, {
      action: 'auth_login_www2',
      result: 'ok',
      rut: stored.rut,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return { authenticated: true, expiresAt };
  } catch (err) {
    recordAudit(runtime, { action: 'auth_login_www2', result: 'failed', rut: stored.rut });
    throw err;
  }
}

/** Browser cookies-only login (ADR-006). Only this + `consoleLogin` mint a session
 *  (ADR-019 lineage). Idempotent: a live cached session returns
 *  `already_authenticated` without opening a window. With `www2`, both layers must be live
 *  for that shortcut; otherwise the headed flow runs in full (classic login, then the www2
 *  step in the same browser — the classic page is what carries the user into SII). */
export async function login(
  runtime: Runtime,
  options: LoginOptions = {},
): Promise<AuthLoginResult> {
  const start = runtime.clock.now().getTime();
  const warm = await liveSessionResult(runtime);
  if (warm && (!options.www2 || (await liveWww2(runtime)))) {
    auditAlreadyAuthenticated(runtime, warm, 'browser');
    if (!options.www2) return warm;
    const stored = await readSession(runtime.store);
    return { ...warm, www2: www2StatusOf(stored, runtime.clock.now()) };
  }

  let session: PortalSession | null = null;
  try {
    // The headed login is the browser engine's job (ADR-027): the CLI's default is the HTTP
    // console login, so only the MCP (which wires the browser) reaches this.
    session = await requireBrowser(runtime).interactiveLogin({
      destination: HOSTS.miSii,
      timeoutMs: DEFAULT_LOGIN_TIMEOUT_MS,
    });
    const result = await finalizeFreshSession(runtime, session, 'browser', start);
    if (!options.www2) return result;
    return { ...result, www2: await mintWww2Layer(runtime, session) };
  } catch (err) {
    recordAudit(runtime, {
      action: 'auth_login',
      result: 'failed',
      reason: 'browser_login',
      source: 'browser',
    });
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
  return credentialLoginFlow(
    runtime,
    Rut.parse(credentials.rut),
    () => Promise.resolve(credentials.clave),
    'console',
  );
}

/** CLI-only non-interactive login (ADR-028): the SURFACE read the Clave from an environment
 *  variable it was told to read (`--clave-env <VAR>`) or from piped stdin (`--clave-stdin`),
 *  and `source` records which. Everything else matches `consoleLogin`, plus the rejection
 *  latch: no one is at the keyboard to notice a stale Clave, so a latched RUT is refused
 *  without contacting SII. */
export async function suppliedClaveLogin(
  runtime: Runtime,
  args: { rut: string; clave: string; source: 'env' | 'stdin' },
): Promise<AuthLoginResult> {
  return credentialLoginFlow(
    runtime,
    Rut.parse(args.rut),
    () => Promise.resolve(args.clave),
    args.source,
  );
}

/** The live session's principal if it is `rut`; `null` if there is no live session. A live
 *  session for ANOTHER RUT is an error: answering "already authenticated" would hand the
 *  caller the wrong account, and switching stays an explicit logout→login (ADR-005). */
async function liveSessionFor(runtime: Runtime, rut: Rut): Promise<AuthLoginResult | null> {
  const warm = await liveSessionResult(runtime);
  if (warm && Rut.parse(warm.rut).canonical !== rut.canonical) {
    throw new ValidationError(
      `Hay una sesión activa como ${warm.rut}, no como ${rut.canonical}. Para cambiar de ` +
        'cuenta: `sii auth logout` y luego `sii auth login`.',
    );
  }
  return warm;
}

/** The headless fill-and-submit shared by every Clave source (ADR-010 / ADR-025 / ADR-028) —
 *  they differ ONLY in where the Clave came from, so the attempt policy lives in one place:
 *  ONE attempt, never retried (ADR-004), Clave discarded with the frame.
 *  The Clave arrives as a THUNK so it is fetched only once the live-session probe has missed:
 *  an already-authenticated user must not trigger a keyring-unlock prompt for a value nobody
 *  will use (review of #101). The probe runs BEFORE the latch on purpose: a cron whose session
 *  is still alive keeps working while latched, since nothing is submitted. */
async function credentialLoginFlow(
  runtime: Runtime,
  rut: Rut,
  getClave: () => Promise<string>,
  source: Exclude<LoginSource, 'browser'>,
): Promise<AuthLoginResult> {
  const start = runtime.clock.now().getTime();
  const warm = await liveSessionFor(runtime, rut);
  if (warm) {
    auditAlreadyAuthenticated(runtime, warm, source);
    return warm;
  }

  if (!INTERACTIVE_SOURCES.includes(source)) {
    const block = await readLoginBlock(runtime.store, rut.canonical);
    if (block) {
      recordAudit(runtime, {
        action: 'auth_login',
        result: 'blocked',
        rut: rut.canonical,
        source,
      });
      throw new LoginBlockedError(
        `Login desatendido bloqueado para ${rut.canonical}: el SII rechazó la Clave el ` +
          `${block.at}${block.codigo ? ` (código ${block.codigo})` : ''}. No se contactó al ` +
          'SII. Corrige la Clave y ejecuta `sii auth login --console` (o `sii auth unblock`).',
        { reason: reasonForCodigo(block.codigo), codigo: block.codigo },
      );
    }
  }

  const clave = await getClave();
  let session: PortalSession | null = null;
  try {
    session = await runtime.portal.credentialLogin({
      rut: rut.canonical,
      clave,
      destination: HOSTS.miSii,
      timeoutMs: CONSOLE_LOGIN_TIMEOUT_MS,
    });
    return await finalizeFreshSession(runtime, session, source, start);
  } catch (err) {
    // SII's verbatim rejection is what the user must see (ADR-004), so a failing latch write
    // must not replace it with a disk error.
    if (siiJudgedClave(err)) {
      await tripLoginBlock(runtime, rut.canonical, err.codigo).catch(() => undefined);
    }
    recordAudit(runtime, {
      action: 'auth_login',
      result: 'failed',
      reason: `${source}_login`,
      source,
    });
    throw err;
  } finally {
    await session?.close();
  }
}

/** The RUT renderings a human plausibly stored the entry under, in lookup order. The
 *  keyring is populated BY HAND (`secret-tool`, Seahorse, Keychain Access), so the code
 *  adapts to the human rather than the reverse (ADR-025). `Rut.parse` already upper-cases
 *  a `k`, so the canonical form covers that variant. */
export function keyringAccounts(rut: Rut): string[] {
  return [rut.canonical, rut.formatted, String(rut.body)];
}

/** CLI-only keyring login (ADR-025): the Clave comes from the OS keyring instead of the
 *  terminal, and everything else matches `consoleLogin` — ONE attempt, cookies-only
 *  session, Clave never persisted by us nor audited. Nothing calls this implicitly: an
 *  expired session still requires the user to run the verb again (ADR-019 lineage). */
export async function keyringLogin(
  runtime: Runtime,
  args: { rut: string },
): Promise<AuthLoginResult> {
  // Mod-11 BEFORE anything else: a malformed RUT must never become a wasted SII attempt
  // (ADR-004), and it must not raise a keyring prompt either.
  const rut = Rut.parse(args.rut);
  const secrets = runtime.secrets;
  if (!secrets) {
    throw new CredentialNotFoundError(
      'Este runtime no tiene acceso al llavero (SecretStore). Usa `sii auth login --console`.',
    );
  }
  return credentialLoginFlow(
    runtime,
    rut,
    async () => {
      const accounts = keyringAccounts(rut);
      for (const account of accounts) {
        const clave = await secrets.get(account);
        if (clave) return clave;
      }
      throw new CredentialNotFoundError(
        `No hay Clave en el llavero para ${rut.canonical} (servicio "${KEYRING_SERVICE}"). ` +
          `Guárdala con:\n` +
          `  Linux:  secret-tool store --label='SII' service ${KEYRING_SERVICE} username ${rut.canonical}\n` +
          `  macOS:  security add-generic-password -s ${KEYRING_SERVICE} -a ${rut.canonical} -w`,
      );
    },
    'keyring',
  );
}

/** Lift the rejection latch (ADR-028) for one RUT, or for all when none is given. A local
 *  wipe: nothing is sent to SII. Returns the RUTs that were latched. */
export async function unblockLogin(
  runtime: Runtime,
  args: { rut?: string } = {},
): Promise<string[]> {
  const rut = args.rut === undefined ? undefined : Rut.parse(args.rut).canonical;
  const lifted = await clearLoginBlock(runtime.store, rut);
  recordAudit(runtime, { action: 'auth_unblock', result: 'ok', count: lifted.length });
  return lifted;
}

/** Server-side close (best-effort) + wipe local session + operate context. */
export async function logout(runtime: Runtime): Promise<AuthLogoutResult> {
  const session = await readSession(runtime.store);
  if (!session) {
    recordAudit(runtime, { action: 'logout', result: 'ok', serverClosed: false });
    return { loggedOut: false, serverClosed: false, www2Closed: false };
  }

  let serverClosed = false;
  let www2Closed = false;
  let s: PortalSession | null = null;
  try {
    s = await runtime.portal.restore(session.cookies);
    if (session.www2) {
      // The www2 layer first (ADR-026): its close is the SPA's own `$logout` URL; "closed" =
      // we came back off that path. Best-effort like the classic one.
      try {
        const url = `${WWW2_SESSION_CLOSE_URL}?originalUrl=${encodeURIComponent(WWW2_APP_CARPETA)}`;
        const landed = await s.goto(url);
        www2Closed = new URL(landed).pathname !== new URL(WWW2_SESSION_CLOSE_URL).pathname;
      } catch {
        // best-effort
      }
    }
    const landed = await s.goto(LOGOUT_URL);
    serverClosed = new URL(landed).pathname !== new URL(LOGOUT_URL).pathname;
  } catch {
    // best-effort server close; the local wipe still runs
  } finally {
    await s?.close();
  }

  await deleteSession(runtime.store);
  await clearOperateState(runtime.store);
  recordAudit(runtime, {
    action: 'logout',
    result: 'ok',
    rut: session.rut,
    serverClosed,
    ...(session.www2 ? { www2Closed } : {}),
  });
  return { loggedOut: true, serverClosed, www2Closed };
}

/** Curated identity readback from the portal. Requires a live session (no implicit
 *  login) — acquired via `withSession`; here an expired jar is an explicit
 *  NotAuthenticated (URL-based detection), since the whole job is the readback. */
export async function statusRefresh(runtime: Runtime): Promise<AuthIdentityRefresh> {
  return withSession(runtime, async (s) => {
    if (landedOnLoginHost(await s.goto(HOSTS.miSii))) {
      throw new SessionExpiredError('La sesión expiró. Ejecuta `sii auth login`.');
    }
    const identity = identityOnRead(await readDatos(s));
    // The www2 layer, read live: a missing one is a plain `false` here, not an error — the
    // classic identity is the job; the layer is reported (ADR-026).
    let www2: AuthWww2Status = NO_WWW2;
    try {
      await readWww2Session(s, WWW2_APP_CARPETA);
      const stored = await readSession(runtime.store);
      www2 = { authenticated: true, expiresAt: stored?.www2?.expiresAt ?? null };
    } catch (e) {
      if (!(e instanceof Www2SessionError)) throw e;
    }
    recordAudit(runtime, { action: 'auth_status_refresh', result: 'ok', rut: identity.rut });
    return { ...identity, www2 };
  });
}

/** whoami — the session PRINCIPAL's own razón social/nombre + email, read live from
 *  the portal (like `statusRefresh`, plus the email). Session-keyed: ignores the
 *  operate pointer (no `--rut`). The audit records ONLY that a whoami read happened
 *  (keyed by rut) — never the razón social / email VALUES: that PII stays off the
 *  receipt, the LLM-facing MCP description declares the exposure instead (ADR-006). */
export async function whoami(runtime: Runtime): Promise<AuthWhoami> {
  return withSession(runtime, async (s) => {
    if (landedOnLoginHost(await s.goto(HOSTS.miSii))) {
      throw new SessionExpiredError('La sesión expiró. Ejecuta `sii auth login`.');
    }
    const datos = await readDatos(s);
    const identity = identityOnRead(datos);
    const email = (datos?.contribuyente?.eMail ?? '').trim() || null;
    recordAudit(runtime, { action: 'whoami', result: 'ok', rut: identity.rut });
    return { rut: identity.rut, accountType: identity.accountType, nombre: identity.nombre, email };
  });
}
