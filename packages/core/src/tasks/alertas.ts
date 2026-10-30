// `alertas` — one read of what SII holds against the taxpayer but does not push (ADR-030).
// A composite: ONE `withSession` over the existing portal facades (never the other tasks, which
// would each open a session), every call paced, one audit receipt. SESSION-KEYED (ADR-005): it
// reads the session principal, takes no `--rut`, and refuses a representing pointer up front.
// Stateless: each alerta has an id built from what it is, so a caller diffs runs by id.
import { assertOperatingSelf, withSession } from '../auth/index.js';
import { recordAudit } from '../audit/index.js';
import { Anio, Periodo } from '../periodo/index.js';
import { Rut } from '../rut/index.js';
import {
  BteError,
  NotAuthenticatedError,
  RateLimitError,
  SiiError,
  ValidationError,
  classifyError,
  type ErrorKind,
} from '../errors/index.js';
import { DEFAULT_SETTINGS, HOSTS } from '../config/index.js';
import { parseDatosCntrNow, type DatosCntr } from '../auth/datos-cntr.js';
import {
  fetchF22Declaraciones,
  fetchF22Observaciones,
  pickVigenteFolio,
} from '../portal/f22/index.js';
import { fetchF29Estado, type DeclaracionEstadoF29 } from '../portal/f29.js';
import { fetchPeticiones } from '../portal/peticiones.js';
import { fetchPredios } from '../portal/bienes-raices-misii.js';
import { fetchBteMensual } from '../portal/bte.js';
import type { PortalSession, Runtime } from '../seams/index.js';

export const FUENTES_ALERTAS = ['f22', 'f29', 'peticiones', 'bienes_raices'] as const;
export type FuenteAlertas = (typeof FUENTES_ALERTAS)[number];

export type TipoAlerta =
  | 'f22_observacion'
  | 'f29_rechazada'
  | 'f29_guardada'
  | 'f29_otro_estado'
  | 'f29_sin_declarar'
  | 'peticion_estado'
  | 'contribuciones_vencida'
  | 'contribuciones_por_vencer';

/** One alerta. Every field is present (null when it does not apply), so the JSON is stable. */
export interface Alerta {
  /** Built from the alerta's identity, never from the run: the same condition has the same id
   *  on every run. Changing a format is Breaking (ADR-030 / ADR-021 amendment). */
  readonly id: string;
  readonly tipo: TipoAlerta;
  readonly origen: FuenteAlertas;
  readonly periodo: string | null; // F29, YYYY-MM
  readonly anio: string | null; // F22, año tributario YYYY
  readonly folio: string | null; // the declaración's folio (F22 / F29)
  readonly peticion: number | null; // número de la petición
  readonly codigo: string | null; // F22 observación código (B102, G37…)
  readonly estado: string | null; // SII's estado label, verbatim
  readonly mensaje: string | null; // SII's own text (glosa, nota), verbatim
  readonly url: string | null; // SII's ayuda link, when it gives one
  readonly fecha: string | null; // YYYY-MM-DD
  /** `f29_sin_declarar` only: both due dates. `estimado` because holidays are not known. */
  readonly vencimiento?: {
    readonly conPago: string;
    readonly sinPago: string;
    readonly estimado: true;
  };
  /** `bienes_raices` only: the predio and the cuota (ADR-032). */
  readonly contribucion?: {
    readonly rol: string;
    readonly comuna: string | null;
    /** `<año>-<n>`, as SII's grid prints « Año Nº Cuota ». */
    readonly cuota: string;
    readonly monto: number | null;
  };
}

export type EstadoFuente = 'ok' | 'no_declarante' | 'error' | 'omitida';

export interface FuenteResultado {
  readonly origen: FuenteAlertas;
  readonly estado: EstadoFuente;
  /** The source's SII failure, kind + verbatim message (ADR-012). Alertas read before it stay. */
  readonly error?: { readonly type: ErrorKind; readonly error: string };
}

export interface AlertasResult {
  readonly rut: string;
  readonly alertas: readonly Alerta[];
  readonly fuentes: readonly FuenteResultado[];
  /** A requested source failed: the list may be missing alertas. */
  readonly incompleto: boolean;
}

