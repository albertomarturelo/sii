// `f22Compacto` — the código grid for a folio (step 2 of the F22 status read; see
// shared.ts for the wire context). data:{rut, dv, periodo, folio} →
// data:[{codigo, valor, glosa}] — glosas ship INLINE.
import type { Rut } from '../../rut/index.js';
import type { Anio } from '../../periodo/index.js';
import type { PortalSession } from '../../seams/index.js';
// The código taxonomy (PII denylist + contador grouping) lives in its own domain module —
// it changes when we observe a new código, not when the wire changes.
import { isHeaderCodigo } from '../f22-codigos.js';
import type { CodigoF22 } from '../f22-codigos.js';
import { F22_BASE, aliasGet, asNumber, asStr, isObj, postSdi, rutDigits } from './shared.js';

const F22_COMPACTO_URL = `${F22_BASE}/f22Compacto`;
const F22_COMPACTO_NAMESPACE =
  'cl.sii.sdi.lob.renta.consultaestadof22.data.api.interfaces.FacadeService/f22Compacto';
// NOTE on `f22Completo`: a sibling endpoint exists, but live capture (spike #27, 2026-06-29)
// showed it returns f22Compacto's códigos PLUS internal control códigos (3056/8891/8865…) and
// extra PII (9306/9920) — i.e. NOISIER, not richer in tax content. The real "formulario
// completo" the SII renders (and its PDF) is built from `f22Compacto` + `codigosFormato` (the
// form skeleton). So `--full` reads `f22Compacto` (same source as the compact view) and adds
// the contador grouping — it does NOT use f22Completo. (ADR-004: first-hand obs over the port.)

const CODIGO_ALIASES = {
  codigo: ['codigo', 'cod'],
  valor: ['valor', 'monto'],
  glosa: ['glosa', 'descripcion'],
} as const;

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
