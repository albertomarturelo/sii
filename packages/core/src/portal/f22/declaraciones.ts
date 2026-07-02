// `buscaDeclVgte` — the año's declaraciones + their estado (step 1 of the F22 status
// read; see shared.ts for the wire context). data:{periodo, rut, dv} → data.{decls[],
// glosas[]} — a decl's codConc resolves to its human estado via glosas[].descripcion.
import type { Rut } from '../../rut/index.js';
import type { Anio } from '../../periodo/index.js';
import type { PortalSession } from '../../seams/index.js';
import type { CodigoF22, F22Grupos } from '../f22-codigos.js';
import { F22_BASE, aliasGet, asStr, isObj, postSdi, rutDigits } from './shared.js';

const BUSCA_DECL_URL = `${F22_BASE}/buscaDeclVgte`;
// Namespace was best-guess from the SDI pattern (área renta / app consultaestadof22);
// SII ACCEPTED it live 2026-06-27 (returned the real código grid). The URL path routes.
const BUSCA_DECL_NAMESPACE =
  'cl.sii.sdi.lob.renta.consultaestadof22.data.api.interfaces.FacadeService/buscaDeclVgte';

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

/** `vgte` arrives as "S"/"N", a bool, or 1/0 (exact form unconfirmed). Tolerant. */
function coerceVigente(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toUpperCase();
  if (['S', 'SI', 'TRUE', '1', 'VIGENTE'].includes(s)) return true;
  if (['N', 'NO', 'FALSE', '0'].includes(s)) return false;
  return null;
}

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
