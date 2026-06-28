// Representación — empresas the authenticated account can operate at SII.
// Ported from the proven Python sii-cli (portal/representacion.py); the wire
// contract is first-hand-observed, NOT a third-party library (ADR-004).
//
// SII lets ONE Clave Tributaria operate on multiple RUTs when the user is
// representante legal / a delegated user of one or more empresas (ADR-005). The
// RCV SPA's multi-RUT picker is fed by `getDcvEmpresasAutorizadas` — a JSON facade
// on the www4.sii.cl SDI envelope. SESSION-KEYED: it returns the authorizations of
// the session principal (empty `data` request); the result includes the account's
// own RUT (flagged isSelf) and IS the source of valid operate targets (ADR-005).
//
// Observed at https://www4.sii.cl/consdcvinternetui/ on 2026-06-20, confirmed
// 2026-06-26 (prod, persona-natural session): POST to EMPRESAS_URL (GET → 405);
// body `{ metaData:{namespace,conversationId,transactionId,page:null}, data:{} }`;
// conversationId = the `TOKEN` cookie on www4.sii.cl (empty value accepted). Rows
// under `data[]` carry usrEmpRut/usrEmpDv/usrEmpRutDv, razonSocONombreEmp (came
// null), usrPrivilegios. Error envelope: respEstado.codRespuesta != 0.
import { HOSTS } from '../config/index.js';
import { RepresentacionError } from '../errors/index.js';
import { Rut } from '../rut/index.js';
import type { JsonRequest, PortalSession } from '../seams/index.js';

const EMPRESAS_URL = `${HOSTS.portalApi}/consdcvinternetui/services/data/facadeService/getDcvEmpresasAutorizadas`;
const EMPRESAS_NAMESPACE =
  'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getDcvEmpresasAutorizadas';
// The SPA conversation token; seeds metaData.conversationId (empty value accepted).
const CONVERSATION_COOKIE = 'TOKEN';

// Same headers as the sibling RCV facades (observed): Origin = SPA host, Referer = SPA root.
const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Origin: HOSTS.portalApi,
  Referer: `${HOSTS.portalApi}/consdcvinternetui/`,
  Accept: 'application/json, text/plain, */*',
};

export interface EmpresaAutorizada {
  /** Canonical RUT (`<digits>-<DV>`), or null when the row's RUT didn't parse. */
  readonly rut: string | null;
  /** Razón social / company name — may be null (came null in the observed call). PII. */
  readonly razonSocial: string | null;
  readonly privilegios: string | null;
  /** True for the row that is the account's OWN RUT (the endpoint includes it). */
  readonly isSelf: boolean;
  /** Full SII row for fields not curated (privilege / deauth metadata). */
  readonly raw: Record<string, unknown>;
}

export interface EmpresasAutorizadas {
  /** The authenticated account whose authorizations these are (canonical / null). */
  readonly rut: string | null;
  /** Empty = the account operates only its own RUT. */
  readonly empresas: readonly EmpresaAutorizada[];
}

// Alias-tolerant field lookup; the FIRST alias per field is the observed name
// (2026-06-20). Extend with a citation when a new key surfaces.
const FIELD_ALIASES = {
  rutDigits: ['usrEmpRut', 'rutEmpresa', 'empRut'],
  dv: ['usrEmpDv', 'dvEmpresa', 'empDv'],
  rutDv: ['usrEmpRutDv', 'rutDvEmpresa'],
  razonSocial: ['razonSocONombreEmp', 'razonSocial', 'nombreEmpresa'],
  privilegios: ['usrPrivilegios', 'privilegios'],
} as const;

