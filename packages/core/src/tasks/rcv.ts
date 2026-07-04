// Public RCV task API the surfaces call (ADR-003). Each wraps the portal facade in
// `withSession` — consume a live session, resolve the body RUT (override > pointer >
// self, ADR-005) — and writes ONE audit receipt. RCV is BODY-RUT: `--rut`/operate
// selects a represented empresa. The period is validated locally BEFORE any session.
import { withSession } from '../auth/index.js';
import { recordAudit } from '../audit/index.js';
import { DEFAULT_SETTINGS } from '../config/index.js';
import { RcvError } from '../errors/index.js';
import { Periodo } from '../periodo/index.js';
import { Rut } from '../rut/index.js';
import { fetchRcvDetalle, fetchRcvResumen } from '../portal/rcv.js';
import type { RcvDetalle, RcvDetalleDoc, RcvResumen, RcvSide } from '../portal/rcv.js';
import type { AuditEntry, Runtime } from '../seams/index.js';

export type {
  RcvDetalle,
  RcvDetalleDoc,
  RcvResumen,
  RcvResumenRow,
  RcvSide,
} from '../portal/rcv.js';

interface RcvResumenArgs {
  /** Tax period, `YYYYMM` / `YYYY-MM`. Validated locally before any session. */
  readonly periodo: string;
  readonly side: RcvSide;
  /** Per-call operating RUT override (must be in the operable set); else the pointer. */
  readonly rut?: string;
}

interface RcvDetalleArgs extends RcvResumenArgs {
  /** SII DTE type code (from a prior `rcvSummary` for the same period). */
  readonly codigoTipoDoc: string;
}

/** Inter-request pace (ms) for the multi-POST fan-out — never hammer SII (ADR-004). */
const pacingMs = (): number => Math.round(1000 / DEFAULT_SETTINGS.rateLimitRps);

/** A detalle doc flattened across DTE types, carrying the type it belongs to. */
export interface RcvDetalleAllDoc extends RcvDetalleDoc {
  /** The DTE type code this doc belongs to (from the resumen enumeration). */
  readonly codigoTipoDoc: string;
}

/** Flat "todos los documentos" view of one (RUT, period, side): every detalle doc across
 *  every DTE type the resumen reports, from a SINGLE session. */
export interface RcvDetalleAll {
  readonly rut: string;
  readonly periodo: string; // YYYY-MM
  readonly side: RcvSide;
  /** All docs across all types, each carrying its `codigoTipoDoc`. */
  readonly docs: readonly RcvDetalleAllDoc[];
  /** true when ≥1 type was rejected by SII (its docs are absent from `docs`). */
  readonly incomplete: boolean;
  /** DTE type codes SII rejected — captured verbatim as absent, never retried (ADR-004). */
  readonly rejectedTypes: readonly string[];
}

// exactOptionalPropertyTypes: only set `rut` when actually overriding.
const sessionOpts = (rut?: string): { rut?: string } => (rut !== undefined ? { rut } : {});

// `extra` is `Partial<AuditEntry>` so the typed optional fields (durationMs, rutAuth)
// stay typed and arbitrary keys (periodo, side, …) ride the entry's index signature —
// no cast needed.
function audit(runtime: Runtime, action: string, result: string, extra: Partial<AuditEntry>): void {
  recordAudit(runtime, { action, result, ...extra });
}

export async function rcvSummary(runtime: Runtime, args: RcvResumenArgs): Promise<RcvResumen> {
  const periodo = Periodo.parse(args.periodo); // fail fast on a bad period — no session opened
  const start = runtime.clock.now().getTime();
  try {
    const { res, sessionRut } = await withSession(
      runtime,
      async (session, ctx) => ({
        res: await fetchRcvResumen(session, {
          rut: Rut.parse(ctx.operatingRut),
          periodo,
          side: args.side,
        }),
        sessionRut: ctx.sessionRut,
      }),
      sessionOpts(args.rut),
    );
    audit(runtime, 'rcv_resumen', 'ok', {
      rut: res.rut,
      periodo: periodo.canonical,
      side: args.side,
      durationMs: runtime.clock.now().getTime() - start,
      ...(res.rut !== sessionRut ? { rutAuth: sessionRut } : {}),
    });
    return res;
  } catch (e) {
    audit(runtime, 'rcv_resumen', 'failed', { periodo: periodo.canonical, side: args.side });
    throw e;
  }
}

