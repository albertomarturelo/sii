// `buscaEventos` — historial / eventos of a folio. Observed live 2026-06-29 (spike #28,
// own session): data:{periodo,rut,dv,folio} (ALL strings, like buscaDeclVgte) →
// data:[{codEvento, nombre, fechaEvento, tipoEvento, codCarta, idCarta, codigo,
// referencia, evigCodigo, fechaCitacion, unidadSii}] — the per-folio timeline
// (declaración recibida → devolución autorizada → giro de Tesorería → rectificatorias…).
// Sent {periodo,rut,dv} WITHOUT folio returned a RESTEASY 500 (the folio is required).
// Rows are NOT PII: `nombre` is the event GLOSA (the monto rides inside it as verbatim
// SII text — tax content, same class as the formulario montos — NOT an identity/bank
// field), so every field is curated, no header exclusion, no `raw`. The sibling
// per-carta `buscaObservacion` (needs an `idCarta`, which is null on these eventos) is
// the per-notification detail — out of scope here; `buscaEventos` IS the historial.
import type { Rut } from '../../rut/index.js';
import type { Anio } from '../../periodo/index.js';
import type { PortalSession } from '../../seams/index.js';
import { F22_BASE, aliasGet, asStr, postSdi, rutDigits, trimToNull, isObj } from './shared.js';

const BUSCA_EVENTOS_URL = `${F22_BASE}/buscaEventos`;
const BUSCA_EVENTOS_NAMESPACE =
  'cl.sii.sdi.lob.renta.consultaestadof22.data.api.interfaces.FacadeService/buscaEventos';

/** One event in a declaración's historial (`buscaEventos`). NOT PII — every field is a
 *  tax-process datum: the event code/glosa, dates, and carta/notification references. The
 *  monto rides inside `glosa` as verbatim SII text (tax content, not identity/bank), so the
 *  row is fully curated — no header exclusion, no `raw`. */
export interface EventoF22 {
  readonly folio: string | null; // the declaración folio this event belongs to
  readonly codigo: string; // codEvento — the event-type code (e.g. "48", "2", "10")
  readonly glosa: string | null; // `nombre`, verbatim (human description; may embed the monto)
  readonly fecha: string | null; // fechaEvento, verbatim (DD/MM/YYYY)
  readonly tipo: string | null; // tipoEvento
  readonly codCarta: string | null; // carta/notification number (leading zeros preserved)
  readonly idCarta: string | null; // per-carta key (buscaObservacion); null when no formal carta
  readonly referencia: string | null; // referencia, trimmed
  readonly fechaCitacion: string | null; // citación date, when present
  readonly unidadSii: string | null; // SII unit, when present
}

const EVENTO_ALIASES = {
  folio: ['folio'],
  // The event-type code is `codEvento`; the row ALSO carries an unrelated `codigo` (a long
  // internal id), so `codEvento` MUST come first.
  codigo: ['codEvento', 'codigo'],
  glosa: ['nombre', 'glosa', 'descripcion'],
  fecha: ['fechaEvento', 'fecha'],
  tipo: ['tipoEvento', 'tipo'],
  codCarta: ['codCarta'],
  idCarta: ['idCarta'],
  referencia: ['referencia'],
  fechaCitacion: ['fechaCitacion'],
  unidadSii: ['unidadSii'],
} as const;

/** Sort key for an event's `fecha` (DD/MM/YYYY) → numeric YYYYMMDD for most-recent-first
 *  ordering. Undated / unparseable events sink to the bottom (−∞). Exported for the task,
 *  which sorts the aggregate across folios. */
export function eventoDateKey(fecha: string | null): number {
  if (fecha === null) return Number.NEGATIVE_INFINITY;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha.trim());
  if (!m) return Number.NEGATIVE_INFINITY;
  return Number(`${m[3]}${m[2]}${m[1]}`);
}

/** `buscaEventos` — the historial/eventos timeline for ONE folio (the folio is REQUIRED;
 *  omitting it returns a RESTEASY 500). Rows carry NO identity/bank PII (event code + glosa
 *  + dates + carta refs), so all are curated, nothing excluded, no `raw`. Wire order is
 *  oldest-first; the task aggregates across folios and sorts most-recent-first. Empty/non-array
 *  data = sin eventos (NOT an error). All params sent as strings (like buscaDeclVgte). */
export async function fetchF22Historial(
  session: PortalSession,
  params: { rut: Rut; anio: Anio; folio: string },
): Promise<EventoF22[]> {
  const { rut, anio, folio } = params;
  const env = await postSdi(session, BUSCA_EVENTOS_URL, BUSCA_EVENTOS_NAMESPACE, {
    periodo: anio.canonical,
    ...rutDigits(rut),
    folio,
  });
  const rows = env.data;
  if (!Array.isArray(rows)) return [];
  const out: EventoF22[] = [];
  for (const r of rows) {
    if (!isObj(r)) continue;
    const codigo = asStr(aliasGet(r, EVENTO_ALIASES.codigo));
    if (codigo === null) continue;
    out.push({
      folio: asStr(aliasGet(r, EVENTO_ALIASES.folio)),
      codigo,
      glosa: asStr(aliasGet(r, EVENTO_ALIASES.glosa)), // verbatim (ADR-004) — may embed the monto
      fecha: asStr(aliasGet(r, EVENTO_ALIASES.fecha)),
      tipo: asStr(aliasGet(r, EVENTO_ALIASES.tipo)),
      codCarta: asStr(aliasGet(r, EVENTO_ALIASES.codCarta)),
      idCarta: asStr(aliasGet(r, EVENTO_ALIASES.idCarta)),
      referencia: trimToNull(aliasGet(r, EVENTO_ALIASES.referencia)),
      fechaCitacion: trimToNull(aliasGet(r, EVENTO_ALIASES.fechaCitacion)),
      unidadSii: trimToNull(aliasGet(r, EVENTO_ALIASES.unidadSii)),
    });
  }
  return out;
}
