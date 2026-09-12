// Carpeta Tributaria Regular — typed facade over the `www2.sii.cl` `cte-api-carpetatributaria`
// JSON facade (`PortalSession.requestJson`). First-hand-observed, no third-party library
// (ADR-004); full wire contract + the auth-layer finding in docs/sii-contract/carpeta-tributaria.md.
//
// The SPA is `https://www2.sii.cl/carpetatributaria/generarcteregular`; its API lives under
// `/app/cte-api-carpetatributaria/{userId}/recurso/v2/carpeta-tributaria/…`. Observed 2026-09-11
// (#110), from the shipped bundles (`carpetatributaria/js/app.c2aeeb0d.js`, the shared session
// library in `chunk-vendors.659f67b1.js`) and live probes:
//
//   1. THE APP SESSION IS ITS OWN LAYER. `www2.sii.cl/app/*` authorizes by a www2 "app session"
//      minted by an OAuth2 code flow (`/app/session/login` → `/oauthsii-v1/` → `/app/session/create`),
//      NOT by the classic `.sii.cl` `NETSCAPE_LIVEWIRE.*` cookies the cookies-only login holds
//      (which DO reach www1/www3/www4/loa). With only the classic cookies every `cte-api` call —
//      and `/app/session/status` itself — answers a bare HTTP 401; the SPA then bounces to
//      `/bifurcacion` (the auth chooser). Neither `/app/session/legacy/bridge/` nor `bridge2/`
//      mints it from the classic side (probed). The `oauthsii-v1` page is a full Clave login with
//      reCAPTCHA Enterprise — and it DELETES the classic cookies on mount — so it is a login of its
//      own, never a "warm-up". Once minted (spike 2026-09-12, a human at the OAuth page) it is the
//      httpOnly `.sii.cl` cookie pair `X-SII-STATE-CT` + `X-SII-STATE-TYPE` (~100 min), so a
//      cookies-only capture holds it — and Mi SII stayed authenticated on it after the OAuth page
//      wiped the classic cookies. Minting it is an auth decision (ADR pending); this facade only
//      DETECTS it and fails actionably.
//   2. `GET /app/session/status?originalUrl=<SPA URL>` is the SPA's own session read (vendors
//      `j()`): 200 → JSON `{userId, userAuthType, t1, userProfiles}` stored in vuex; anything
//      else → no app session. The SPA keys EVERY API path by `session.userId` verbatim
//      (`app.js`: `${J}/${userId}/recurso/v2/…`), so we take the id from that JSON — never guess a
//      RUT format. Reached via `requestText` (a non-JSON 401 body is EXPECTED; a dead classic jar is
//      still caught URL-based by the `LOGIN_HOST` bounce).
//   3. LIVE CATALOG. `/instituciones` is the ONLY source of a valid `enfinCodigo` (what `/generar`
//      demands, #109). The codes drift — a hardcoded catalog went stale and SII rejected it — so
//      this module never ships one: the user's choice is validated against SII's list at call
//      time, like `--empresa` against the MIPYME chooser (ADR-023).
//
// Auth: SESSION-KEYED like F29 (ADR-005): the app session IS the principal; the task rejects a
// representing pointer up front. PII: the institution rows are a public catalog — curated, no
// `raw`. Nothing here touches the Carpeta document itself (#109, ADR-022 descriptor).
import { z } from 'zod';
import { HOSTS } from '../config/index.js';
import { CarpetaError, NotAuthenticatedError } from '../errors/index.js';
import { Rut } from '../rut/index.js';
import type { PortalSession } from '../seams/index.js';

/** The SPA page ("Generar Carpeta Tributaria Regular"): the `Referer` the API expects and the
 *  `originalUrl` the session read carries (observed 2026-09-11). */
const GENERAR_PAGE = `${HOSTS.portalApp}/carpetatributaria/generarcteregular`;
const SESSION_STATUS_URL = `${HOSTS.portalApp}/app/session/status`;
const API = `${HOSTS.portalApp}/app/cte-api-carpetatributaria`;

// The SPA's XHR headers (observed 2026-09-11): a JSON Accept + the page as Referer.
const HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  Referer: GENERAR_PAGE,
};

/** The www2 app session as `/app/session/status` describes it (observed 2026-09-12:
 *  `{seconds, userId, userProfiles[], userAuthType, authTime, userRte}`). Only `userId` is
 *  load-bearing (it keys every `cte-api` path — the canonical `<body>-<dv>` RUT, observed);
 *  the rest is kept for diagnostics. */
