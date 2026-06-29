// F22 — Declaración Anual de Renta (estado / readback, read-only). Typed facade over
// `PortalSession.requestJson`. Ported from the proven Python sii-cli (portal/f22.py);
// wire contract first-hand-observed there (spike #67, live-captured 2026-06-27, prod),
// NOT a third-party library (ADR-004). Full contract: docs/sii-contract/f22.md.
//
// The F22-status portal is the Angular SPA at `https://www4.sii.cl/consultaestadof22ui/`
// — a DIFFERENT app from RCV's `consdcvinternetui` (own Referer), same SDI envelope.
// `f22 status` composes TWO facades under ONE session:
//   1. buscaDeclVgte (data:{periodo, rut, dv}) → data.{decls[], glosas[]} — the año's
//      declaraciones + their estado (codConc → glosas[].descripcion).
//   2. f22Compacto (data:{rut, dv, periodo, folio}) → data:[{codigo, valor, glosa}] —
//      the código grid for the selected folio (glosas ship INLINE).
//
// SESSION-KEYED (ADR-005): F22 authorizes by the session principal — confirmed live
// 2026-06-27 that a persona's `--rut <empresa>` returns a CLEAN NEGATIVE, not the
// empresa's F22. The body RUT does not redirect it; the empresa's F22 needs the
// empresa's own session (logout→login). The task therefore defaults to self.
//
// PII: the f22Compacto grid mixes tax-result códigos with HEADER/identity/bank códigos
// (nombre/RUT/dirección/giro/email + bank account). Those are DROPPED entirely — F22
// exposes NO `raw` (unlike RCV), so the PII never reaches a surface/LLM/audit (see the
// NOTE on the curated types below). Error envelope is `metaData.errors`
// (a list of {id, descripcion}) — NOT RCV's `respEstado.codRespuesta`.
import { z } from 'zod';
import { HOSTS } from '../config/index.js';
import { F22Error, NotAuthenticatedError } from '../errors/index.js';
import type { Rut } from '../rut/index.js';
import type { Anio } from '../periodo/index.js';
import type { JsonRequest, PortalSession } from '../seams/index.js';
// The código taxonomy (PII denylist + contador grouping) lives in its own domain module —
// it changes when we observe a new código, not when the wire changes. Re-exported below so
// the public surface (the barrel) is unchanged.
import { isHeaderCodigo } from './f22-codigos.js';
export { groupCodigos, isHeaderCodigo } from './f22-codigos.js';
export type { CodigoF22, F22Grupos } from './f22-codigos.js';
import type { CodigoF22, F22Grupos } from './f22-codigos.js';

const F22_BASE = `${HOSTS.portalApi}/consultaestadof22ui/services/data/facadeService`;
const BUSCA_DECL_URL = `${F22_BASE}/buscaDeclVgte`;
const F22_COMPACTO_URL = `${F22_BASE}/f22Compacto`;
// Namespace was best-guess from the SDI pattern (área renta / app consultaestadof22);
// SII ACCEPTED it live 2026-06-27 (returned the real código grid). The URL path routes.
const BUSCA_DECL_NAMESPACE =
  'cl.sii.sdi.lob.renta.consultaestadof22.data.api.interfaces.FacadeService/buscaDeclVgte';
const F22_COMPACTO_NAMESPACE =
  'cl.sii.sdi.lob.renta.consultaestadof22.data.api.interfaces.FacadeService/f22Compacto';
// NOTE on `f22Completo`: a sibling endpoint exists, but live capture (spike #27, 2026-06-29)
// showed it returns f22Compacto's códigos PLUS internal control códigos (3056/8891/8865…) and
// extra PII (9306/9920) — i.e. NOISIER, not richer in tax content. The real "formulario
// completo" the SII renders (and its PDF) is built from `f22Compacto` + `codigosFormato` (the
// form skeleton). So `--full` reads `f22Compacto` (same source as the compact view) and adds
// the contador grouping — it does NOT use f22Completo. (ADR-004: first-hand obs over the port.)
// Observaciones (inconsistencias) of a folio — observed live 2026-06-29 (spike #26, own
// session): data:{periodo,rut,dv,folio} → data:[{codigo,descripcion,url}]. Same SPA /
// namespace family as the status facades. Rows are NOT PII (observación code + glosa +
// SII ayuda URL). The sibling `buscaObservacion` (per carta — needs referencia/idCarta
// from buscaEventos) is the historial detail, deferred to #28; situacionObservacion
// gives the vigente observaciones from the folio alone.
const SITUACION_OBS_URL = `${F22_BASE}/situacionObservacion`;
const SITUACION_OBS_NAMESPACE =
  'cl.sii.sdi.lob.renta.consultaestadof22.data.api.interfaces.FacadeService/situacionObservacion';