export interface AlertasArgs {
  /** `f22,f29,peticiones,bienes_raices` (CLI) or a list (MCP); default all. */
  readonly fuentes?: string | readonly string[] | undefined;
  /** YYYY-MM-DD: drop alertas dated before it (undated ones are kept). */
  readonly desde?: string | undefined;
}

/** F22: años tributarios read, the current one first (3 ⇒ the prescription window). */
const F22_ANIOS = 3;
/** F29: períodos read, ending at the previous month (the current one is not due yet). */
const F29_PERIODOS = 12;
/** Bienes raíces: a vigente cuota due within this many days is « por vencer » (ADR-032). */
const CONTRIBUCIONES_DIAS = 30;

const pacingMs = (): number => Math.round(1000 / DEFAULT_SETTINGS.rateLimitRps);

const pad = (n: number): string => String(n).padStart(2, '0');
const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseFuentes(input: AlertasArgs['fuentes']): FuenteAlertas[] {
  if (input === undefined) return [...FUENTES_ALERTAS];
  const raw = typeof input === 'string' ? input.split(',') : [...input];
  const names = raw.map((s) => s.trim().toLowerCase()).filter((s) => s !== '');
  if (names.length === 0) {
    throw new ValidationError(`Indica al menos una fuente: ${FUENTES_ALERTAS.join(', ')}.`);
  }
  for (const n of names) {
    if (!(FUENTES_ALERTAS as readonly string[]).includes(n)) {
      throw new ValidationError(
        `Fuente desconocida: "${n}". Las fuentes son ${FUENTES_ALERTAS.join(', ')}.`,
      );
    }
  }
  // Keep the canonical order, so the result does not depend on how the caller listed them.
  return FUENTES_ALERTAS.filter((f) => names.includes(f));
}