export async function rcvList(runtime: Runtime, args: RcvDetalleArgs): Promise<RcvDetalle> {
  const periodo = Periodo.parse(args.periodo);
  const start = runtime.clock.now().getTime();
  try {
    const { res, sessionRut } = await withSession(
      runtime,
      async (session, ctx) => ({
        res: await fetchRcvDetalle(session, {
          rut: Rut.parse(ctx.operatingRut),
          periodo,
          side: args.side,
          codigoTipoDoc: args.codigoTipoDoc,
        }),
        sessionRut: ctx.sessionRut,
      }),
      sessionOpts(args.rut),
    );
    audit(runtime, 'rcv_detalle', 'ok', {
      rut: res.rut,
      periodo: periodo.canonical,
      side: args.side,
      codigoTipoDoc: args.codigoTipoDoc,
      durationMs: runtime.clock.now().getTime() - start,
      ...(res.rut !== sessionRut ? { rutAuth: sessionRut } : {}),
    });
    return res;
  } catch (e) {
    audit(runtime, 'rcv_detalle', 'failed', {
      periodo: periodo.canonical,
      side: args.side,
      codigoTipoDoc: args.codigoTipoDoc,
    });
    throw e;
  }
}

/** "Todos los documentos" of one (RUT, period, side): a SINGLE-session fan-out of
 *  `fetchRcvDetalle` over every DTE type the resumen reports, flattened. A consumer gets
 *  one flat table without opening N browser sessions (the whole motivation — ADR-003:
 *  the fan-out belongs in the library, not the caller). Body-RUT (ADR-005): `--rut`/operate
 *  selects a represented empresa. Paced between POSTs (ADR-004). The period is validated
 *  locally BEFORE any session.
 *
 *  PER-TYPE RESILIENCE (mirrors `f22Historial`): SII can reject ONE DTE type's detalle
 *  (an `RcvError`) while others succeed. Since the fan-out spans every type the resumen
 *  reports, one type's failure MUST NOT bury the rest — the type code is captured in
 *  `rejectedTypes` (ADR-004: surfaced, never hidden, never retried) and `incomplete` flips
 *  true, while the successful types' docs still return. A session-level failure
 *  (`NotAuthenticated`/`SessionExpired`) is NOT an `RcvError`, so it propagates and aborts
 *  the whole read. */
export async function rcvListAll(runtime: Runtime, args: RcvResumenArgs): Promise<RcvDetalleAll> {
  const periodo = Periodo.parse(args.periodo); // fail fast on a bad period — no session opened
  const start = runtime.clock.now().getTime();
  try {
    const { res, sessionRut } = await withSession(
      runtime,
      async (session, ctx) => {
        const rut = Rut.parse(ctx.operatingRut); // body-RUT: operate/--rut selects it
        const resumen = await fetchRcvResumen(session, { rut, periodo, side: args.side });
        // The DTE types present this period. Skip rows with no type code, and dedupe
        // defensively in case the resumen ever repeats one.
        const tipos = [
          ...new Set(
            resumen.rows.map((r) => r.codigoTipoDoc).filter((c): c is string => c !== null),
          ),
        ];
        const docs: RcvDetalleAllDoc[] = [];
        const rejectedTypes: string[] = [];
        for (const codigoTipoDoc of tipos) {
          await runtime.clock.sleep(pacingMs()); // pace each detalle POST after the resumen (ADR-004)
          try {
            const detalle = await fetchRcvDetalle(session, {
              rut,
              periodo,
              side: args.side,
              codigoTipoDoc,
            });
            for (const doc of detalle.docs) docs.push({ ...doc, codigoTipoDoc });
          } catch (e) {
            // One type's RcvError is recorded and skipped — it must not bury the other
            // types' docs. A session-level failure is NOT an RcvError and propagates.
            if (e instanceof RcvError) {
              rejectedTypes.push(codigoTipoDoc);
              continue;
            }
            throw e;
          }
        }
        return {
          res: {
            rut: rut.canonical,
            periodo: periodo.formatted,
            side: args.side,
            docs,
            incomplete: rejectedTypes.length > 0,
            rejectedTypes,
          } satisfies RcvDetalleAll,
          sessionRut: ctx.sessionRut,
        };
      },
      sessionOpts(args.rut),
    );
    audit(runtime, 'rcv_detalle_all', 'ok', {
      rut: res.rut,
      periodo: periodo.canonical,
      side: args.side,
      count: res.docs.length,
      incomplete: res.incomplete,
      durationMs: runtime.clock.now().getTime() - start,
      ...(res.rut !== sessionRut ? { rutAuth: sessionRut } : {}),
    });
    return res;
  } catch (e) {
    audit(runtime, 'rcv_detalle_all', 'failed', { periodo: periodo.canonical, side: args.side });
    throw e;
  }
}
