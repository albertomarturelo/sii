// F29 — Declaración Mensual de IVA (read-only). Typed facade over `PortalSession.requestJson`.
// Ported from the proven Python sii-cli (portal/f29.py + docs/sii-contract/f29.md); the wire
// contract is first-hand-observed there (live capture 2026-06-12, prod), NOT a third-party
// library (ADR-004). Full contract: docs/sii-contract/f29.md.
//
// The F29 portal is the Angular SPA at `https://www4.sii.cl/propuestaf29ui/` — its own app
// (own Referer), same SDI envelope family as RCV/F22. Two read facades:
//   1. getDeclaracionConCondicionesYTipoPropuesta — SII's pre-filled F29 PROPUESTA (borrador)
//      for a (RUT, período): data:{tipopropuesta, estado, listCodPropuestos[], listCodAdministrativos[], …}.
//   2. getDeclaracionConEstados — the PRESENTED F29 records: data:[{estadoDeclaracionId, estado,
//      folio, declFechaCreacion, …}] (empty [] = nothing filed for the período).
//
// SESSION-KEYED (ADR-005): F29 authorizes by the session principal — confirmed live (Python,
// 2026-06-26) that setting the body RUT to a represented empresa returns
// `Consulta RUT[…] no esta autorizado`. The task therefore reads ONLY self and rejects a
// representing operate pointer up front (tasks/f29.ts); the empresa's F29 needs the empresa's
// own session (logout→login). The facade itself just posts the RUT it is handed.
//
// PII: the propuesta response carries identity PII in a SEPARATE array (`listCodBase`:
// nombre/RUT/dirección/comuna) and the PP29 calc `traza` EMBEDS the RUT; the estado rows carry
// `monto` (the taxpayer's financial position). Those are DROPPED — F29 curates ONLY the tax
// códigos (listCodPropuestos + listCodAdministrativos) and the estado metadata, and exposes NO
// `raw` (like F22), so identity/financial PII never reaches a surface/LLM/audit. The tax códigos
// live in their own arrays, cleanly segregated from `listCodBase`, so (unlike F22) no per-código
// denylist is needed — we simply never read the PII arrays. Error channel is `metaData.errors`
// (a list of {id, descripcion}) — like F22, NOT RCV's `respEstado`.
import { z } from 'zod';
import { HOSTS } from '../config/index.js';
import { F29Error, NotAuthenticatedError } from '../errors/index.js';
import type { Rut } from '../rut/index.js';
import type { Periodo } from '../periodo/index.js';
import type { JsonRequest, PortalSession } from '../seams/index.js';

const F29_BASE = `${HOSTS.portalApi}/propuestaf29ui/services/data/facadeAdapterService`;
const PROPUESTA_URL = `${F29_BASE}/getDeclaracionConCondicionesYTipoPropuesta`;
const ESTADO_URL = `${F29_BASE}/getDeclaracionConEstados`;
const PROPUESTA_NAMESPACE =
  'cl.sii.sdi.lob.iva.propuestaf29.data.api.interfaces.FacadeAdapterService/getDeclaracionConCondicionesYTipoPropuesta';
const ESTADO_NAMESPACE =
  'cl.sii.sdi.lob.iva.propuestaf29.data.api.interfaces.FacadeAdapterService/getDeclaracionConEstados';
// Internal F29 form id (the form número is 29; SII's internal id is "2"). The propuesta sends it
// as `formCodigo`, the estado as `formId` — SII's own naming inconsistency, observed (f29.md).
const FORM_CODIGO = '2';
const CONVERSATION_COOKIE = 'TOKEN';

// Per-surface headers — Referer is the F29 propuesta SPA root (differs from RCV/F22).
const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Origin: HOSTS.portalApi,
  Referer: `${HOSTS.portalApi}/propuestaf29ui/`,
  Accept: 'application/json, text/plain, */*',
};

/** One código of the F29 (proposed or administrative). `valor` is numeric — usually an integer
 *  monto, occasionally a rate (e.g. código 115 = PPM tasa `0.125`), so floats are preserved.
 *  `glosa` is null until observed + cited (the SII propuesta payload ships códigos sin glosa). */
export interface CodigoF29 {
  readonly codigo: string;
  readonly valor: number | null;
}

/** The IVA propuesta (SII's pre-filled F29 draft) for one (RUT, período). Curated to the TAX
 *  códigos only: `codigos` (listCodPropuestos — the proposed F29 lines) + `codigosAdministrativos`
 *  (listCodAdministrativos — the 91xx control mirror). The identity PII (`listCodBase`) and the
 *  PP29 `traza` (embeds the RUT) are DROPPED; F29 exposes NO `raw` (ADR-004/ADR-006). */