const CONVERSATION_COOKIE = 'TOKEN';

// Per-surface headers — Referer is the F22-status SPA root (differs from RCV/F29).
const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Origin: HOSTS.portalApi,
  Referer: `${HOSTS.portalApi}/consultaestadof22ui/`,
  Accept: 'application/json, text/plain, */*',
};

// NOTE: F22 deliberately exposes NO `raw` (the usual curated+raw convention is for
// tax edge-cases). The non-curated F22 data — decl `nombres`/`calle`/`comuna`/`cta`/
// `bco` and the header códigos — is pure identity/bank PII, not tax detail (all tax
// códigos ARE curated). Dropping raw keeps that PII from ever reaching a surface/LLM.
export interface DeclaracionF22 {
  readonly folio: string | null;
  readonly vigente: boolean | null; // `vgte`
  readonly estado: string | null; // codConc → glosas[].descripcion
  readonly fecha: string | null; // fecIng, verbatim
  readonly tipoImpugnado: string | null;
}

/** Step 1 — the año's declaraciones + estado (no código grid). The overview surface. */
export interface F22Declaraciones {
  readonly rut: string; // operating RUT (canonical)
  readonly anio: string; // YYYY
  readonly tieneDeclaracion: boolean;
  readonly declaraciones: readonly DeclaracionF22[];
}

/** Full readback for one (RUT, año): the selected declaración + its código grid (always
 *  `f22Compacto`, identity/bank PII dropped). On a `--full` read `grupos` adds the contador
 *  split over the SAME `codigos`; otherwise `grupos` is absent and the output is the flat grid. */
export interface F22Estado extends F22Declaraciones {
  readonly folio: string | null; // selected declaración's folio
  readonly estado: string | null; // selected declaración's estado glosa
  readonly codigos: readonly CodigoF22[]; // identity/bank PII códigos excluded
  readonly grupos?: F22Grupos; // present only on a `--full` read
}

/** One observación (inconsistencia) on a declaración. NOT PII — observación code + glosa
 *  + the SII ayuda URL — so every field is curated (no header-código exclusion, no `raw`). */
export interface ObservacionF22 {
  readonly codigo: string; // observación code, e.g. "B102" / "G37"
  readonly descripcion: string | null; // glosa verbatim (SII serves it inline)
  readonly url: string | null; // SII ayuda PDF for correcting the observación
}

// --- Wire envelope (zod-at-the-boundary, ADR-011) --------------------------------
// F22's error channel is `metaData.errors` (NOT RCV's respEstado). Keep `errors` and
// `data` opaque (shapes differ per endpoint) and extract tolerantly below.
const Envelope = z
  .object({
    metaData: z.object({ errors: z.unknown().nullish() }).loose().nullish(),
    // situacionObservacion ALSO signals errors via a top-level `errorMsg`/`respCod`
    // (observed 2026-06-29); buscaDeclVgte/f22Compacto leave them absent. Keep both.
    errorMsg: z.unknown().nullish(),
    respCod: z.unknown().nullish(),
    data: z.unknown(),
  })
  .loose();
type Envelope = z.infer<typeof Envelope>;

const DECL_ALIASES = {
  folio: ['folio', 'folioDeclaracion'],
  vgte: ['vgte', 'vigente'],
  codConc: ['codConc', 'codConclusion'],
  fecha: ['fecIng', 'fechaIngreso', 'fecha'],
  tipoImpugnado: ['tipoImpugnado'],
} as const;
const GLOSA_ALIASES = {
  codConc: ['codConclusion', 'codConc'],
  descripcion: ['descripcion', 'glosa'],
} as const;
const CODIGO_ALIASES = {
  codigo: ['codigo', 'cod'],
  valor: ['valor', 'monto'],
  glosa: ['glosa', 'descripcion'],
} as const;
const OBSERVACION_ALIASES = {
  codigo: ['codigo', 'cod'],
  descripcion: ['descripcion', 'glosa'],
  url: ['url', 'link'],
} as const;