function parseDesde(input: string | undefined): string | null {
  if (input === undefined) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  if (!m || !d || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    throw new ValidationError(`Fecha inválida en --desde: "${input}" (formato AAAA-MM-DD).`);
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** SII's `DD/MM/YYYY` (F29 `declFechaCreacion`, observed) as YYYY-MM-DD; anything else ⇒ null. */
function fechaSii(s: string | null): string | null {
  const m = s ? /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** The F29 due dates of `periodo`, from SII's own FAQ (www.sii.cl/preguntas_frecuentes/
 *  impuestos_mensuales/001_130_1060.htm, updated 17/06/2025, read 2026-10-23): the 12th of the
 *  next month in general; the 20th for an Internet declaration WITH payment by an eligible
 *  taxpayer; the 28th for one "sin pago" or sin movimiento. A due date with payment on a
 *  Saturday or holiday moves to the next business day: we move it off a weekend, holidays are not
 *  known (hence `estimado`). `dia` is the taxpayer's regime (`autorizadoDeclararDia20`). */
export function vencimientoF29(
  periodo: Periodo,
  dia: 12 | 20 = 20,
): { conPago: Date; sinPago: Date } {
  const year = periodo.month === 12 ? periodo.year + 1 : periodo.year;
  const month = periodo.month === 12 ? 0 : periodo.month; // JS month index of the NEXT month
  const conPago = new Date(year, month, dia);
  const dow = conPago.getDay();
  if (dow === 6) conPago.setDate(dia + 2);
  if (dow === 0) conPago.setDate(dia + 1);
  return { conPago, sinPago: new Date(year, month, 28) };
}

/** When the account must file F29 and by which day, from its own `DatosCntrNow` (Mi SII). */
interface RegimenF29 {
  readonly inicio: Periodo | null; // no F29 is due before the month of inicio de actividades
  readonly termino: Periodo | null; // nor after the month of término de giro
  readonly dia: 12 | 20;
  /** SII holds the account in a primera-categoría regime: F29 is due every month from this
   *  month on, filed or not. `null` means unknown, never "not obligated". */
  readonly obligadoDesde: Periodo | null;
  /** SII holds the account in segunda categoría only: F29 is due in a month only when its issued
   *  boletas carry retención del emisor (ADR-030 amendment, #245). */
  readonly segundaCategoria: boolean;
}

// SII's FAQ: F29 is mandatory every month, sin movimiento included, for "todos aquellos
// contribuyentes afectos a la Ley de Impuestos a las Ventas y Servicios" from the « Inicio de
// Actividades en la primera categoría » (preguntas_frecuentes/impuestos_mensuales/
// 001_130_1051.htm and 001_130_1053.htm, updated 05/06/2025, read 2026-10-23), until the término
// de giro (001_130_2312.htm). The `atributos` codes of a primera-categoría regime, as observed:
// only exact codes, a new one joins with its citation. A persona with only honorarios has an
// inicio de actividades too but none of these (observed 2026-10-23: `NOTI`, `SGPE`).
const REGIMEN_PRIMERA_CATEGORIA = new Set([
  '14D1', // « REGIMEN PRO PYME GENERAL (14D) », observed 2026-10-23 on an empresa
]);

/** `"2026-03-26 00:00:00.0"` (observed) ⇒ that month; anything else ⇒ null (no bound). */
function mesDe(s: string | null | undefined): Periodo | null {
  const m = s ? /^(\d{4})-(\d{2})-\d{2}/.exec(s) : null;
  return m ? Periodo.of(Number(m[1]), Number(m[2])) : null;
}

/** An atributo's `fechaInicio`, `"26-03-2026"` (observed) ⇒ that month; anything else ⇒ null. */
function mesDeAtributo(s: string | null | undefined): Periodo | null {
  const m = s ? /^\d{2}-(\d{2})-(\d{4})$/.exec(s.trim()) : null;
  return m ? Periodo.of(Number(m[2]), Number(m[1])) : null;
}

const antes = (a: Periodo, b: Periodo): boolean =>
  a.year < b.year || (a.year === b.year && a.month < b.month);

/** An atributo still in force: no end date, not deleted. */
const activo = (a: NonNullable<DatosCntr['atributos']>[number]): boolean =>
  a.fechaTermino == null && a.eliminado == null;

/** The month the account entered an observed primera-categoría regime, and the inicio de
 *  actividades, whichever is later: an account that moved from honorarios into the regime owed
 *  nothing before it (#209 review). Either one unknown ⇒ null. */
function obligadoDesde(
  inicio: Periodo | null,
  atributos: NonNullable<DatosCntr['atributos']>,
): Periodo | null {
  if (!inicio) return null; // no lower bound: "due every month" would reach before the account
  const desde = atributos
    .filter((a) => REGIMEN_PRIMERA_CATEGORIA.has(a.atrCodigo?.trim() ?? '') && activo(a))
    .map((a) => mesDeAtributo(a.fechaInicio));
  const meses = desde.filter((p): p is Periodo => p !== null);
  // An active regime whose start does not parse is not proof of when the obligation began.
  if (meses.length === 0 || meses.length < desde.length) return null;
  const regimen = meses.reduce((a, b) => (antes(a, b) ? a : b));
  return antes(regimen, inicio) ? inicio : regimen;
}

// Segunda categoría owes no F29 « sin movimiento » (preguntas_frecuentes/impuestos_mensuales/
// 001_130_1154.htm, read 2026-10-29); it owes the F29 of a month whose boletas carry retención del
// emisor (ayudas/nuevos_contribuyentes/boleta-honorarios.html, read 2026-10-29). SII registers the
// category in the `SGPE` atributo's `valor`, observed 2026-10-23 on a honorarios-only persona as
// « Tipo contribuyente=1 y Categoría Contribuyente = 2 ». Only that exact category counts: « = 1 y
// 2 » or any other text is unknown and keeps the activity rule. `valor` is read for SGPE only:
// under NOTI it is the email. SII's own `valor` carries three U+001A where the « í » goes, and two
// spaces before the « y » (observed 2026-10-29, live #245). That is in SII's body, not a decoding
// artefact: a TextDecoder never yields U+001A (an undecodable byte becomes U+FFFD, #224). So
// whatever stands for the accent is accepted; the anchor on « = 2 » keeps « = 1 y 2 » out.
const SEGUNDA_CATEGORIA = /Categor\S*a\s+Contribuyente\s*=\s*2\s*$/i;

function segundaCategoria(atributos: NonNullable<DatosCntr['atributos']>): boolean {
  const activos = atributos.filter(activo);
  if (activos.some((a) => REGIMEN_PRIMERA_CATEGORIA.has(a.atrCodigo?.trim() ?? ''))) return false;
  return activos.some((a) => {
    const valor = a['valor'];
    return (
      a.atrCodigo?.trim() === 'SGPE' && typeof valor === 'string' && SEGUNDA_CATEGORIA.test(valor)
    );
  });
}

async function leerRegimen(session: PortalSession): Promise<RegimenF29> {
  // A dead jar bounces here and the seam raises SessionExpiredError (aborts the read). A live
  // page without the object only loses the bounds: no window, and the later day-20 deadline.
  const { body } = await session.requestText(HOSTS.miSii, { method: 'GET' });
  const datos = parseDatosCntrNow(body);
  const c = datos?.contribuyente;
  const inicio = mesDe(c?.fechaInicioActividades);
  return {
    inicio,
    obligadoDesde: obligadoDesde(inicio, datos?.atributos ?? []),
    segundaCategoria: segundaCategoria(datos?.atributos ?? []),
    termino: mesDe(c?.fechaTerminoGiro),
    // `"S"` observed. A day-12 taxpayer says "N"; an unknown value keeps the 20th, the later of
    // the two, so the alerta is never early.
    dia: c?.autorizadoDeclararDia20?.trim().toUpperCase() === 'N' ? 12 : 20,
  };
}

const base = (origen: FuenteAlertas) => ({
  origen,
  periodo: null,
  anio: null,
  folio: null,
  peticion: null,
  codigo: null,
  estado: null,
  mensaje: null,
  url: null,
  fecha: null,
});

async function leerF22(
  runtime: Runtime,
  session: PortalSession,
  rut: Rut,
  push: (a: Alerta) => void,
): Promise<EstadoFuente> {
  const current = runtime.clock.now().getFullYear();
  for (let i = 0; i < F22_ANIOS; i++) {
    const anio = Anio.of(current - i);
    if (i > 0) await runtime.clock.sleep(pacingMs());
    const decls = await fetchF22Declaraciones(session, { rut, anio });
    const folio = pickVigenteFolio(decls.declaraciones);
    if (folio === null) continue; // no declaración that año: nothing to observe
    await runtime.clock.sleep(pacingMs());
    for (const o of await fetchF22Observaciones(session, { rut, anio, folio })) {
      push({
        ...base('f22'),
        id: `f22:${anio.canonical}:${folio}:${o.codigo}`,
        tipo: 'f22_observacion',
        anio: anio.canonical,
        folio,
        codigo: o.codigo,
        mensaje: o.descripcion,
        url: o.url,
      });
    }
  }
  return 'ok';
}

const ESTADO_VIGENTE = 1;
const ESTADO_GUARDADA = 10; // observed (sii-contract/f29.md)
const ESTADO_RECHAZADA = 70; // "Rechazada por pago inconcluso", observed

const isVigente = (d: DeclaracionEstadoF29): boolean =>
  d.estadoId === ESTADO_VIGENTE || (d.estado ?? '').toLowerCase().includes('vigente');

async function leerF29(
  runtime: Runtime,
  session: PortalSession,
  rut: Rut,
  push: (a: Alerta) => void,
): Promise<EstadoFuente> {
  const now = runtime.clock.now();
  const today = isoDate(now);
  const periodos = Array.from({ length: F29_PERIODOS }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - F29_PERIODOS + i, 1);
    return Periodo.of(d.getFullYear(), d.getMonth() + 1);
  });
  const regimen = await leerRegimen(session);
  const sinDeclarar: { periodo: Periodo; alerta: Alerta }[] = [];
  let declarante = false;
  for (let i = 0; i < periodos.length; i++) {
    const periodo = periodos[i]!;
    await runtime.clock.sleep(pacingMs()); // after the Mi SII read too (ADR-004)
    const { declaraciones } = await fetchF29Estado(session, { rut, periodo });
    if (declaraciones.some(isVigente)) {
      declarante = true;
      continue;
    }
    const rec =
      declaraciones.find((d) => d.estadoId === ESTADO_RECHAZADA) ??
      declaraciones.find((d) => d.estadoId === ESTADO_GUARDADA) ??
      declaraciones[0];
    if (rec) {
      const tipo: TipoAlerta =
        rec.estadoId === ESTADO_RECHAZADA
          ? 'f29_rechazada'
          : rec.estadoId === ESTADO_GUARDADA
            ? 'f29_guardada'
            : 'f29_otro_estado';
      // A Guardada borrador carries folio 0 (observed): not a folio of anything.
      const folio = rec.folio ? String(rec.folio) : null;
      const suffix =
        tipo === 'f29_otro_estado' ? `otro_estado:${rec.estadoId ?? 'null'}` : tipo.slice(4);
      push({
        ...base('f29'),
        id: `f29:${periodo.formatted}:${suffix}${folio ? `:${folio}` : ''}`,
        tipo,
        periodo: periodo.formatted,
        folio,
        estado: rec.estado,
        fecha: fechaSii(rec.fecha),
      });
      continue;
    }
    // Outside the account's own obligation window nothing was due: a month before the empresa
    // existed is not a missing F29 (observed live: five false alertas before ADR-030's fix).
    if (regimen.inicio && antes(periodo, regimen.inicio)) continue;
    if (regimen.termino && antes(regimen.termino, periodo)) continue;
    const venc = vencimientoF29(periodo, regimen.dia);
    if (today <= isoDate(venc.conPago)) continue; // due date not passed: still on time
    sinDeclarar.push({
      periodo,
      alerta: {
        ...base('f29'),
        id: `f29:${periodo.formatted}:sin_declarar`,
        tipo: 'f29_sin_declarar',
        periodo: periodo.formatted,
        fecha: isoDate(venc.conPago),
        vencimiento: {
          conPago: isoDate(venc.conPago),
          sinPago: isoDate(venc.sinPago),
          estimado: true,
        },
      },
    });
  }
  // Segunda categoría: a month is due only when its issued boletas carry retención del emisor
  // (#245). The activity rule would get it wrong both ways: one such month filed made every other
  // month « sin declarar ». SII's month total leaves anuladas out, so page 0 is enough.
  if (regimen.segundaCategoria) {
    // With no known inicio there is no lower bound: a month before the account issued any boleta
    // may answer BTE's « no informe » and end the source as an error (not observed; noted, #254).
    let debido = false;
    for (const { periodo, alerta } of sinDeclarar) {
      await runtime.clock.sleep(pacingMs());
      const { totales } = await fetchBteMensual(
        session,
        { rut, periodo, side: 'EMITIDAS' },
        () => runtime.clock.sleep(pacingMs()),
        { soloTotales: true },
      );
      // Unknown is never "not obligated": a missing total ends the source as an error.
      if (totales.retencionEmisor === null) {
        throw new BteError(
          `El SII no entregó la suma de retención del emisor de las boletas de ${periodo.formatted}.`,
        );
      }
      if (totales.retencionEmisor > 0) {
        debido = true;
        push(alerta);
      }
    }
    return declarante || debido ? 'ok' : 'no_declarante';
  }
  // An account with no Vigente F29 in the window does not file F29 (a persona without giro):
  // twelve "sin declarar" would be noise, not alertas (ADR-030). Unless SII holds it in a
  // primera-categoría regime: then a new business that never filed is exactly the case (#208),
  // from the month its obligation began.
  const desde = declarante ? null : regimen.obligadoDesde;
  if (!declarante && !desde) return 'no_declarante';
  for (const { periodo, alerta } of sinDeclarar) {
    if (desde && antes(periodo, desde)) continue;
    push(alerta);
  }
  return 'ok';
}