export interface CarpetaAppSession {
  readonly userId: string;
  readonly userAuthType: string | null;
}

/** A destination institution the Carpeta can be addressed to — SII's live catalog row, curated
 *  (all 8 observed keys; a public registry of entities, no taxpayer data). `codigo` is the
 *  `enfinCodigo` that `/generar` demands (#109); kept as a STRING because SII zero-pads some
 *  (`"016"`, `"059"`) and not others (`"1005"`) and compares it verbatim. */
export interface CarpetaInstitucion {
  readonly codigo: string;
  readonly descripcion: string | null;
  readonly abreviacion: string | null;
  /** SII's institution class (`enfinTipo`, observed 3 = corredora, 4 = otra; catalog-defined). */
  readonly tipo: number | null;
  /** The institution's own RUT (canonical), or null. Public entity data. */
  readonly rut: string | null;
  readonly vigenteDesde: string | null; // ISO YYYY-MM-DD
  /** null = still vigente (observed on every row so far). */
  readonly vigenteHasta: string | null; // ISO YYYY-MM-DD
}

// --- Wire shapes (zod-at-the-boundary, ADR-011) ---------------------------------------
// `.loose()` rows: unobserved fields survive; projection is alias-tolerant (observed name
// first — ADR-004). `/instituciones` answers a BARE JSON ARRAY (no SDI `respEstado` envelope —
// this is the newer `cte-api`, not the www4 SDI facades).
const Row = z.record(z.string(), z.unknown());
const Instituciones = z.array(Row);
// Observed 2026-09-12 (live app session): `{seconds, userId, userProfiles, userAuthType, authTime,
// userRte}` — `userId` is the canonical RUT (`<body>-<dv>`).
const AppSession = z.object({ userId: z.union([z.string(), z.number()]) }).loose();

// Observed 2026-09-12 on `/instituciones` (67 rows): `{enfinCodigo, enfinDescripcion,
// enfinAbreviacion, enfinFechaVigDesde, enfinFechaVigHasta, enfinTipo, enfinRutInstitucion,
// enfinDvInstitucion}` — the SPA itself reads `e.enfinCodigo` / `e.enfinAbreviacion`.
const ALIASES = {
  codigo: ['enfinCodigo', 'codigo'],
  descripcion: ['enfinDescripcion', 'descripcion'],
  abreviacion: ['enfinAbreviacion', 'abreviacion'],
  tipo: ['enfinTipo', 'tipo'],
  rutDigits: ['enfinRutInstitucion', 'rutInstitucion'],
  dv: ['enfinDvInstitucion', 'dvInstitucion'],
  vigenteDesde: ['enfinFechaVigDesde', 'fechaVigDesde'],
  vigenteHasta: ['enfinFechaVigHasta', 'fechaVigHasta'],
} as const;

function aliasGet(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) if (row[k] !== undefined && row[k] !== null) return row[k];
  return undefined;
}
const asStr = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'number') return String(v);
  return null;
};
const asInt = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};
// `enfinRutInstitucion` (digits) + `enfinDvInstitucion` → canonical, Mod-11-checked; null if odd.
const canonicalRutFrom = (digits: unknown, dv: unknown): string | null =>
  digits === undefined || dv === undefined
    ? null
    : (Rut.tryParse(`${String(digits)}-${String(dv).trim()}`)?.canonical ?? null);

function curate(row: Record<string, unknown>): CarpetaInstitucion {
  const codigo = asStr(aliasGet(row, ALIASES.codigo));
  if (codigo === null) {
    // A row without its key field means the shape moved: fail loud, never guess (ADR-004).
    throw new CarpetaError(
      'Scraper roto: una fila de /instituciones (Carpeta Tributaria) no trae `enfinCodigo`; ' +
        'el SII cambió la forma de la lista.',
    );
  }
  return {
    codigo,
    descripcion: asStr(aliasGet(row, ALIASES.descripcion)),
    abreviacion: asStr(aliasGet(row, ALIASES.abreviacion)),
    tipo: asInt(aliasGet(row, ALIASES.tipo)),
    rut: canonicalRutFrom(aliasGet(row, ALIASES.rutDigits), aliasGet(row, ALIASES.dv)),
    vigenteDesde: asStr(aliasGet(row, ALIASES.vigenteDesde)),
    vigenteHasta: asStr(aliasGet(row, ALIASES.vigenteHasta)),
  };
}

