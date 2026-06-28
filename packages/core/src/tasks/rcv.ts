// Public RCV task API the surfaces call (ADR-003). Each wraps the portal facade in
// `withSession` — consume a live session, resolve the body RUT (override > pointer >
// self, ADR-005) — and writes ONE audit receipt. RCV is BODY-RUT: `--rut`/operate
// selects a represented empresa. The period is validated locally BEFORE any session.
import { withSession } from '../auth/index.js';
import { recordAudit } from '../audit/index.js';
import { Periodo } from '../periodo/index.js';
import { Rut } from '../rut/index.js';
import { fetchRcvDetalle, fetchRcvResumen } from '../portal/rcv.js';
import type { RcvDetalle, RcvResumen, RcvSide } from '../portal/rcv.js';
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
