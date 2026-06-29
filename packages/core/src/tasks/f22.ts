// Public F22 task API the surfaces call (ADR-003). Wraps the portal facade in
// `withSession` and writes one audit receipt. F22 is SESSION-KEYED (ADR-005): it
// authorizes by the session principal, IGNORES the operate pointer, and takes NO
// `--rut` — a represented empresa's F22 is reached by being in the empresa's session
// (logout→login), confirmed live (the body RUT returns a clean negative, not the
// empresa's F22). The año is validated locally BEFORE any session.
import { withSession } from '../auth/index.js';
import { recordAudit } from '../audit/index.js';
import { Anio } from '../periodo/index.js';
import { Rut } from '../rut/index.js';
import { DEFAULT_SETTINGS } from '../config/index.js';
import {
  fetchF22Declaraciones,
  fetchF22Grid,
  fetchF22Observaciones,
  pickVigenteFolio,
} from '../portal/f22.js';
import type { F22Declaraciones, F22Estado, ObservacionF22 } from '../portal/f22.js';
import type { AuditEntry, Runtime } from '../seams/index.js';

export type {
  DeclaracionF22,
  CodigoF22,
  ObservacionF22,
  F22Declaraciones,
  F22Estado,
} from '../portal/f22.js';

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

/** Full F22 readback for one año: the selected declaración's folio/estado + the
 *  curated código grid (header/PII códigos excluded). Session principal (ADR-005). */
export async function f22Status(
  runtime: Runtime,
  args: { anio: string | number; folio?: string },
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
      return { ...decls, folio, estado: selected?.estado ?? null, codigos };
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
