// Peticiones Administrativas (SISPAD) — typed facade over the GWT-RPC read seam
// (`PortalSession.requestText`, ADR-020). Reaches `peticionesUsuario(rut, token)` on the
// legacy GWT app `www3.sii.cl/sispadinternet` with a COLD authenticated POST (no SPA
// warm-up) and decodes the `//OK[…]` object graph in-house (`gwt.ts`). Body-RUT like RCV:
// the caller resolves the operating RUT and validates `--rut` vs the operable set (ADR-005).
//
// PII posture — NO `raw`, tight allowlist (ADR-004 / ADR-006). The graph is PII-dense on
// every side (own identity, SII functionary names + emails, third-party RUTs); a per-field
// denylist is not provably complete, so only the tracking fields are curated. Even an
// estado glosa can embed a functionary name — `Petición … (Subrogancia Informal [NOMBRE])`
// — which is stripped. Full wire contract: docs/sii-contract/peticiones.md.
import { buildPeticionesRequest, decodeGwtResponse, isNode, isPolicyError } from './gwt.js';
import type { GwtNode, GwtValue } from './gwt.js';
import { HOSTS } from '../config/index.js';
import { PeticionesError } from '../errors/index.js';
import type { PortalSession } from '../seams/index.js';
import type { Rut } from '../rut/index.js';

const MODULE_BASE = `${HOSTS.sispad}/`;
const ENDPOINT = `${HOSTS.sispad}/peticion`;
const NOCACHE_URL = `${HOSTS.sispad}/sispadinternet.nocache.js`;
// Last-known-good serialization-policy strong-name (observed 2026-07-03). Validated by the
// server and rotated on SII recompile → self-healed at runtime (see `callWithHealing`).
const LAST_KNOWN_HASH = '598C9D524B940C07227C7D58BBBBDDFC';
// The GWT UI conversation id — NOT validated by the server (auth is by cookie + rut, ADR-020),
// so a constant placeholder suffices; a real token is a session secret we never need.
const TOKEN_PLACEHOLDER = 'SIICOREPETICIONESREAD';
const GWT_HEADERS: Record<string, string> = {
  'Content-Type': 'text/x-gwt-rpc; charset=utf-8',
  'X-GWT-Module-Base': MODULE_BASE,
};

// Curated field positions in the decoded graph — the observed contract (2026-07-03). A
// class whose fields shift on recompile is caught by the schema decode ("scraper roto");
// these indices are validated softly below (número numeric, estado glosa `Petici…`).
const PET = { numero: 12, materia: 26, estados: 21 } as const;
const MATERIA_GLOSA = 10;
const EST = { glosa: 10, fecha: 7, nota: 9 } as const;

/** One state transition in a petition's timeline. `estado` is SII's label with any
 *  internal functionary suffix stripped; `mensaje` is SII's verbatim note to the taxpayer
 *  (what's pending / why) when present — the value behind an "en espera de Antecedentes". */
export interface EstadoPeticion {
  readonly estado: string;
  /** ISO-8601 date-time of the transition, or null when SII sent none. */
  readonly fecha: string | null;
  readonly mensaje: string | null;
}

/** One petición administrativa (curated; NO `raw`). */
export interface Peticion {
  readonly numero: number;
  readonly materia: string | null;
  /** The most recent state's label (the timeline entry with the latest `fecha`). */
  readonly estadoActual: string;
  /** Full state history, most-recent-first. */
  readonly timeline: readonly EstadoPeticion[];
}

/** All peticiones administrativas for `rut` (the resolved body RUT). */
export interface PeticionesResult {
  readonly rut: string;
  readonly peticiones: readonly Peticion[];
}

// Module-scoped cache of the working policy hash (global to the SII deploy, so process-wide).
let cachedHash: string | null = null;

const nodeAt = (n: GwtNode, i: number): GwtValue => n.fields[i] ?? null;
function intOf(v: GwtValue): number | null {
  return isNode(v) && typeof v.fields[0] === 'number' ? v.fields[0] : null;
}
function tsIso(v: GwtValue): string | null {
  if (!isNode(v) || typeof v.fields[0] !== 'number') return null;
  const d = new Date(v.fields[0]);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
// SII embeds the acting functionary in some estado glosas: "… (Subrogancia Informal [NAME])".
// Strip that internal-PII suffix; the base label is the state (ADR-006).
const stripFunctionaryPII = (glosa: string): string =>
  glosa.replace(/\s*\(Subrogancia[^)]*\)\s*$/i, '').trim();

