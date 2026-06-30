// Public F29 task API the surfaces call (ADR-003). Declaración Mensual de IVA, read-only.
// FASE 1 (robusta, JSON SDI — sin GWT-RPC): three verbs over the two clean SDI-JSON facades
// (propuesta + estado). The exact PRESENTED form (the full balance incl. totals 538/89/91) lives
// behind a fragile 2-app GWT-RPC flow and is deferred to Fase 2 (its own PR + ADR). Here:
//   - f29Formulario(periodo) — the IVA PROPUESTA's códigos, labeled (glosa) + grouped by the
//     form's sections. `fuente: 'propuesta'` is explicit: it is SII's suggestion, not the filed
//     form. (Fase 2 adds `fuente: 'presentada'`.)
//   - f29Overview(desde, hasta) — per-month, from the presented-declaración ESTADO: estado, folio,
//     fecha and the declared `total` ("lo que pagué por mes"), across a date range.
//   - f29Status(periodo) — the raw estado of one month (the declaración records SII holds).
// F29 is SESSION-KEYED (ADR-005): reads ONLY the session principal and REJECTS a representing
// operate pointer UP FRONT (before any session), with an actionable "log in as the empresa"
// message. The período/range is validated locally BEFORE any session.
import { withSession } from '../auth/index.js';
import { recordAudit } from '../audit/index.js';
import { readOperateState } from '../identity/index.js';
import { Periodo } from '../periodo/index.js';
import { Rut } from '../rut/index.js';
import { F29Error, ValidationError } from '../errors/index.js';
import { DEFAULT_SETTINGS } from '../config/index.js';
import { fetchF29Estado, fetchF29Propuesta } from '../portal/f29.js';
import type { CodigoF29, DeclaracionEstadoF29, F29Estado } from '../portal/f29.js';
import { F29_CODIGOS, glosaF29, grupoF29 } from '../portal/f29-codigos.js';
import type { F29Grupo } from '../portal/f29-codigos.js';
import type { AuditEntry, Runtime } from '../seams/index.js';

export type { CodigoF29, DeclaracionEstadoF29, F29Estado, F29Propuesta } from '../portal/f29.js';
export { F29_GRUPO_LABELS } from '../portal/f29-codigos.js';
export type { F29Grupo } from '../portal/f29-codigos.js';

/** A range bound: a multi-month overview never fans out more than this many POSTs at SII. */
const MAX_OVERVIEW_MONTHS = 36;

/** Inter-request pace (ms) for the multi-month overview fan-out — never hammer SII (ADR-004). */
const pacingMs = (): number => Math.round(1000 / DEFAULT_SETTINGS.rateLimitRps);

function audit(runtime: Runtime, action: string, result: string, extra: Partial<AuditEntry>): void {
  recordAudit(runtime, { action, result, ...extra });
}

/** Reject a representing operate pointer BEFORE opening a session (ADR-005, session-keyed). The
 *  empresa RUT is already user-visible (`operate --list`), so it is safe to echo; the razón social
 *  is PII and is NOT included. No operate state → defer to `withSession` (raises NotAuthenticated). */
async function assertSelfOperating(runtime: Runtime): Promise<void> {
  const op = await readOperateState(runtime.store);
  if (op && op.operatingRut !== op.selfRut) {
    throw new F29Error(
      `El F29 es session-keyed: el SII autoriza por el titular de la sesión, no por el RUT ` +
        `operado (${Rut.parse(op.operatingRut).formatted}). Para la F29 de esa empresa, inicia ` +
        'sesión como ella (`sii auth logout` y luego `sii auth login`).',
    );
  }
}

// --- f29 formulario (propuesta, labeled + grouped) -------------------------------

/** One F29 line: the código, its observed glosa + form sign, and the value. */
export interface LineaF29 {
  readonly codigo: string;
  readonly glosa: string | null; // observed label; null when the código is unobserved
  readonly valor: number | null;
  readonly signo: string; // '+' / '-' / '=' / '' (from the form)
}

export interface F29Formulario {
  readonly rut: string;
  readonly periodo: string; // YYYY-MM
  /** Fase 1 is always 'propuesta' (SII's suggestion). Fase 2 adds 'presentada' (the filed form). */
  readonly fuente: 'propuesta';
  readonly tienePropuesta: boolean;
  /** The propuesta códigos labeled + bucketed by the form's sections (debitos / creditos /
   *  retenciones / otros / totales). An unobserved código lands in `otros` — surfaced, never
   *  hidden (anti-allowlist). */
  readonly grupos: Record<F29Grupo, readonly LineaF29[]>;
}

const EMPTY_GRUPOS = (): Record<F29Grupo, LineaF29[]> => ({
  debitos: [],
  creditos: [],
  retenciones: [],
  otros: [],
  totales: [],
});

/** Label + bucket the propuesta códigos by the form's sections. */
function agrupar(codigos: readonly CodigoF29[]): Record<F29Grupo, LineaF29[]> {
  const grupos = EMPTY_GRUPOS();
  for (const c of codigos) {
    grupos[grupoF29(c.codigo)].push({
      codigo: c.codigo,
      glosa: glosaF29(c.codigo),
      valor: c.valor,
      signo: F29_CODIGOS[c.codigo]?.signo ?? '',
    });
  }
  return grupos;
}

/** IVA propuesta of one período, labeled + grouped (the contador-readable breakdown).
 *  `fuente: 'propuesta'` — SII's suggestion, not the filed form (that is Fase 2). */