const aliasGet = (row: Record<string, unknown>, aliases: readonly string[]): unknown => {
  for (const key of aliases) {
    const v = row[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};
const asStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
/** Parse a código `valor`. SII serves montos in **es-CL format** — `.` = thousands, `,` =
 *  decimals (confirmed live 2026-06-29; synthetic examples here: `"9.999"` = 9999,
 *  `"12.345.678"` = 12345678). A bare `Number()` would misparse `"9.999"` as 9.999 (off by
 *  1000×) and `"12.345.678"` as NaN (two dots). So strip the thousands dots and turn the
 *  decimal comma into a dot before parsing. Plain integers (`"177"`, `-150000`) pass through. */
const asNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).trim().replace(/\./g, '').replace(/,/g, '.'));
  return Number.isFinite(n) ? n : null;
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** `vgte` arrives as "S"/"N", a bool, or 1/0 (exact form unconfirmed). Tolerant. */
function coerceVigente(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toUpperCase();
  if (['S', 'SI', 'TRUE', '1', 'VIGENTE'].includes(s)) return true;
  if (['N', 'NO', 'FALSE', '0'].includes(s)) return false;
  return null;
}

/** `metaData.errors`: a list/dict of `{descripcion}`, or a string. Non-empty ⇒ SII
 *  signaled a business error → its `descripcion` verbatim (ADR-004), else null. */
function f22Error(errors: unknown): string | null {
  if (errors === null || errors === undefined) return null;
  if (Array.isArray(errors)) {
    const descs = errors
      .map((e) => (isObj(e) ? asStr(e['descripcion']) : null))
      .filter((d): d is string => d !== null);
    return descs.length ? descs.join('; ') : null;
  }
  if (isObj(errors)) return asStr(errors['descripcion']);
  const s = asStr(errors);
  return s && s !== '' ? s : null;
}

async function postSdi(
  session: PortalSession,
  url: string,
  namespace: string,
  data: Record<string, unknown>,
): Promise<Envelope> {
  const conversationId = (await session.cookie(`${HOSTS.portalApi}/`, CONVERSATION_COOKIE)) ?? '';
  const request: JsonRequest = {
    method: 'POST',
    headers: HEADERS,
    // F22 metaData omits `page` (observed); opaque per-request id via Web Crypto.
    body: {
      metaData: { namespace, conversationId, transactionId: globalThis.crypto.randomUUID() },
      data,
    },
  };
  let raw: unknown;
  try {
    raw = await session.requestJson(url, request);
  } catch (e) {
    // An expired/dead session (the seam raises it) is actionable — let it through.
    if (e instanceof NotAuthenticatedError) throw e;
    throw new F22Error('Respuesta inesperada de SII (no es JSON).');
  }
  const parsed = Envelope.safeParse(raw);
  if (!parsed.success)
    throw new F22Error('Respuesta inesperada de SII (no es un objeto JSON del F22).');
  const err = f22Error(parsed.data.metaData?.errors);
  if (err) throw new F22Error(err);
  // situacionObservacion surfaces a business error via the top-level `errorMsg`
  // (observed 2026-06-29); pass it verbatim (ADR-004).
  const msg = asStr(parsed.data.errorMsg);
  if (msg !== null && msg.trim() !== '') throw new F22Error(msg);
  return parsed.data;
}

const rutDigits = (rut: Rut): { rut: string; dv: string } => ({
  rut: String(rut.body),
  dv: rut.dv,
});

/** Map `glosas[]` (codConclusion → descripción) so a decl's codConc resolves to its
 *  human estado label. */
function glosaMap(data: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const glosas = isObj(data) ? data['glosas'] : undefined;
  if (!Array.isArray(glosas)) return out;
  for (const g of glosas) {
    if (!isObj(g)) continue;
    const cod = asStr(aliasGet(g, GLOSA_ALIASES.codConc));
    const desc = asStr(aliasGet(g, GLOSA_ALIASES.descripcion));
    if (cod !== null && desc !== null) out.set(cod, desc);
  }
  return out;
}

function buildDeclaraciones(data: unknown): DeclaracionF22[] {
  const decls = isObj(data) ? data['decls'] : undefined;
  if (!Array.isArray(decls)) return [];
  const glosas = glosaMap(data);
  return decls.filter(isObj).map((d) => {
    const codConc = asStr(aliasGet(d, DECL_ALIASES.codConc));
    return {
      folio: asStr(aliasGet(d, DECL_ALIASES.folio)),
      vigente: coerceVigente(aliasGet(d, DECL_ALIASES.vgte)),
      estado: codConc !== null ? (glosas.get(codConc) ?? null) : null,
      fecha: asStr(aliasGet(d, DECL_ALIASES.fecha)),
      tipoImpugnado: asStr(aliasGet(d, DECL_ALIASES.tipoImpugnado)),
    };
  });
}