async function leerPeticiones(
  session: PortalSession,
  rut: Rut,
  push: (a: Alerta) => void,
): Promise<EstadoFuente> {
  const { peticiones } = await fetchPeticiones(session, { rut });
  for (const p of peticiones) {
    const ultimo = p.timeline[0] ?? null; // most-recent-first (portal/peticiones.ts)
    push({
      ...base('peticiones'),
      // The latest transition is in the id, so a petición resurfaces only when it moves.
      id: `peticion:${p.numero}:${ultimo?.fecha ?? p.estadoActual}`,
      tipo: 'peticion_estado',
      peticion: p.numero,
      estado: p.estadoActual,
      mensaje: ultimo?.mensaje ?? null,
      fecha: ultimo?.fecha ? ultimo.fecha.slice(0, 10) : null,
    });
  }
  return 'ok';
}

async function leerBienesRaices(
  runtime: Runtime,
  session: PortalSession,
  push: (a: Alerta) => void,
): Promise<EstadoFuente> {
  const now = runtime.clock.now();
  const limite = isoDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + CONTRIBUCIONES_DIAS),
  );
  for (const p of await fetchPredios(session)) {
    for (const c of p.cuotas) {
      // A vigente cuota whose date did not parse is shown, not hidden (ADR-032).
      const porVencer = !c.vencida && (c.fechaVencimiento === null || c.fechaVencimiento <= limite);
      if (!c.vencida && !porVencer) continue;
      const estado = c.vencida ? 'vencida' : 'por_vencer';
      push({
        ...base('bienes_raices'),
        id:
          `bienes_raices:${p.comuna.codigo}-${p.manzana}-${p.predio}:` +
          `${c.anio ?? 'null'}-${c.semestre ?? 'null'}-${c.cuota ?? 'null'}:${estado}`,
        tipo: c.vencida ? 'contribuciones_vencida' : 'contribuciones_por_vencer',
        estado: c.condicion,
        fecha: c.fechaVencimiento,
        contribucion: {
          rol: p.rol,
          comuna: p.comuna.nombre,
          cuota: `${c.anio ?? '?'}-${c.cuota ?? '?'}`,
          monto: c.totalPago,
        },
      });
    }
  }
  return 'ok';
}

