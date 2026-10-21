// Public F22 task API the surfaces call (ADR-003). Wraps the portal facade in
// `withSession` and writes one audit receipt. F22 is SESSION-KEYED (ADR-005): it
// authorizes by the session principal and takes NO `--rut` — a represented empresa's F22
// is reached by being in the empresa's session (logout→login), confirmed live (the body RUT
// returns a clean negative, not the empresa's F22). The older verbs IGNORE the operate
// pointer; `f22Terceros*` refuse it up front (`assertOperatingSelf`, CONVENTIONS). The año is
// validated locally BEFORE any session.
import { assertOperatingSelf, withSession } from '../auth/index.js';
import { readOperateState } from '../identity/index.js';
import { recordAudit } from '../audit/index.js';
import { Anio } from '../periodo/index.js';
import { Rut } from '../rut/index.js';
import { F22Error, ValidationError } from '../errors/index.js';
import { DEFAULT_SETTINGS } from '../config/index.js';
import {
  eventoDateKey,
  fetchF22Declaraciones,
  fetchF22Grid,
  fetchF22Historial,
  fetchF22Observaciones,
  fetchF22TercerosDetalle,
  fetchF22TercerosResumen,
  groupCodigos,
  pickVigenteFolio,
  TERCEROS_PAGE_SIZE,
} from '../portal/f22/index.js';
import type {
  DeclaracionTercero,
  EventoF22,
  FilaTercero,
  IdentidadPropia,
  F22Declaraciones,
  F22Estado,
  ObservacionF22,
} from '../portal/f22/index.js';
import type { AuditEntry, Runtime } from '../seams/index.js';

export type {
  CampoTercero,
  DeclaracionF22,
  DeclaracionTercero,
  FilaTercero,
  ValorTercero,
  CodigoF22,
  EventoF22,
  ObservacionF22,
  F22Declaraciones,
  F22Estado,
  F22Grupos,
} from '../portal/f22/index.js';

const DEFAULT_OVERVIEW_YEARS = 5;
const MAX_OVERVIEW_YEARS = 10;

/** Inter-request pace (ms) for multi-POST fan-outs — never hammer SII (ADR-004). */
const pacingMs = (): number => Math.round(1000 / DEFAULT_SETTINGS.rateLimitRps);

function audit(runtime: Runtime, action: string, result: string, extra: Partial<AuditEntry>): void {
  recordAudit(runtime, { action, result, ...extra });
}

/** One year of F22 status overview (estado, no código grid). */
export interface F22Overview {
  readonly rut: string;
  /** One entry per year, most recent first. */
  readonly anios: readonly F22Declaraciones[];
}

/** Full F22 readback for one año: the selected declaración's folio/estado + the curated
 *  código grid (identity/bank PII excluded). Session principal (ADR-005). The grid is the
 *  same `f22Compacto` either way; with `full` we ALSO attach the contador `grupos` split
 *  (ingresos / deducciones / retenciones·PPM·créditos / resultado / otros, #27). Without
 *  `full` there is no `grupos` — the default output is unchanged. */