export interface F29Propuesta {
  readonly rut: string; // session principal (canonical)
  readonly periodo: string; // YYYY-MM
  /** SII returned a propuesta for the período (`data` non-null). `false` = sin propuesta. */
  readonly tienePropuesta: boolean;
  readonly tipoPropuesta: number | null; // `tipopropuesta` — the propuesta-type id
  readonly estado: number | null; // `estado` — the propuesta-estado id
  readonly descripcionEstado: string | null;
  readonly codigos: readonly CodigoF29[]; // listCodPropuestos (the proposed F29 lines)
  readonly codigosAdministrativos: readonly CodigoF29[]; // listCodAdministrativos (91xx mirror)
}

/** One presented/saved F29 record for the período (a row of `getDeclaracionConEstados`). NOT PII
 *  — the form metadata only. `monto` (the taxpayer's financial position) is DROPPED on purpose
 *  (PII-minimal, like F22's bank/identity exclusion); read the estado to know IF/how it was filed,
 *  not the amount. */
export interface DeclaracionEstadoF29 {
  readonly estadoId: number | null; // `estadoDeclaracionId` — read `estado` (the label) instead
  readonly estado: string | null; // human label, e.g. "Guardada" (draft) / "Vigente" (filed)
  readonly folio: number | null; // presentation folio (0 when only saved, not filed)
  readonly fecha: string | null; // `declFechaCreacion`, verbatim SII format (DD/MM/YYYY)
  readonly enNegocio: boolean | null;
  readonly codigo: number | null;
}

/** The presented-F29 status for one (RUT, período): the declaración records SII holds. Empty
 *  `declaraciones` (wire `data:[]`) is a legitimate "nada presentado", NOT an error. */
export interface F29Estado {
  readonly rut: string; // session principal (canonical)
  readonly periodo: string; // YYYY-MM
  readonly tieneDeclaracion: boolean; // any record exists for the período
  readonly declaraciones: readonly DeclaracionEstadoF29[];
}

// --- Wire envelope (zod-at-the-boundary, ADR-011) --------------------------------
// F29's error channel is `metaData.errors` (like F22, NOT RCV's respEstado). Keep `errors` and
// `data` opaque (propuesta `data` is an object, estado `data` is an array) and extract below.
const Envelope = z
  .object({
    metaData: z.object({ errors: z.unknown().nullish() }).loose().nullish(),
    data: z.unknown(),
  })
  .loose();
type Envelope = z.infer<typeof Envelope>;

// Alias-tolerant lookups (observed name first; extend with a citation when SII serves a new key).
const CODIGO_ALIASES = {
  codigo: ['codigo', 'cod'],
  valor: ['valor', 'monto'],
} as const;
const ESTADO_ALIASES = {
  estadoId: ['estadoDeclaracionId', 'estadoId'],
  estado: ['estado', 'glosaEstado', 'descripcionEstado'],
  folio: ['folio', 'folioDeclaracion'],
  fecha: ['declFechaCreacion', 'fechaCreacion', 'fecha'],
  enNegocio: ['enNegocio'],
  codigo: ['codigo', 'cod'],
} as const;

const aliasGet = (row: Record<string, unknown>, aliases: readonly string[]): unknown => {
  for (const key of aliases) {
    const v = row[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};
const asStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Parse an F29 `valor`. SII's propuesta serves numbers WITHOUT thousands separators and with a
 *  `.` decimal point (e.g. monto `"2709150"` → 2709150; PPM tasa código 115 `"0.125"` → 0.125),
 *  so a plain `Number()` is correct here — unlike F22, whose grid is es-CL-formatted. Floats are
 *  preserved (an int-only coercion would silently drop a rate like 0.125 to null). */
const asNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};

/** `enNegocio` arrives as a bool or "S"/"N"/1/0 (exact form unconfirmed). Tolerant. */
function coerceBool(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toUpperCase();
  if (['S', 'SI', 'TRUE', '1'].includes(s)) return true;
  if (['N', 'NO', 'FALSE', '0'].includes(s)) return false;
  return null;
}

/** `metaData.errors`: a list/dict of `{descripcion}`, or a string. Non-empty ⇒ SII signaled a
 *  business error → its `descripcion` verbatim (ADR-004), else null. (Mirrors F22's channel.) */
function f29Error(errors: unknown): string | null {
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

/** Split a `Periodo` into the `{mes, anno}` pair the F29 facades expect (both strings; `mes`
 *  zero-padded). The combined `YYYYMM` form is NOT used by these endpoints (observed). */
const mesAnno = (periodo: Periodo): { mes: string; anno: string } => ({
  mes: String(periodo.month).padStart(2, '0'),
  anno: String(periodo.year),
});

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
    body: {
      metaData: { namespace, conversationId, transactionId: globalThis.crypto.randomUUID() },
      data,
    },
  };
  let raw: unknown;
  try {
    raw = await session.requestJson(url, request);
  } catch (e) {
    // An expired/dead session (the seam raises it) is actionable — let it through so the user is
    // told to re-login, not a misleading "no es JSON".
    if (e instanceof NotAuthenticatedError) throw e;
    throw new F29Error('Respuesta inesperada de SII (no es JSON).');
  }
  const parsed = Envelope.safeParse(raw);
  if (!parsed.success)
    throw new F29Error('Respuesta inesperada de SII (no es un objeto JSON del F29).');
  const err = f29Error(parsed.data.metaData?.errors);
  if (err) throw new F29Error(err);
  return parsed.data;
}