/** Read the alertas of the session principal from the requested sources (ADR-030). */
export async function alertas(runtime: Runtime, args: AlertasArgs = {}): Promise<AlertasResult> {
  const fuentes = parseFuentes(args.fuentes); // fail fast — no session opened
  const desde = parseDesde(args.desde);
  await assertOperatingSelf(
    runtime,
    (empresa) =>
      new ValidationError(
        `alertas es session-keyed: lee las alertas del titular de la sesión, no del RUT operado ` +
          `(${empresa}). Para las de esa empresa, inicia sesión como ella ` +
          '(`sii auth logout` y luego `sii auth login`).',
      ),
  );
  const start = runtime.clock.now().getTime();
  try {
    const result = await withSession(runtime, async (session, ctx) => {
      const rut = Rut.parse(ctx.sessionRut); // session-keyed: ALWAYS the principal
      const found: Alerta[] = [];
      const push = (a: Alerta): void => {
        found.push(a);
      };
      const estados: FuenteResultado[] = [];
      for (let i = 0; i < FUENTES_ALERTAS.length; i++) {
        const origen = FUENTES_ALERTAS[i]!;
        if (!fuentes.includes(origen)) {
          estados.push({ origen, estado: 'omitida' });
          continue;
        }
        if (estados.some((e) => e.estado !== 'omitida')) await runtime.clock.sleep(pacingMs());
        try {
          const estado =
            origen === 'f22'
              ? await leerF22(runtime, session, rut, push)
              : origen === 'f29'
                ? await leerF29(runtime, session, rut, push)
                : origen === 'peticiones'
                  ? await leerPeticiones(session, rut, push)
                  : await leerBienesRaices(runtime, session, push);
          estados.push({ origen, estado });
        } catch (e) {
          // A dead session or SII's rate limit ends the whole read: going on would mean asking
          // again against a block (ADR-004). A bug or a network failure (not a SiiError) must not
          // hide as a source error either. Any other SII failure stops that source only; what it read stays.
          if (e instanceof NotAuthenticatedError || e instanceof RateLimitError) throw e;
          if (!(e instanceof SiiError)) throw e;
          estados.push({
            origen,
            estado: 'error',
            error: { type: classifyError(e).type, error: e.message },
          });
        }
      }
      const alertasFiltradas = desde
        ? found.filter((a) => a.fecha === null || a.fecha >= desde)
        : found;
      return {
        rut: rut.canonical,
        alertas: alertasFiltradas,
        fuentes: estados,
        incompleto: estados.some((e) => e.estado === 'error'),
      };
    });
    // Counts only: the alertas carry SII's free text about the taxpayer (ADR-006).
    recordAudit(runtime, {
      action: 'alertas',
      result: result.incompleto ? 'partial' : 'ok',
      rut: result.rut,
      count: result.alertas.length,
      fuentes: Object.fromEntries(result.fuentes.map((f) => [f.origen, f.estado])),
      durationMs: runtime.clock.now().getTime() - start,
    });
    return result;
  } catch (e) {
    recordAudit(runtime, { action: 'alertas', result: 'failed' });
    throw e;
  }
}
