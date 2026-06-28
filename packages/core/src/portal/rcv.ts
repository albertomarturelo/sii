// RCV — Registro de Compras y Ventas. Typed facade over `PortalSession.requestJson`.
// Ported from the proven Python sii-cli (portal/rcv.py); the wire contract is
// first-hand-observed there, NOT a third-party library (ADR-004).
//
// The RCV portal is an Angular SPA at `https://www4.sii.cl/consdcvinternetui/`
// fronting a JSON-over-HTTP SDI API. Endpoints in play here:
//   - getResumen — per-DTE-type aggregates (counts + montos). No captcha.
//   - getDetalleCompra / getDetalleVenta — individual DTE rows.
// Endpoints/namespaces cited from cURL captured 2026-06-07 (issue #7 spike report)
// + Angular bundle inspection 2026-06-07 (`app.full.min.js?2026428195.js`).
//
// SESSION reaches any RUT the account legally represents via the body's
// `rutEmisor`/`dvEmisor` — RCV is BODY-RUT (ADR-005), so `operate`/`--rut` selects it.
//
// Wire parsing is zod-at-the-boundary (ADR-011) for the envelope (error detection +
// the `data[]` array), then ALIAS-TOLERANT per-row projection into a curated shape
// (observed name first; extend with a citation when a new alias appears) + `raw`
// carrying the full row for tax-special fields (ADR-004 curated+raw).
import { z } from 'zod';
import { HOSTS } from '../config/index.js';
import { RcvError } from '../errors/index.js';
import { Rut } from '../rut/index.js';
import type { Periodo } from '../periodo/index.js';
import type { JsonRequest, PortalSession } from '../seams/index.js';

export type RcvSide = 'COMPRA' | 'VENTA';

const RESUMEN_URL = `${HOSTS.portalApi}/consdcvinternetui/services/data/facadeService/getResumen`;
const RESUMEN_NAMESPACE =
  'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getResumen';
const DETALLE_URL: Record<RcvSide, string> = {
  COMPRA: `${HOSTS.portalApi}/consdcvinternetui/services/data/facadeService/getDetalleCompra`,
  VENTA: `${HOSTS.portalApi}/consdcvinternetui/services/data/facadeService/getDetalleVenta`,
};
const DETALLE_NAMESPACE: Record<RcvSide, string> = {
  COMPRA: 'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getDetalleCompra',
  VENTA: 'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getDetalleVenta',
};
// The SPA's `recaptchaService.pedirToken` (bundle inspection 2026-06-07) is a no-op
// that returns this literal sentinel; the bundle never loads Google's reCAPTCHA SDK.
// Smoke-test before relying on it in case SII tightens the contract.
const RECAPTCHA_TOKEN = 't-o-k-e-n-web';
// Per-side action map (bundle `Constantes`: ACCION_DETALLE_CMPR/VTA).
const RECAPTCHA_ACTION: Record<RcvSide, string> = { COMPRA: 'RCV_DETC', VENTA: 'RCV_DETV' };
// The SPA conversation token; seeds metaData.conversationId (empty value accepted).
const CONVERSATION_COOKIE = 'TOKEN';

// Same headers as the sibling representación facade (observed): Origin = SPA host,
// Referer = SPA root.
const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Origin: HOSTS.portalApi,
  Referer: `${HOSTS.portalApi}/consdcvinternetui/`,
  Accept: 'application/json, text/plain, */*',
};

export interface RcvResumenRow {
  /** SII DTE type code (e.g. "33" factura, "34" exenta, "39" boleta). */
  readonly codigoTipoDoc: string | null;
  readonly descripcion: string | null;
  readonly totalDocumentos: number | null;
  readonly montoExento: number | null;
  readonly montoNeto: number | null;
  readonly montoIva: number | null;
  readonly montoTotal: number | null;
}