export async function f22Status(
  runtime: Runtime,
  args: { anio: string | number; folio?: string; full?: boolean },
): Promise<F22Estado> {
  const anio = Anio.parse(args.anio); // fail fast on a bad year — no session opened
  const start = runtime.clock.now().getTime();
  try {
    const estado = await withSession(runtime, async (session, ctx) => {
      const rut = Rut.parse(ctx.sessionRut); // session-keyed: ALWAYS the principal
      const decls = await fetchF22Declaraciones(session, { rut, anio });
      const folio = args.folio ?? pickVigenteFolio(decls.declaraciones);
      if (folio === null) {
        return { ...decls, folio: null, estado: null, codigos: [] };
      }
      await runtime.clock.sleep(pacingMs()); // pace the 2nd POST
      const codigos = await fetchF22Grid(session, { rut, anio, folio });
      const selected = decls.declaraciones.find((d) => d.folio === folio);
      const base = { ...decls, folio, estado: selected?.estado ?? null, codigos };
      return args.full ? { ...base, grupos: groupCodigos(codigos) } : base;
    });
    audit(runtime, 'f22_estado', 'ok', {
      rut: estado.rut,
      period: anio.canonical,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return estado;
  } catch (e) {
    audit(runtime, 'f22_estado', 'failed', { period: anio.canonical });
    throw e;
  }
}

/** Multi-year estado overview: the last `years` años (default 5, most recent first),
 *  estado only (one `buscaDeclVgte` per year, paced), under ONE session. Session
 *  principal (ADR-005). A not-yet-filed / missing year is a clean `tieneDeclaracion:false`. */
export async function f22Overview(
  runtime: Runtime,
  args: { years?: number } = {},
): Promise<F22Overview> {
  const years = Math.min(
    Math.max(Math.trunc(args.years ?? DEFAULT_OVERVIEW_YEARS), 1),
    MAX_OVERVIEW_YEARS,
  );
  const currentYear = runtime.clock.now().getFullYear();
  const anios = Array.from({ length: years }, (_, i) => Anio.of(currentYear - i));
  const start = runtime.clock.now().getTime();
  try {
    const result = await withSession(runtime, async (session, ctx) => {
      const rut = Rut.parse(ctx.sessionRut);
      const out: F22Declaraciones[] = [];
      for (let i = 0; i < anios.length; i++) {
        if (i > 0) await runtime.clock.sleep(pacingMs()); // pace between years
        out.push(await fetchF22Declaraciones(session, { rut, anio: anios[i]! }));
      }
      return { rut: rut.canonical, anios: out };
    });
    audit(runtime, 'f22_overview', 'ok', {
      rut: result.rut,
      years,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return result;
  } catch (e) {
    audit(runtime, 'f22_overview', 'failed', { years });
    throw e;
  }
}

/** F22 observaciones (inconsistencias) for one año: resolve the folio (vigente, or
 *  `--folio`) via `buscaDeclVgte`, then read its observaciones via `situacionObservacion`
 *  (código + glosa + ayuda URL). Session principal (ADR-005), paced; empty/no-declaración
 *  is a clean "sin observaciones", NOT an error. */
export interface F22Observaciones {
  readonly rut: string;
  readonly anio: string;
  readonly tieneDeclaracion: boolean;
  readonly folio: string | null; // the folio the observaciones were read for
  readonly observaciones: readonly ObservacionF22[];
}

export async function f22Observaciones(
  runtime: Runtime,
  args: { anio: string | number; folio?: string },
): Promise<F22Observaciones> {
  const anio = Anio.parse(args.anio); // fail fast on a bad year — no session opened
  // `situacionObservacion` posts `folio` as a NUMBER (observed); reject a non-numeric
  // `--folio` here so a malformed value fails fast instead of silently posting
  // `folio:null` (Number("abc")=NaN → JSON null). Validate before opening a session.
  if (args.folio !== undefined && !/^\d+$/.test(args.folio)) {
    throw new ValidationError(`Folio inválido: "${args.folio}" (debe ser numérico).`);
  }
  const start = runtime.clock.now().getTime();
  try {
    const result = await withSession(runtime, async (session, ctx) => {
      const rut = Rut.parse(ctx.sessionRut); // session-keyed: ALWAYS the principal
      const decls = await fetchF22Declaraciones(session, { rut, anio });
      const folio = args.folio ?? pickVigenteFolio(decls.declaraciones);
      const base = {
        rut: rut.canonical,
        anio: anio.canonical,
        tieneDeclaracion: decls.tieneDeclaracion,
      };
      if (folio === null) {
        return { ...base, folio: null, observaciones: [] };
      }
      await runtime.clock.sleep(pacingMs()); // pace the 2nd POST
      const observaciones = await fetchF22Observaciones(session, { rut, anio, folio });
      return { ...base, folio, observaciones };
    });
    audit(runtime, 'f22_observaciones', 'ok', {
      rut: result.rut,
      period: anio.canonical,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return result;
  } catch (e) {
    audit(runtime, 'f22_observaciones', 'failed', { period: anio.canonical });
    throw e;
  }
}

/** F22 historial (eventos) for one año: the per-declaración event timeline (declaración
 *  recibida, devolución autorizada, giros, rectificatorias…). DEFAULT reads EVERY folio of
 *  the año (rectificatorias included — "todos sus folios"); `--folio` scopes to one. Events
 *  are aggregated across folios and sorted most-recent-first. Session principal (ADR-005),
 *  paced; no-declaración / empty is a clean "sin eventos", NOT an error.
 *
 *  PER-FOLIO RESILIENCE: SII's `buscaEventos` can fail on ONE folio while others succeed —
 *  observed live (AT 2026): the vigente folio returned its events, a superseded folio
 *  returned a server-side parse error (`"For input string: …"`). Since the default fans out
 *  over every folio, one folio's `F22Error` MUST NOT bury the rest — it is captured verbatim
 *  in `foliosConError` (ADR-004: surfaced, never hidden, never retried) while the good folios'
 *  events still come back. A session-level failure (NotAuthenticated/SessionExpired) is NOT an
 *  F22Error, so it still aborts the whole read. */
export interface F22Historial {
  readonly rut: string;
  readonly anio: string;
  readonly tieneDeclaracion: boolean;
  readonly folios: readonly string[]; // every folio attempted (the año's declaraciones / the override)
  readonly eventos: readonly EventoF22[]; // most-recent-first, across the folios that succeeded
  readonly foliosConError: readonly { folio: string; error: string }[]; // verbatim SII error per failed folio
}

export async function f22Historial(
  runtime: Runtime,
  args: { anio: string | number; folio?: string },
): Promise<F22Historial> {
  const anio = Anio.parse(args.anio); // fail fast on a bad year — no session opened
  // `buscaEventos` posts `folio` as a string but SII rejects a non-numeric one; validate a
  // `--folio` override before opening a session (consistent with observaciones).
  if (args.folio !== undefined && !/^\d+$/.test(args.folio)) {
    throw new ValidationError(`Folio inválido: "${args.folio}" (debe ser numérico).`);
  }
  const start = runtime.clock.now().getTime();
  try {
    const result = await withSession(runtime, async (session, ctx) => {
      const rut = Rut.parse(ctx.sessionRut); // session-keyed: ALWAYS the principal
      const decls = await fetchF22Declaraciones(session, { rut, anio });
      // All distinct folios of the año (most carry one; rectificatorias add more), or the
      // single `--folio` override.
      const folios =
        args.folio !== undefined
          ? [args.folio]
          : [
              ...new Set(
                decls.declaraciones.map((d) => d.folio).filter((f): f is string => f !== null),
              ),
            ];
      const base = {
        rut: rut.canonical,
        anio: anio.canonical,
        tieneDeclaracion: decls.tieneDeclaracion,
      };
      const eventos: EventoF22[] = [];
      const foliosConError: { folio: string; error: string }[] = [];
      for (const folio of folios) {
        await runtime.clock.sleep(pacingMs()); // pace each buscaEventos POST (ADR-004)
        try {
          eventos.push(...(await fetchF22Historial(session, { rut, anio, folio })));
        } catch (e) {
          // A single folio's SII error (F22Error) is recorded verbatim and skipped — it must
          // not bury the other folios' events. A session-level failure is NOT an F22Error and
          // propagates (aborting the whole read, as it should).
          if (e instanceof F22Error) {
            foliosConError.push({ folio, error: e.message });
            continue;
          }
          throw e;
        }
      }
      // Most-recent-first across every folio read. SII serves each folio's events
      // oldest-first (chronological), so within the SAME date the later-collected event is
      // the more recent — tiebreak by wire position DESC. Without it, same-day events (e.g. a
      // rectificatoria's "enviada" then "aceptada", both 28/06) would print envío→aceptación,
      // the reverse of most-recent-first. Decorate-sort-undecorate keeps it deterministic.
      const ordered = eventos
        .map((e, i) => ({ e, i }))
        .sort((a, b) => eventoDateKey(b.e.fecha) - eventoDateKey(a.e.fecha) || b.i - a.i)
        .map((d) => d.e);
      return { ...base, folios, eventos: ordered, foliosConError };
    });
    audit(runtime, 'f22_historial', 'ok', {
      rut: result.rut,
      period: anio.canonical,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return result;
  } catch (e) {
    audit(runtime, 'f22_historial', 'failed', { period: anio.canonical });
    throw e;
  }
}

// --- Información de terceros (#183; contract: sii-contract/f22.md « Terceros ») ----------

/** At most this many detalle pages per call (300 rows, ~30 s paced). A bigger DJ comes back
 *  `incompleto` with `paginasLeidas`, and the rest is read with `pagina`: one unattended call
 *  never turns into hundreds of POSTs (ADR-004: never hammer SII). */
const MAX_PAGINAS_TERCEROS = 30;

// Session-keyed (ADR-005): the shared guard, with this surface's own error + wording. The other
// F22 tasks predate it and read the principal silently; this one refuses, so an `operate`
// pointer at an empresa never answers with the persona's data under the empresa's header.
const assertSelfOperatingTerceros = (runtime: Runtime): Promise<void> =>
  assertOperatingSelf(
    runtime,
    (empresa) =>
      new F22Error(
        `La información de terceros (F22) es session-keyed: el SII autoriza por el titular de la ` +
          `sesión, no por el RUT operado (${empresa}). Para la de esa empresa, inicia sesión como ` +
          'ella (`sii auth logout` y luego `sii auth login`).',
      ),
  );

/** The principal's own identity, dropped from every row by value. The name is the razón social
 *  cached at login (local, no SII call); a login that could not read it stored the RUT there. */
async function identidadPropia(runtime: Runtime, sessionRut: string): Promise<IdentidadPropia> {
  const rut = Rut.parse(sessionRut);
  const op = await readOperateState(runtime.store);
  const nombre = op?.operable.find((o) => o.isSelf)?.razonSocial ?? null;
  return { rut, nombre: nombre !== null && Rut.tryParse(nombre) === null ? nombre : null };
}

function parseDj(dj: string | number): string {
  const s = String(dj).trim();
  if (!/^\d{1,5}$/.test(s)) {
    throw new ValidationError(`Código de DJ inválido: "${s}" (debe ser numérico, p. ej. 1887).`);
  }
  return String(Number(s));
}

function parsePagina(pagina: string | number): number {
  const n = Number(String(pagina).trim());
  if (!Number.isInteger(n) || n < 1) {
    throw new ValidationError(`Página inválida: "${String(pagina)}" (debe ser un entero ≥ 1).`);
  }
  return n;
}

/** The per-DJ resumen of the información de terceros for an año tributario: ONE call. Each ítem
 *  carries its aggregate rows (informantes, montos informados); the rows themselves are
 *  `f22TercerosDetalle`, one DJ at a time. */
export interface F22Terceros {
  readonly rut: string;
  readonly anio: string;
  readonly declaraciones: readonly DeclaracionTercero[];
}

export async function f22Terceros(
  runtime: Runtime,
  args: { anio: string | number },
): Promise<F22Terceros> {
  const anio = Anio.parse(args.anio); // fail fast on a bad year — no session opened
  await assertSelfOperatingTerceros(runtime);
  const start = runtime.clock.now().getTime();
  try {
    const result = await withSession(runtime, async (session, ctx) => {
      const propio = await identidadPropia(runtime, ctx.sessionRut);
      const declaraciones = await fetchF22TercerosResumen(session, { anio, propio });
      return { rut: propio.rut.canonical, anio: anio.canonical, declaraciones };
    });
    audit(runtime, 'f22_terceros', 'ok', {
      rut: result.rut,
      period: anio.canonical,
      count: result.declaraciones.length,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return result;
  } catch (e) {
    audit(runtime, 'f22_terceros', 'failed', { period: anio.canonical });
    throw e;
  }
}

/** One DJ's rows. Without `pagina` it reads every page (⌈registros/10⌉, paced, capped at
 *  `MAX_PAGINAS_TERCEROS`); with `pagina`, exactly that page (one call).
 *
 *  PER-PAGE RESILIENCE, like `f22Historial`'s folios: a page SII fails is recorded verbatim in
 *  `paginasConError` and the other pages are kept; `incompleto` says some page was not read.
 *  Page 1 carries the total, so its failure, like a session-level one, aborts the read. */
export interface F22TercerosDetalle {
  readonly rut: string;
  readonly anio: string;
  readonly dj: string;
  readonly registros: number;
  readonly paginas: number;
  readonly paginasLeidas: readonly number[];
  readonly filas: readonly FilaTercero[];
  readonly paginasConError: readonly { pagina: number; error: string }[];
  readonly incompleto: boolean;
}

export async function f22TercerosDetalle(
  runtime: Runtime,
  args: { anio: string | number; dj: string | number; pagina?: string | number },
): Promise<F22TercerosDetalle> {
  const anio = Anio.parse(args.anio); // all three validated before any session opens
  const dj = parseDj(args.dj);
  const pagina = args.pagina !== undefined ? parsePagina(args.pagina) : undefined;
  await assertSelfOperatingTerceros(runtime);
  const start = runtime.clock.now().getTime();
  try {
    const result = await withSession(runtime, async (session, ctx) => {
      const propio = await identidadPropia(runtime, ctx.sessionRut);
      const read = (p: number) =>
        fetchF22TercerosDetalle(session, { rut: propio.rut, anio, dj, pagina: p, propio });
      const first = await read(pagina ?? 1);
      // A page past the end answers `cantRegistros: 0` (observed), so with an out-of-range
      // `pagina` the totals read 0 too.
      const paginas = Math.ceil(first.registros / TERCEROS_PAGE_SIZE);
      const filas: FilaTercero[] = [...first.filas];
      const paginasLeidas = [pagina ?? 1];
      const paginasConError: { pagina: number; error: string }[] = [];
      if (pagina === undefined) {
        for (let p = 2; p <= Math.min(paginas, MAX_PAGINAS_TERCEROS); p++) {
          await runtime.clock.sleep(pacingMs()); // pace each page (ADR-004)
          try {
            filas.push(...(await read(p)).filas);
            paginasLeidas.push(p);
          } catch (e) {
            // One page's SII error is recorded verbatim and skipped; a session-level failure is
            // not an F22Error and aborts the read.
            if (e instanceof F22Error) {
              paginasConError.push({ pagina: p, error: e.message });
              continue;
            }
            throw e;
          }
        }
      }
      return {
        rut: propio.rut.canonical,
        anio: anio.canonical,
        dj,
        registros: first.registros,
        paginas,
        paginasLeidas,
        filas,
        paginasConError,
        // With `pagina` the one page was read or the call threw, so only a full read can fall short.
        incompleto:
          paginasConError.length > 0 || (pagina === undefined && paginas > MAX_PAGINAS_TERCEROS),
      };
    });
    audit(runtime, 'f22_terceros_detalle', 'ok', {
      rut: result.rut,
      period: anio.canonical,
      dj,
      count: result.filas.length,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return result;
  } catch (e) {
    audit(runtime, 'f22_terceros_detalle', 'failed', { period: anio.canonical, dj });
    throw e;
  }
}