/** Read the www2 APP session (see the header, point 2). Resolves `{userId}` when one exists;
 *  raises an ACTIONABLE `CarpetaError` when www2 answers anything but a 200 session JSON — the
 *  classic cookies-only session does not reach this layer (observed 2026-09-11). Exported so a
 *  multi-step flow (#109: session → instituciones → generar → pdf) reads it ONCE. */
export async function readAppSession(session: PortalSession): Promise<CarpetaAppSession> {
  const url = `${SESSION_STATUS_URL}?originalUrl=${encodeURIComponent(GENERAR_PAGE)}`;
  const res = await session.requestText(url, { method: 'GET', headers: HEADERS });
  let parsed: unknown = null;
  if (res.status === 200) {
    try {
      parsed = JSON.parse(res.body) as unknown;
    } catch {
      parsed = null; // the SPA shell HTML (a 200 on a cold hit) is "no session" too
    }
  }
  const app = parsed === null ? null : AppSession.safeParse(parsed);
  if (!app || !app.success) {
    throw new CarpetaError(
      'La Carpeta Tributaria vive en la plataforma www2 del SII, que autoriza con una sesión ' +
        'propia (login OAuth en www2.sii.cl/app/session/login) y no con la sesión de Mi SII que ' +
        `esta herramienta guarda (www2 respondió HTTP ${res.status}${
          res.status === 200 ? ' sin JSON de sesión' : ''
        } en /app/session/status). ` +
        'Iniciar esa sesión aún no está soportado (ver docs/sii-contract/carpeta-tributaria.md).',
    );
  }
  const userId = String(app.data.userId);
  const authType = app.data['userAuthType'];
  return { userId, userAuthType: typeof authType === 'string' ? authType : null };
}

/** `GET …/{userId}/…/instituciones` — SII's live list of destination institutions. `userId`
 *  comes from `readAppSession` (the SPA keys the path by it verbatim). Empty array = a
 *  legitimate "no rows"; a non-array body = "scraper roto". */
export async function fetchInstituciones(
  session: PortalSession,
  app: CarpetaAppSession,
): Promise<readonly CarpetaInstitucion[]> {
  let raw: unknown;
  try {
    raw = await session.requestJson(
      `${API}/${encodeURIComponent(app.userId)}/recurso/v2/carpeta-tributaria/instituciones`,
      { method: 'GET', headers: HEADERS },
    );
  } catch (e) {
    // A dead session is an ACTIONABLE NotAuthenticated (the seam detects the login wall) — let
    // it through verbatim. Anything else (a 401 body, the wrong endpoint) is a typed CarpetaError
    // carrying the seam's verbatim detail (ADR-004), never a raw Playwright error.
    if (e instanceof NotAuthenticatedError) throw e;
    throw new CarpetaError(
      `Respuesta inesperada del SII en /instituciones (Carpeta Tributaria): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
  const parsed = Instituciones.safeParse(raw);
  if (!parsed.success) {
    throw new CarpetaError(
      'Scraper roto: /instituciones (Carpeta Tributaria) no devolvió un arreglo JSON de ' +
        'instituciones; el SII cambió la forma de la lista.',
    );
  }
  return parsed.data.map(curate);
}

/** App-session read + `/instituciones` in one call: the read behind `sii carpeta instituciones`. */
export async function listInstituciones(
  session: PortalSession,
): Promise<readonly CarpetaInstitucion[]> {
  const app = await readAppSession(session);
  return fetchInstituciones(session, app);
}

/** Validate the user's `--institucion` against SII's LIVE list and return the matching row.
 *  Fails BEFORE any `/generar` POST, naming the valid codes (like `--empresa` vs the MIPYME
 *  chooser, ADR-023) — a stale code never costs a SII round-trip. The consumer is #109. */
export function resolveInstitucion(
  codigo: string,
  instituciones: readonly CarpetaInstitucion[],
): CarpetaInstitucion {
  const wanted = codigo.trim();
  const hit = instituciones.find((i) => i.codigo === wanted);
  if (hit) return hit;
  const opciones = instituciones
    .map((i) => `${i.codigo}${i.abreviacion ? ` (${i.abreviacion})` : ''}`)
    .join(', ');
  throw new CarpetaError(
    `La institución "${wanted}" no está en la lista vigente del SII para la Carpeta Tributaria. ` +
      (instituciones.length === 0
        ? 'El SII no devolvió instituciones.'
        : `Códigos válidos (sii carpeta instituciones): ${opciones}.`),
  );
}