export interface RcvResumen {
  /** Operating RUT these aggregates belong to (canonical). */
  readonly rut: string;
  readonly periodo: string; // YYYY-MM
  readonly side: RcvSide;
  readonly rows: readonly RcvResumenRow[];
  /** Envelope-level `totDocRes` (total document count), or null. */
  readonly totalDocumentos: number | null;
}

/** Curated subset of the ~50-field detalle row. Tax-special fields (activo fijo,
 *  IVA uso común, Ley 18211, etc.) live in `raw` (ADR-004 curated+raw). */
export interface RcvDetalleDoc {
  readonly folio: number | null;
  readonly rutEmisor: string | null; // detRutDoc+detDvDoc canonicalised
  readonly razonSocial: string | null;
  readonly fechaEmision: string | null; // ISO YYYY-MM-DD
  readonly fechaRecepcion: string | null; // ISO YYYY-MM-DD HH:MM:SS
  readonly montoExento: number | null;
  readonly montoNeto: number | null;
  readonly montoIva: number | null;
  readonly montoTotal: number | null;
  readonly eventoReceptor: string | null;
  readonly eventoReceptorLeyenda: string | null;
  readonly raw: Record<string, unknown>;
}

export interface RcvDetalle {
  readonly rut: string;
  readonly periodo: string; // YYYY-MM
  readonly side: RcvSide;
  readonly codigoTipoDoc: string;
  readonly docs: readonly RcvDetalleDoc[];
}

// --- Wire envelope (zod-at-the-boundary, ADR-011) --------------------------------
// Validate the SDI envelope: the shared `respEstado` error block + the `data[]` rows.
// `.loose()` keeps unobserved fields so curated projection + `raw` see the full row.
const Row = z.record(z.string(), z.unknown());
const Envelope = z
  .object({
    respEstado: z
      .object({
        codRespuesta: z.union([z.number(), z.string()]).nullish(),
        msgeRespuesta: z.string().nullish(),
        codError: z.string().nullish(),
      })
      .loose()
      .nullish(),
    data: z.array(Row).nullish(),
    datos: z.array(Row).nullish(),
    totDocRes: z.union([z.number(), z.string()]).nullish(),
  })
  .loose();
type Envelope = z.infer<typeof Envelope>;

// --- Alias-tolerant field lookup (observed name first; cite new aliases) ---------
// Resumen: SII uses `rsmn*` (resumen) + `dcv*` (type metadata) prefixes — observed
// issue #9 smoke 2026-06-07 (empresa VENTA 2026-05).
const RESUMEN_ALIASES = {
  codigoTipoDoc: ['rsmnTipoDocInteger', 'codTipoDoc', 'codigoTipoDoc', 'tipoDoc'],
  descripcion: ['dcvNombreTipoDoc', 'descTipoDoc', 'glosaTipoDoc', 'descripcion'],
  totalDocumentos: ['rsmnTotDoc', 'totDoctos', 'totalDoctos', 'totalDocumentos'],
  montoExento: ['rsmnMntExe', 'mntExento', 'montoExento'],
  montoNeto: ['rsmnMntNeto', 'mntNeto', 'montoNeto'],
  montoIva: ['rsmnMntIVA', 'mntIVA', 'montoIVA', 'mntIva'],
  montoTotal: ['rsmnMntTotal', 'mntTotal', 'montoTotal'],
} as const;
// Detalle: SII uses the `det*` prefix — observed issue #12 capture 2026-06-07
// (empresa COMPRA 2026-06 codTipoDoc 34).
const DETALLE_ALIASES = {
  folio: ['detNroDoc', 'nroDoc', 'folio'],
  rutDigits: ['detRutDoc', 'rutDoc', 'rutEmisor'],
  dv: ['detDvDoc', 'dvDoc', 'dvEmisor'],
  razonSocial: ['detRznSoc', 'rznSoc', 'razonSocial'],
  fechaEmision: ['detFchDoc', 'fchDoc', 'fechaEmision'],
  fechaRecepcion: ['detFecRecepcion', 'fecRecepcion', 'fechaRecepcion'],
  montoExento: ['detMntExe', 'mntExe', 'montoExento'],
  montoNeto: ['detMntNeto', 'mntNeto', 'montoNeto'],
  montoIva: ['detMntIVA', 'mntIVA', 'montoIVA'],
  montoTotal: ['detMntTotal', 'mntTotal', 'montoTotal'],
  eventoReceptor: ['detEventoReceptor', 'eventoReceptor'],
  eventoReceptorLeyenda: ['detEventoReceptorLeyenda', 'eventoReceptorLeyenda'],
} as const;