const aliasGet = (row: Record<string, unknown>, field: keyof typeof FIELD_ALIASES): unknown => {
  for (const key of FIELD_ALIASES[field]) {
    const value = row[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

const asStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function canonicalEmpresaRut(row: Record<string, unknown>): string | null {
  const digits = aliasGet(row, 'rutDigits');
  const dv = aliasGet(row, 'dv');
  if (digits !== undefined && dv !== undefined) {
    try {
      return Rut.parse(`${String(digits)}-${String(dv).trim()}`).canonical;
    } catch {
      // fall through to the combined field
    }
  }
  const combined = aliasGet(row, 'rutDv');
  if (combined !== undefined) {
    try {
      return Rut.parse(String(combined)).canonical;
    } catch {
      return null;
    }
  }
  return null;
}

function buildEmpresa(
  row: Record<string, unknown>,
  authCanonical: string | null,
): EmpresaAutorizada {
  const rut = canonicalEmpresaRut(row);
  return {
    rut,
    razonSocial: asStr(aliasGet(row, 'razonSocial')),
    privilegios: asStr(aliasGet(row, 'privilegios')),
    isSelf: rut !== null && rut === authCanonical,
    raw: row,
  };
}

function extractRows(body: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ['data', 'datos', 'empresas', 'items']) {
    const block = body[key];
    if (Array.isArray(block) && block.every((r) => typeof r === 'object' && r !== null)) {
      return block as Record<string, unknown>[];
    }
  }
  return [];
}

/** The shared SDI error envelope: respEstado.codRespuesta != 0 ⇒ SII signaled an
 *  error; return its message verbatim. */
function siiRejected(body: Record<string, unknown>): string | null {
  const resp = body['respEstado'];
  if (typeof resp !== 'object' || resp === null) return null;
  const r = resp as Record<string, unknown>;
  const code = r['codRespuesta'];
  if (code === 0 || code === '0' || code === undefined || code === null) return null;
  return (
    asStr(r['msgeRespuesta'] ?? r['codError']) ?? 'SII rechazó la consulta de empresas autorizadas.'
  );
}

function parseResponse(raw: unknown, authCanonical: string | null): EmpresasAutorizadas {
  // Empty `data[]` is a legitimate "no representations" result, NOT an error. An
  // SII error envelope or a non-object response raises (never silently empty,
  // which would be indistinguishable from "no representations") — ADR-004.
  if (typeof raw !== 'object' || raw === null) {
    throw new RepresentacionError('Respuesta inesperada de SII (no es un objeto JSON).');
  }
  const body = raw as Record<string, unknown>;
  const rejected = siiRejected(body);
  if (rejected) throw new RepresentacionError(rejected);
  return {
    rut: authCanonical,
    empresas: extractRows(body).map((r) => buildEmpresa(r, authCanonical)),
  };
}

/** Fetch the operable set for the live session (empresas the account can operate).
 *  SESSION-KEYED — no operating-RUT arg (ADR-005). `session` must be an
 *  already-logged-in PortalSession. Throws `RepresentacionError` on an SII error
 *  envelope / non-JSON response (message verbatim, ADR-004). */
export async function fetchEmpresasAutorizadas(
  session: PortalSession,
  authRutCanonical: string | null,
): Promise<EmpresasAutorizadas> {
  const conversationId = (await session.cookie(`${HOSTS.portalApi}/`, CONVERSATION_COOKIE)) ?? '';
  const request: JsonRequest = {
    method: 'POST',
    headers: HEADERS,
    body: {
      metaData: {
        namespace: EMPRESAS_NAMESPACE,
        conversationId,
        // Opaque per-request correlation id (Web Crypto global; no node: import).
        transactionId: globalThis.crypto.randomUUID(),
        page: null,
      },
      data: {},
    },
  };
  let raw: unknown;
  try {
    raw = await session.requestJson(EMPRESAS_URL, request);
  } catch {
    // requestJson rejects on a non-JSON body (e.g. an expired-session HTML
    // redirect) or a network error — surface the typed error (ADR-004), not a
    // raw Playwright/SyntaxError, so a direct caller gets a consistent contract.
    throw new RepresentacionError('Respuesta inesperada de SII (no es JSON).');
  }
  return parseResponse(raw, authRutCanonical);
}