/** Project a código array (`[{codigo, valor}]`) into curated rows, dropping entries without a
 *  código. Used for BOTH listCodPropuestos and listCodAdministrativos (same row shape). */
function parseCodigos(arr: unknown): CodigoF29[] {
  if (!Array.isArray(arr)) return [];
  const out: CodigoF29[] = [];
  for (const r of arr) {
    if (!isObj(r)) continue;
    const codigo = asStr(aliasGet(r, CODIGO_ALIASES.codigo));
    if (codigo === null) continue;
    out.push({ codigo, valor: asNumber(aliasGet(r, CODIGO_ALIASES.valor)) });
  }
  return out;
}

/** getDeclaracionConCondicionesYTipoPropuesta — the IVA propuesta (pre-filled F29 draft). A
 *  `data:null` envelope (no errors) is a legitimate "sin propuesta", NOT an error. Curates the
 *  tax códigos only; identity PII (`listCodBase`) and the PP29 `traza` are never read. */
export async function fetchF29Propuesta(
  session: PortalSession,
  params: { rut: Rut; periodo: Periodo },
): Promise<F29Propuesta> {
  const { rut, periodo } = params;
  const env = await postSdi(session, PROPUESTA_URL, PROPUESTA_NAMESPACE, {
    rutContribuyente: String(rut.body),
    dv: rut.dv,
    formCodigo: FORM_CODIGO,
    ...mesAnno(periodo),
  });
  const base = {
    rut: rut.canonical,
    periodo: periodo.formatted,
  };
  const data = env.data;
  if (!isObj(data)) {
    // data:null ⇒ no propuesta for the período (clean negative).
    return {
      ...base,
      tienePropuesta: false,
      tipoPropuesta: null,
      estado: null,
      descripcionEstado: null,
      codigos: [],
      codigosAdministrativos: [],
    };
  }
  return {
    ...base,
    tienePropuesta: true,
    tipoPropuesta: asNumber(data['tipopropuesta']),
    estado: asNumber(data['estado']),
    descripcionEstado: asStr(data['descripcionEstado']),
    codigos: parseCodigos(data['listCodPropuestos']),
    codigosAdministrativos: parseCodigos(data['listCodAdministrativos']),
  };
}

/** getDeclaracionConEstados — the presented/saved F29 records for the período. Empty `data:[]`
 *  is a legitimate "nada presentado", NOT an error. The estado uses `formId`/`rut` (vs the
 *  propuesta's `formCodigo`/`rutContribuyente`) — SII's own naming inconsistency (observed).
 *  `monto` is intentionally dropped (financial PII). */
export async function fetchF29Estado(
  session: PortalSession,
  params: { rut: Rut; periodo: Periodo },
): Promise<F29Estado> {
  const { rut, periodo } = params;
  const env = await postSdi(session, ESTADO_URL, ESTADO_NAMESPACE, {
    rut: String(rut.body),
    dv: rut.dv,
    formId: FORM_CODIGO,
    ...mesAnno(periodo),
  });
  const rows = Array.isArray(env.data) ? env.data : [];
  const declaraciones: DeclaracionEstadoF29[] = rows.filter(isObj).map((r) => ({
    estadoId: asNumber(aliasGet(r, ESTADO_ALIASES.estadoId)),
    estado: asStr(aliasGet(r, ESTADO_ALIASES.estado)),
    folio: asNumber(aliasGet(r, ESTADO_ALIASES.folio)),
    fecha: asStr(aliasGet(r, ESTADO_ALIASES.fecha)),
    enNegocio: coerceBool(aliasGet(r, ESTADO_ALIASES.enNegocio)),
    codigo: asNumber(aliasGet(r, ESTADO_ALIASES.codigo)),
  }));
  return {
    rut: rut.canonical,
    periodo: periodo.formatted,
    tieneDeclaracion: declaraciones.length > 0,
    declaraciones,
  };
}