const aliasGet = (row: Record<string, unknown>, aliases: readonly string[]): unknown => {
  for (const key of aliases) {
    const v = row[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};
const asStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const asInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** SDI error envelope: `respEstado.codRespuesta != 0` ⇒ SII signaled an error;
 *  return its message verbatim (ADR-004), else null. */
function siiRejected(resp: Envelope['respEstado']): string | null {
  if (!resp) return null;
  const code = resp.codRespuesta;
  if (code === 0 || code === '0' || code === undefined || code === null) return null;
  return asStr(resp.msgeRespuesta ?? resp.codError) ?? 'SII rechazó la consulta del RCV.';
}

/** Normalise SII's `DD/MM/YYYY[ HH:MM:SS]` to ISO; unrecognised input is returned
 *  unchanged so the raw value still surfaces. */
function normalizeDmy(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  const [datePart, timePart] = s.split(' ', 2);
  const parts = (datePart ?? '').split('/');
  if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p))) return s;
  const [dd, mm, yyyy] = parts as [string, string, string];
  const iso = `${yyyy.padStart(4, '0')}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  return timePart ? `${iso} ${timePart.trim()}` : iso;
}

function canonicalRutFrom(digits: unknown, dv: unknown): string | null {
  if (digits === undefined || digits === null || dv === undefined || dv === null) return null;
  return Rut.tryParse(`${String(digits)}-${String(dv).trim()}`)?.canonical ?? null;
}

function metaData(namespace: string, conversationId: string): Record<string, unknown> {
  return {
    namespace,
    conversationId,
    // Opaque per-request correlation id (Web Crypto global; no node: import).
    transactionId: globalThis.crypto.randomUUID(),
    page: null,
  };
}

/** Parse the SDI envelope or throw `RcvError` (non-JSON / error envelope). Empty
 *  `data[]` is a legitimate "no documents" result, never an error. */
function parseEnvelope(raw: unknown): Envelope {
  const parsed = Envelope.safeParse(raw);
  if (!parsed.success) {
    throw new RcvError('Respuesta inesperada de SII (no es un objeto JSON del RCV).');
  }
  const rejected = siiRejected(parsed.data.respEstado);
  if (rejected) throw new RcvError(rejected);
  return parsed.data;
}

const rowsOf = (env: Envelope): Record<string, unknown>[] => env.data ?? env.datos ?? [];

async function postSdi(
  session: PortalSession,
  url: string,
  namespace: string,
  data: Record<string, unknown>,
): Promise<unknown> {
  const conversationId = (await session.cookie(`${HOSTS.portalApi}/`, CONVERSATION_COOKIE)) ?? '';
  const request: JsonRequest = {
    method: 'POST',
    headers: HEADERS,
    body: { metaData: metaData(namespace, conversationId), data },
  };
  try {
    return await session.requestJson(url, request);
  } catch {
    // requestJson rejects on a non-JSON body (e.g. an expired-session HTML redirect)
    // or a network error — surface the typed error (ADR-004), not a raw Playwright
    // error, so a caller gets a consistent contract.
    throw new RcvError('Respuesta inesperada de SII (no es JSON).');
  }
}

/** getResumen: per-DTE-type aggregates for one (RUT, period, side). `session` must be
 *  an already-logged-in PortalSession (acquired via `withSession`). */
export async function fetchRcvResumen(
  session: PortalSession,
  params: { rut: Rut; periodo: Periodo; side: RcvSide },
): Promise<RcvResumen> {
  const { rut, periodo, side } = params;
  const raw = await postSdi(session, RESUMEN_URL, RESUMEN_NAMESPACE, {
    rutEmisor: String(rut.body),
    dvEmisor: rut.dv,
    ptributario: periodo.canonical,
    estadoContab: 'REGISTRO',
    operacion: side,
    busquedaInicial: true,
  });
  const env = parseEnvelope(raw);
  const rows: RcvResumenRow[] = rowsOf(env).map((r) => ({
    codigoTipoDoc: asStr(aliasGet(r, RESUMEN_ALIASES.codigoTipoDoc)),
    descripcion: asStr(aliasGet(r, RESUMEN_ALIASES.descripcion)),
    totalDocumentos: asInt(aliasGet(r, RESUMEN_ALIASES.totalDocumentos)),
    montoExento: asInt(aliasGet(r, RESUMEN_ALIASES.montoExento)),
    montoNeto: asInt(aliasGet(r, RESUMEN_ALIASES.montoNeto)),
    montoIva: asInt(aliasGet(r, RESUMEN_ALIASES.montoIva)),
    montoTotal: asInt(aliasGet(r, RESUMEN_ALIASES.montoTotal)),
  }));
  return {
    rut: rut.canonical,
    periodo: periodo.formatted,
    side,
    rows,
    totalDocumentos: asInt(env.totDocRes),
  };
}

/** getDetalle{Compra,Venta}: individual DTE rows for one (RUT, period, side, DTE type).
 *  `codigoTipoDoc` comes from a prior `fetchRcvResumen` for the same period. */
export async function fetchRcvDetalle(
  session: PortalSession,
  params: { rut: Rut; periodo: Periodo; side: RcvSide; codigoTipoDoc: string },
): Promise<RcvDetalle> {
  const { rut, periodo, side, codigoTipoDoc } = params;
  const raw = await postSdi(session, DETALLE_URL[side], DETALLE_NAMESPACE[side], {
    rutEmisor: String(rut.body),
    dvEmisor: rut.dv,
    ptributario: periodo.canonical,
    estadoContab: 'REGISTRO',
    operacion: side,
    codTipoDoc: codigoTipoDoc,
    accionRecaptcha: RECAPTCHA_ACTION[side],
    tokenRecaptcha: RECAPTCHA_TOKEN,
  });
  const env = parseEnvelope(raw);
  const docs: RcvDetalleDoc[] = rowsOf(env).map((r) => ({
    folio: asInt(aliasGet(r, DETALLE_ALIASES.folio)),
    rutEmisor: canonicalRutFrom(
      aliasGet(r, DETALLE_ALIASES.rutDigits),
      aliasGet(r, DETALLE_ALIASES.dv),
    ),
    razonSocial: asStr(aliasGet(r, DETALLE_ALIASES.razonSocial)),
    fechaEmision: normalizeDmy(aliasGet(r, DETALLE_ALIASES.fechaEmision)),
    fechaRecepcion: normalizeDmy(aliasGet(r, DETALLE_ALIASES.fechaRecepcion)),
    montoExento: asInt(aliasGet(r, DETALLE_ALIASES.montoExento)),
    montoNeto: asInt(aliasGet(r, DETALLE_ALIASES.montoNeto)),
    montoIva: asInt(aliasGet(r, DETALLE_ALIASES.montoIva)),
    montoTotal: asInt(aliasGet(r, DETALLE_ALIASES.montoTotal)),
    eventoReceptor: asStr(aliasGet(r, DETALLE_ALIASES.eventoReceptor)),
    eventoReceptorLeyenda: asStr(aliasGet(r, DETALLE_ALIASES.eventoReceptorLeyenda)),
    raw: r,
  }));
  return { rut: rut.canonical, periodo: periodo.formatted, side, codigoTipoDoc, docs };
}
