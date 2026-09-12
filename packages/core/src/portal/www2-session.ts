// The www2 APP SESSION — the second cookies-only layer every `www2.sii.cl/app/*` facade needs
// (ADR-026). Shared by all www2 apps (first: Carpeta Tributaria, `carpeta-tributaria-regular.ts`),
// so a new app reuses this read instead of inventing a per-app warm-up.
//
// Observed 2026-09-11/12 (#110; docs/sii-contract/carpeta-tributaria.md): the classic `.sii.cl`
// cookies the cookies-only login holds reach www1/www3/www4/loa but NOT `/app/<name>-api/*` — those
// answer a bare 401 until the OAuth2 flow (`/app/session/login` → `/oauthsii-v1/` → `/app/session/
// create`) minted the httpOnly `.sii.cl` pair `X-SII-STATE-CT` + `X-SII-STATE-TYPE` (~100 min). The
// SPA's own liveness read is `GET /app/session/status` (session library `j()`): 200 → JSON
// `{seconds, userId, userProfiles, userAuthType, authTime, userRte}` committed to vuex; anything
// else → no session (the SPA then bounces to `/bifurcacion`). Every app keys its API paths by
// `session.userId` VERBATIM (the canonical `<body>-<dv>` RUT, observed) — so this read is where a
// facade gets its path key; it never formats a RUT for it.
//
// Reached via `requestText`: a non-JSON 401 body is EXPECTED here, and a dead classic jar is still
// caught URL-based (the `LOGIN_HOST` bounce → `SessionExpiredError`).
import { z } from 'zod';
import { HOSTS } from '../config/index.js';
import { Www2SessionError } from '../errors/index.js';
import type { PortalSession } from '../seams/index.js';

const SESSION_STATUS_URL = `${HOSTS.portalApp}/app/session/status`;

/** The www2 app session as `/app/session/status` describes it. Only `userId` is load-bearing
 *  (it keys every `/app/<name>-api` path); the rest is kept for diagnostics. */
export interface Www2Session {
  readonly userId: string;
  readonly userAuthType: string | null;
}

// Observed 2026-09-12 (live app session). `.loose()`: the other fields ride along unvalidated.
const SessionJson = z.object({ userId: z.union([z.string(), z.number()]) }).loose();

/** Read the www2 app session (see the header). Resolves `{userId}` when one exists; raises the
 *  ACTIONABLE `Www2SessionError` (a `NotAuthenticated`) when www2 answers anything but a 200
 *  session JSON — the classic session alone never reaches this layer. `originalUrl` is the app
 *  page the SPA would pass (observed optional; the answer is the same without it). Never retried. */
export async function readWww2Session(
  session: PortalSession,
  originalUrl?: string,
): Promise<Www2Session> {
  const url =
    originalUrl === undefined
      ? SESSION_STATUS_URL
      : `${SESSION_STATUS_URL}?originalUrl=${encodeURIComponent(originalUrl)}`;
  const res = await session.requestText(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
      ...(originalUrl === undefined ? {} : { Referer: originalUrl }),
    },
  });
  let parsed: unknown = null;
  if (res.status === 200) {
    try {
      parsed = JSON.parse(res.body) as unknown;
    } catch {
      parsed = null; // the SPA shell HTML (a 200 on a cold hit) is "no session" too
    }
  }
  const app = parsed === null ? null : SessionJson.safeParse(parsed);
  if (!app || !app.success) {
    throw new Www2SessionError(
      'No hay sesión en la plataforma www2 del SII (www2.sii.cl/app/*), que autoriza con una ' +
        'sesión propia (login OAuth) y no con la sesión de Mi SII que esta herramienta guarda ' +
        `(HTTP ${res.status}${res.status === 200 ? ' sin JSON de sesión' : ''} en ` +
        '/app/session/status). Iniciarla aún no está soportado — ADR-026 la define como un ' +
        'segundo login en el navegador (`sii auth login --www2`, pendiente).',
    );
  }
  const authType = app.data['userAuthType'];
  return {
    userId: String(app.data.userId),
    userAuthType: typeof authType === 'string' ? authType : null,
  };
}
