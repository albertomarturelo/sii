// `situacionObservacion` — observaciones (inconsistencias) of a folio. Observed live
// 2026-06-29 (spike #26, own session): data:{periodo,rut,dv,folio} →
// data:[{codigo,descripcion,url}]. Same SPA / namespace family as the status facades
// (see shared.ts). Rows are NOT PII (observación code + glosa + SII ayuda URL).
// `situacionObservacion` gives the vigente observaciones from the folio alone; the
// EVENT TIMELINE is `buscaEventos` (historial.ts).
import type { Rut } from '../../rut/index.js';
import type { Anio } from '../../periodo/index.js';
import type { PortalSession } from '../../seams/index.js';
import { F22_BASE, aliasGet, asStr, isObj, postSdi, rutDigits } from './shared.js';

const SITUACION_OBS_URL = `${F22_BASE}/situacionObservacion`;
const SITUACION_OBS_NAMESPACE =
  'cl.sii.sdi.lob.renta.consultaestadof22.data.api.interfaces.FacadeService/situacionObservacion';

/** One observación (inconsistencia) on a declaración. NOT PII — observación code + glosa
 *  + the SII ayuda URL — so every field is curated (no header-código exclusion, no `raw`). */
export interface ObservacionF22 {
  readonly codigo: string; // observación code, e.g. "B102" / "G37"
  readonly descripcion: string | null; // glosa verbatim (SII serves it inline)
  readonly url: string | null; // SII ayuda PDF for correcting the observación
}

const OBSERVACION_ALIASES = {
  codigo: ['codigo', 'cod'],
  descripcion: ['descripcion', 'glosa'],
  url: ['url', 'link'],
} as const;

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