function curateEstado(node: GwtValue): EstadoPeticion | null {
  if (!isNode(node)) return null;
  const raw = nodeAt(node, EST.glosa);
  if (typeof raw !== 'string' || !raw.startsWith('Petici')) return null; // curation drift guard
  const nota = nodeAt(node, EST.nota);
  return {
    estado: stripFunctionaryPII(raw),
    fecha: tsIso(nodeAt(node, EST.fecha)),
    mensaje: typeof nota === 'string' && nota.length > 0 ? nota : null,
  };
}

function curatePeticion(node: GwtValue): Peticion | null {
  if (!isNode(node)) return null;
  const numero = intOf(nodeAt(node, PET.numero));
  if (numero === null) return null; // not a PeticionTo shape → skip (guard)
  const materiaNode = nodeAt(node, PET.materia);
  const materia = isNode(materiaNode)
    ? ((nodeAt(materiaNode, MATERIA_GLOSA) as string | null) ?? null)
    : null;
  const estadosNode = nodeAt(node, PET.estados);
  const timeline = (isNode(estadosNode) ? (estadosNode.items ?? []) : [])
    .map(curateEstado)
    .filter((e): e is EstadoPeticion => e !== null)
    .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''));
  const estadoActual = timeline[0]?.estado ?? '';
  return { numero, materia: typeof materia === 'string' ? materia : null, estadoActual, timeline };
}

/** Read every petición administrativa for `rut` (body-RUT). Self-heals the policy hash on
 *  a policy rejection, then decodes + curates. Never retried after a genuine SII error. */
export async function fetchPeticiones(
  session: PortalSession,
  args: { readonly rut: Rut },
): Promise<PeticionesResult> {
  const root = await callWithHealing(session, args.rut.body);
  const arr = isNode(root) ? (root.items ?? []) : [];
  const peticiones = arr.map(curatePeticion).filter((p): p is Peticion => p !== null);
  return { rut: args.rut.canonical, peticiones };
}

async function callOnce(session: PortalSession, rut: number, hash: string): Promise<GwtValue> {
  const body = buildPeticionesRequest(MODULE_BASE, hash, rut, TOKEN_PLACEHOLDER);
  const resp = await session.requestText(ENDPOINT, { method: 'POST', headers: GWT_HEADERS, body });
  return decodeGwtResponse(resp.body);
}

async function callWithHealing(session: PortalSession, rut: number): Promise<GwtValue> {
  const first = cachedHash ?? LAST_KNOWN_HASH;
  try {
    const root = await callOnce(session, rut, first);
    cachedHash = first;
    return root;
  } catch (e) {
    if (!isPolicyError(e)) throw e;
    // Self-heal: the policy strong-name rotated. Re-source candidates from the shipped
    // permutation JS and try each (≤ a handful) until one deserializes (ADR-020).
    const candidates = (await sourceHashCandidates(session)).filter((h) => h !== first);
    for (const hash of candidates) {
      try {
        const root = await callOnce(session, rut, hash);
        cachedHash = hash;
        return root;
      } catch (inner) {
        if (!isPolicyError(inner)) throw inner;
      }
    }
    throw new PeticionesError(
      'No se pudo determinar la política de serialización de SISPAD (scraper roto): el hash rotó y ningún candidato del JS de permutación fue aceptado.',
    );
  }
}

// Source candidate policy strong-names from the shipped GWT bundle: the bootstrap
// nocache.js lists the permutation strong-names; any permutation's `.cache.html` embeds
// the serialization-policy hashes (as `POc='…'` constants). Both are authenticated GETs.
async function sourceHashCandidates(session: PortalSession): Promise<string[]> {
  const HEX32 = /[0-9A-F]{32}/g;
  const nocache = await session.requestText(NOCACHE_URL, { method: 'GET' });
  const perms = [...new Set(nocache.body.match(HEX32) ?? [])];
  for (const perm of perms) {
    const cache = await session.requestText(`${HOSTS.sispad}/${perm}.cache.html`, {
      method: 'GET',
    });
    const hashes = [...new Set(cache.body.match(HEX32) ?? [])].filter((h) => h !== perm);
    if (hashes.length) return hashes;
  }
  return [];
}