/** The folio to read when none is pinned: the first vigente declaración, else the
 *  first with a folio, else null. */
export function pickVigenteFolio(declaraciones: readonly DeclaracionF22[]): string | null {
  return (
    declaraciones.find((d) => d.vigente && d.folio !== null)?.folio ??
    declaraciones.find((d) => d.folio !== null)?.folio ??
    null
  );
}

/** Step 1: `buscaDeclVgte` — the año's declaraciones + estado. Empty `decls` is a
 *  legitimate "no declaración" (tieneDeclaracion=false), NOT an error. */
export async function fetchF22Declaraciones(
  session: PortalSession,
  params: { rut: Rut; anio: Anio },
): Promise<F22Declaraciones> {
  const { rut, anio } = params;
  const env = await postSdi(session, BUSCA_DECL_URL, BUSCA_DECL_NAMESPACE, {
    periodo: anio.canonical,
    ...rutDigits(rut),
  });
  const declaraciones = buildDeclaraciones(env.data);
  return {
    rut: rut.canonical,
    anio: anio.canonical,
    tieneDeclaracion: declaraciones.length > 0,
    declaraciones,
  };
}

/** Project a código grid (`data:[{codigo,valor,glosa}]`) into rows, DROPPING the
 *  identity/bank PII códigos (HEADER_CODIGOS). Sign preserved. */
function parseCodigoGrid(data: unknown): CodigoF22[] {
  if (!Array.isArray(data)) return [];
  const out: CodigoF22[] = [];
  for (const r of data) {
    if (!isObj(r)) continue;
    const codigo = asStr(aliasGet(r, CODIGO_ALIASES.codigo));
    if (codigo === null || isHeaderCodigo(codigo)) continue; // drop identity/bank PII
    out.push({
      codigo,
      valor: asNumber(aliasGet(r, CODIGO_ALIASES.valor)),
      glosa: asStr(aliasGet(r, CODIGO_ALIASES.glosa)),
    });
  }
  return out;
}

/** `f22Compacto` — the código grid for a folio, MINUS identity/bank PII. This IS the form the
 *  SII renders (and its PDF); `--full` just adds the contador grouping over the same data via
 *  `groupCodigos` (the sibling `f22Completo` only adds internal control códigos — noisier, not
 *  richer — so it is not used). */
export async function fetchF22Grid(
  session: PortalSession,
  params: { rut: Rut; anio: Anio; folio: string },
): Promise<CodigoF22[]> {
  const { rut, anio, folio } = params;
  const env = await postSdi(session, F22_COMPACTO_URL, F22_COMPACTO_NAMESPACE, {
    ...rutDigits(rut),
    periodo: anio.canonical,
    folio,
  });
  return parseCodigoGrid(env.data);
}

/** `situacionObservacion` — the observaciones (inconsistencias) for a folio. Rows carry
 *  NO PII (observación code + glosa + ayuda URL), so all are curated and nothing is
 *  excluded; empty `data` = sin observaciones (NOT an error). Observed 2026-06-29 (#26):
 *  the request sends NUMERIC `periodo`/`folio`. */
export async function fetchF22Observaciones(
  session: PortalSession,
  params: { rut: Rut; anio: Anio; folio: string },
): Promise<ObservacionF22[]> {
  const { rut, anio, folio } = params;
  const env = await postSdi(session, SITUACION_OBS_URL, SITUACION_OBS_NAMESPACE, {
    periodo: Number(anio.canonical),
    ...rutDigits(rut),
    folio: Number(folio),
  });
  const rows = env.data;
  if (!Array.isArray(rows)) return [];
  const out: ObservacionF22[] = [];
  for (const r of rows) {
    if (!isObj(r)) continue;
    const codigo = asStr(aliasGet(r, OBSERVACION_ALIASES.codigo));
    if (codigo === null) continue;
    out.push({
      codigo,
      descripcion: asStr(aliasGet(r, OBSERVACION_ALIASES.descripcion)),
      url: asStr(aliasGet(r, OBSERVACION_ALIASES.url)),
    });
  }
  return out;
}
