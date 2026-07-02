// F22 — Declaración Anual de Renta (estado / readback, read-only). Shared wire plumbing
// for the per-view facades (declaraciones / grid / observaciones / historial). Ported from
// the proven Python sii-cli (portal/f22.py); wire contract first-hand-observed there
// (spike #67, live-captured 2026-06-27, prod), NOT a third-party library (ADR-004).
// Full contract: docs/sii-contract/f22.md.
//
// The F22-status portal is the Angular SPA at `https://www4.sii.cl/consultaestadof22ui/`
// — a DIFFERENT app from RCV's `consdcvinternetui` (own Referer), same SDI envelope.
//
// SESSION-KEYED (ADR-005): F22 authorizes by the session principal — confirmed live
// 2026-06-27 that a persona's `--rut <empresa>` returns a CLEAN NEGATIVE, not the
// empresa's F22. The body RUT does not redirect it; the empresa's F22 needs the
// empresa's own session (logout→login). The task therefore defaults to self.
//
// PII: F22 exposes NO `raw` (unlike RCV) — the non-curated F22 data (decl
// `nombres`/`calle`/`comuna`/`cta`/`bco` and the header códigos) is pure identity/bank
// PII, not tax detail, so it never reaches a surface/LLM/audit. Error envelope is
// `metaData.errors` (a list of {id, descripcion}) — NOT RCV's `respEstado.codRespuesta`.
import { z } from 'zod';
import { HOSTS } from '../../config/index.js';
import { F22Error, NotAuthenticatedError } from '../../errors/index.js';
import type { Rut } from '../../rut/index.js';
import type { JsonRequest, PortalSession } from '../../seams/index.js';

export const F22_BASE = `${HOSTS.portalApi}/consultaestadof22ui/services/data/facadeService`;
const CONVERSATION_COOKIE = 'TOKEN';

// Per-surface headers — Referer is the F22-status SPA root (differs from RCV/F29).
const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Origin: HOSTS.portalApi,
  Referer: `${HOSTS.portalApi}/consultaestadof22ui/`,
  Accept: 'application/json, text/plain, */*',
};

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
export type Envelope = z.infer<typeof Envelope>;

export const aliasGet = (row: Record<string, unknown>, aliases: readonly string[]): unknown => {
  for (const key of aliases) {
    const v = row[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};
export const asStr = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);
/** Like `asStr` but trims and maps blank → null. For wire fields SII space-pads or leaves
 *  empty (`referencia`, `fechaCitacion`, `unidadSii`) — a blank string is "absent", not data. */
export const trimToNull = (v: unknown): string | null => {
  const s = asStr(v);
  if (s === null) return null;
  const t = s.trim();
  return t === '' ? null : t;
};
/** Parse a código `valor`. SII serves montos in **es-CL format** — `.` = thousands, `,` =
 *  decimals (confirmed live 2026-06-29; synthetic examples here: `"9.999"` = 9999,
 *  `"12.345.678"` = 12345678). A bare `Number()` would misparse `"9.999"` as 9.999 (off by
 *  1000×) and `"12.345.678"` as NaN (two dots). So strip the thousands dots and turn the
 *  decimal comma into a dot before parsing. Plain integers (`"177"`, `-150000`) pass through. */
export const asNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).trim().replace(/\./g, '').replace(/,/g, '.'));
  return Number.isFinite(n) ? n : null;
};
export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

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

export async function postSdi(
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

export const rutDigits = (rut: Rut): { rut: string; dv: string } => ({
  rut: String(rut.body),
  dv: rut.dv,
});
