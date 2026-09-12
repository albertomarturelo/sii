// The www2 APP-SESSION step of `sii auth login --www2` (ADR-026): mint the second cookies-only
// layer `www2.sii.cl/app/*` needs, the ADR-006 way — the user types the Clave into SII's real
// OAuth page in the SAME headed browser the classic login used; we keep cookies only.
//
// Observed 2026-09-11/12 (#110, docs/sii-contract/auth-login.md § www2): the app page bounces an
// app-session-less browser to `/bifurcacion` (the chooser) → `/oauthsii-v1/` (Clave + reCAPTCHA
// Enterprise, hence NEVER automated — a human types) → `/app/session/create` → back to the app,
// now holding the httpOnly `.sii.cl` pair `X-SII-STATE-CT` + `X-SII-STATE-TYPE` (~100 min). The
// OAuth page WIPES the classic cookies from the browser context on mount, so the classic jar is
// snapshotted BEFORE this step and the www2 cookies are ADDED to it — never the reverse.
import { WWW2_APP_CARPETA } from '../config/index.js';
import { LoginFailedError, Www2SessionError } from '../errors/index.js';
import { readWww2Session } from '../portal/www2-session.js';
import type { Www2Session } from '../portal/www2-session.js';
import type { PortalSession, Runtime } from '../seams/index.js';

/** Same budget as the classic headed login: a human has to read the chooser, type the Clave and
 *  pass the reCAPTCHA. */
export const WWW2_LOGIN_TIMEOUT_MS = 300_000;
/** How often the app session is re-read while the user is at the OAuth page. Each read is one
 *  cheap GET the SPA itself issues on every route change (observed), paced via `Clock.sleep`. */
export const WWW2_POLL_MS = 2_000;

/** The cookie whose expiry IS the www2 layer's expiry (observed 2026-09-12). */
export const WWW2_STATE_COOKIE = 'X-SII-STATE-CT';

/** Minimal view of a Playwright-shaped storage state. The seam types it `unknown` (opaque to the
 *  core), so the merge narrows defensively and passes through whatever it does not understand. */
interface CookieLike {
  readonly name?: unknown;
  readonly domain?: unknown;
  readonly path?: unknown;
  readonly expires?: unknown;
}
const cookiesOf = (state: unknown): unknown[] | null => {
  if (
    state &&
    typeof state === 'object' &&
    Array.isArray((state as { cookies?: unknown }).cookies)
  ) {
    return (state as { cookies: unknown[] }).cookies;
  }
  return null;
};
// Identity of a cookie for the merge: name + domain + path (a scalar entry — the fakes use plain
// strings — keys by its own JSON so it survives the union untouched).
const keyOf = (c: unknown): string => {
  if (c && typeof c === 'object') {
    const k = c as CookieLike;
    return `${String(k.name)}|${String(k.domain)}|${String(k.path)}`;
  }
  return JSON.stringify(c);
};

/** Union of the classic jar (snapshotted BEFORE the www2 step) and the jar AFTER it: every classic
 *  cookie is kept, every www2 cookie is added, and on a same-identity collision the later (www2)
 *  value wins — a fresher load-balancer/analytics cookie, never a lost classic one. Falls back to
 *  the www2 state alone only when the classic one is not a cookie list at all. */
export function mergeStorageState(classic: unknown, www2: unknown): unknown {
  const a = cookiesOf(classic);
  const b = cookiesOf(www2);
  if (!a) return www2;
  if (!b) return classic;
  const merged = new Map<string, unknown>();
  for (const c of a) merged.set(keyOf(c), c);
  for (const c of b) merged.set(keyOf(c), c);
  return { ...(www2 as object), cookies: [...merged.values()] };
}

/** ISO expiry of the www2 layer, read off `X-SII-STATE-CT` (Playwright cookies carry `expires` as
 *  epoch SECONDS; `-1` = session cookie). Null when absent or session-scoped. */
export function www2ExpiresAt(state: unknown): string | null {
  const cookies = cookiesOf(state) ?? [];
  for (const c of cookies) {
    if (!c || typeof c !== 'object') continue;
    const k = c as CookieLike;
    if (k.name !== WWW2_STATE_COOKIE) continue;
    if (typeof k.expires !== 'number' || k.expires <= 0) return null;
    const d = new Date(k.expires * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/** Drive the headed `session` (already past the classic login) to the www2 app page and wait for
 *  the user to complete SII's OAuth login there, polling the app-session read until it answers or
 *  the budget runs out. Resolves the session JSON; raises `LoginFailedError` on timeout. Any error
 *  other than "no app session yet" propagates — never retried (ADR-004). */
export async function waitForWww2Session(
  runtime: Runtime,
  session: PortalSession,
  timeoutMs: number = WWW2_LOGIN_TIMEOUT_MS,
): Promise<Www2Session> {
  const start = runtime.clock.now().getTime();
  await session.goto(WWW2_APP_CARPETA);
  for (;;) {
    try {
      return await readWww2Session(session, WWW2_APP_CARPETA);
    } catch (e) {
      if (!(e instanceof Www2SessionError)) throw e;
    }
    if (runtime.clock.now().getTime() - start >= timeoutMs) {
      throw new LoginFailedError(
        'Login www2 no completado (tiempo agotado en la página OAuth del SII). La sesión de ' +
          'Mi SII sí quedó guardada; reintenta `sii auth login --www2` para la capa www2.',
      );
    }
    await runtime.clock.sleep(WWW2_POLL_MS);
  }
}