export async function f29Formulario(
  runtime: Runtime,
  args: { periodo: string },
): Promise<F29Formulario> {
  const periodo = Periodo.parse(args.periodo); // fail fast on a bad período — no session opened
  await assertSelfOperating(runtime);
  const start = runtime.clock.now().getTime();
  try {
    const prop = await withSession(runtime, async (session, ctx) =>
      fetchF29Propuesta(session, { rut: Rut.parse(ctx.sessionRut), periodo }),
    );
    const res: F29Formulario = {
      rut: prop.rut,
      periodo: prop.periodo,
      fuente: 'propuesta',
      tienePropuesta: prop.tienePropuesta,
      // Group ONLY the proposed tax códigos (listCodPropuestos). The `listCodAdministrativos`
      // (90xx/91xx) are SII-internal control códigos — not lines the contador reads and absent
      // from the rendered form (so they have no observed glosa) — excluded from the formulario.
      grupos: agrupar(prop.codigos),
    };
    audit(runtime, 'f29_formulario', 'ok', {
      rut: res.rut,
      period: periodo.canonical,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'f29_formulario', 'failed', { period: periodo.canonical });
    throw e;
  }
}

// --- f29 status (raw estado of one month) ----------------------------------------

/** The presented/saved F29 records of one período (estado, folio, fecha, total). Session
 *  principal (ADR-005). Empty is a clean "nada presentado", not an error. */
export async function f29Status(runtime: Runtime, args: { periodo: string }): Promise<F29Estado> {
  const periodo = Periodo.parse(args.periodo);
  await assertSelfOperating(runtime);
  const start = runtime.clock.now().getTime();
  try {
    const res = await withSession(runtime, async (session, ctx) =>
      fetchF29Estado(session, { rut: Rut.parse(ctx.sessionRut), periodo }),
    );
    audit(runtime, 'f29_estado', 'ok', {
      rut: res.rut,
      period: periodo.canonical,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'f29_estado', 'failed', { period: periodo.canonical });
    throw e;
  }
}

// --- f29 overview (per-month totals across a date range) -------------------------

/** One month of the overview: the vigente declaración's estado/folio/fecha + the declared
 *  `total` ("lo que pagué"). A month with no declaración is a clean empty row. */
export interface MesF29 {
  readonly periodo: string; // YYYY-MM
  readonly tieneDeclaracion: boolean;
  readonly estado: string | null;
  readonly folio: number | null;
  readonly fecha: string | null;
  readonly total: number | null; // declared total a pagar of the vigente declaración
}

export interface F29Overview {
  readonly rut: string;
  readonly desde: string; // YYYY-MM
  readonly hasta: string; // YYYY-MM
  readonly meses: readonly MesF29[]; // chronological (desde → hasta)
}

/** Enumerate the months in [desde, hasta] inclusive (chronological). */
function periodosEnRango(desde: Periodo, hasta: Periodo): Periodo[] {
  const out: Periodo[] = [];
  let y = desde.year;
  let m = desde.month;
  while (y < hasta.year || (y === hasta.year && m <= hasta.month)) {
    out.push(Periodo.of(y, m));
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Pick the declaración whose total is the month's headline: the vigente one (estadoId 1 /
 *  estado "Vigente"), else the first record. */
function declaracionVigente(decls: readonly DeclaracionEstadoF29[]): DeclaracionEstadoF29 | null {
  return (
    decls.find((d) => d.estadoId === 1 || (d.estado ?? '').toLowerCase().includes('vigente')) ??
    decls[0] ??
    null
  );
}

/** Per-month F29 position across a date range, from the presented-declaración estado: each month's
 *  vigente estado/folio/fecha + the declared `total`. Session principal (ADR-005), paced. */
export async function f29Overview(
  runtime: Runtime,
  args: { desde: string; hasta: string },
): Promise<F29Overview> {
  const desde = Periodo.parse(args.desde); // fail fast — no session opened
  const hasta = Periodo.parse(args.hasta);
  if (desde.year > hasta.year || (desde.year === hasta.year && desde.month > hasta.month)) {
    throw new ValidationError(
      `Rango inválido: "desde" (${desde.formatted}) es posterior a "hasta" (${hasta.formatted}).`,
    );
  }
  const periodos = periodosEnRango(desde, hasta);
  if (periodos.length > MAX_OVERVIEW_MONTHS) {
    throw new ValidationError(
      `Rango demasiado amplio: ${periodos.length} meses (máximo ${MAX_OVERVIEW_MONTHS}). Acota el rango.`,
    );
  }
  await assertSelfOperating(runtime);
  const start = runtime.clock.now().getTime();
  try {
    const result = await withSession(runtime, async (session, ctx) => {
      const rut = Rut.parse(ctx.sessionRut); // session-keyed: always the principal
      const meses: MesF29[] = [];
      for (let i = 0; i < periodos.length; i++) {
        if (i > 0) await runtime.clock.sleep(pacingMs()); // pace each estado POST (ADR-004)
        const est = await fetchF29Estado(session, { rut, periodo: periodos[i]! });
        const vig = declaracionVigente(est.declaraciones);
        meses.push({
          periodo: est.periodo,
          tieneDeclaracion: est.tieneDeclaracion,
          estado: vig?.estado ?? null,
          folio: vig?.folio ?? null,
          fecha: vig?.fecha ?? null,
          total: vig?.total ?? null,
        });
      }
      return { rut: rut.canonical, desde: desde.formatted, hasta: hasta.formatted, meses };
    });
    audit(runtime, 'f29_overview', 'ok', {
      rut: result.rut,
      period: `${desde.canonical}-${hasta.canonical}`,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return result;
  } catch (e) {
    audit(runtime, 'f29_overview', 'failed', { period: `${desde.canonical}-${hasta.canonical}` });
    throw e;
  }
}
