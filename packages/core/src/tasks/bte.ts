// Public BTE/BHE task API the surfaces call (ADR-003). Boletas de Honorarios Electrónicas,
// read-only. `bteList(periodo, side)` returns one month's boletas (emitidas or recibidas).
//
// SESSION-KEYED (ADR-005, confirmed live #62): the BHE CGIs authorize by the session PRINCIPAL
// (`rut_arrastre` does NOT reach a represented empresa), so this reads ONLY self and REJECTS a
// representing operate pointer UP FRONT with an actionable "log in as the empresa" message —
// it ignores the pointer and takes NO `--rut`. The período is validated locally BEFORE any
// session. Pagination is paced via `Clock.sleep` (ADR-004); the facade reads inline JS maps via
// `PortalSession.goto`/`evaluate` (not the SDI-JSON path).
import { withSession } from '../auth/index.js';
import { recordAudit } from '../audit/index.js';
import { readOperateState } from '../identity/index.js';
import { Periodo } from '../periodo/index.js';
import { Rut } from '../rut/index.js';
import { BteError, ValidationError } from '../errors/index.js';
import { DEFAULT_SETTINGS } from '../config/index.js';
import { fetchBteMensual } from '../portal/bte.js';
import type { BteMensual, BteSide } from '../portal/bte.js';
import {
  assertRegionComuna,
  emitBteEmision,
  enviarBteEmision,
  previewBteEmision,
} from '../portal/bte-emit.js';
import type {
  BteEmisionInput,
  BteEmitida,
  BteLineaEmision,
  BtePreview,
  BteRetiene,
} from '../portal/bte-emit.js';
import type { AuditEntry, Runtime } from '../seams/index.js';

export type { BteBoleta, BteMensual, BteSide, BteTotales } from '../portal/bte.js';
export type { BteEmitida, BtePreview, BteRetiene, BteLineaEmision } from '../portal/bte-emit.js';

/** Inter-page pace (ms) for the monthly pagination fan-out — never hammer SII (ADR-004). */
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
    throw new BteError(
      `Las boletas de honorarios son session-keyed: el SII autoriza por el titular de la sesión, ` +
        `no por el RUT operado (${Rut.parse(op.operatingRut).formatted}). Para las BHE de esa empresa, ` +
        'inicia sesión como ella (`sii auth logout` y luego `sii auth login`).',
    );
  }
}

/** One month's boletas de honorarios for the session principal (ADR-005), emitidas or recibidas.
 *  An empty month is a clean 0-boleta result, not an error. */
export async function bteList(
  runtime: Runtime,
  args: { periodo: string; side: BteSide },
): Promise<BteMensual> {
  const periodo = Periodo.parse(args.periodo); // fail fast on a bad período — no session opened
  await assertSelfOperating(runtime);
  const start = runtime.clock.now().getTime();
  try {
    const res = await withSession(runtime, async (session, ctx) =>
      fetchBteMensual(
        session,
        { rut: Rut.parse(ctx.sessionRut), periodo, side: args.side }, // session-keyed: the principal
        () => runtime.clock.sleep(pacingMs()),
      ),
    );
    audit(runtime, 'bte_list', 'ok', {
      rut: res.rut,
      period: periodo.canonical,
      side: args.side,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'bte_list', 'failed', { period: periodo.canonical, side: args.side });
    throw e;
  }
}

// --- bte emit (write surface, ADR-017) -------------------------------------------

/** The args a surface passes to emit/preview. Strings/numbers from the CLI/MCP; validated
 *  locally here BEFORE any session. The emisor fields (domicilio/comuna/actividad) are read
 *  from the live form — the caller supplies only the receptor + líneas + fecha + who-withholds. */
export interface BteEmitArgs {
  readonly receptor: string; // RUT (validated Mod-11 locally)
  readonly receptorNombre: string;
  readonly receptorDomicilio: string;
  readonly region: number; // SII region 1–16
  readonly comuna: number; // SII comuna code
  readonly lineas: readonly { readonly glosa: string; readonly monto: number }[]; // 1..4
  /** Boleta date; defaults to today. Must be within ±3 months (SII rule). */
  readonly fecha?: { readonly dia: number; readonly mes: number; readonly anio: number };
  readonly retiene: BteRetiene;
  readonly mostrarDetalle?: boolean;
  /** Optional: also email the issued PDF to this address (emit only). */
  readonly enviarA?: string;
  /** Copy the emisor on the email (default true). */
  readonly copiaEmisor?: boolean;
}

/** Result of an emission: the issued boleta + whether the optional email was sent. */
export interface BteEmitResult extends BteEmitida {
  readonly enviado?: boolean;
}

const MAX_LINEAS = 4;

/** Validate + normalize the emit args into a `BteEmisionInput` (parsed RUT, checked montos,
 *  region/comuna, fecha within ±3 months). Throws before any SII call. */
function validateEmit(runtime: Runtime, args: BteEmitArgs): BteEmisionInput {
  const receptor = Rut.parse(args.receptor); // Mod-11 — a malformed RUT never reaches SII
  if (args.receptorNombre.trim() === '') throw new ValidationError('Falta el nombre del receptor.');
  if (args.receptorDomicilio.trim() === '')
    throw new ValidationError('Falta el domicilio del receptor.');
  if (args.lineas.length < 1 || args.lineas.length > MAX_LINEAS) {
    throw new ValidationError(`Indica entre 1 y ${MAX_LINEAS} líneas de honorarios.`);
  }
  const lineas: BteLineaEmision[] = args.lineas.map((l, i) => {
    if (l.glosa.trim() === '') throw new ValidationError(`Falta la glosa de la línea ${i + 1}.`);
    if (!Number.isInteger(l.monto) || l.monto <= 0) {
      throw new ValidationError(
        `Monto inválido en la línea ${i + 1}: ${l.monto} (entero positivo, en pesos).`,
      );
    }
    return { glosa: l.glosa.trim(), monto: l.monto };
  });
  assertRegionComuna(args.region, args.comuna);
  const fecha = resolveFecha(runtime, args.fecha);
  return {
    receptor,
    receptorNombre: args.receptorNombre.trim(),
    receptorDomicilio: args.receptorDomicilio.trim(),
    region: args.region,
    comuna: args.comuna,
    lineas,
    fecha,
    retiene: args.retiene,
    ...(args.mostrarDetalle !== undefined ? { mostrarDetalle: args.mostrarDetalle } : {}),
  };
}

/** Default the boleta date to today; enforce the SII ±3-month window (via the Clock seam). */
function resolveFecha(
  runtime: Runtime,
  fecha?: { dia: number; mes: number; anio: number },
): { dia: number; mes: number; anio: number } {
  const now = runtime.clock.now();
  const f = fecha ?? { dia: now.getDate(), mes: now.getMonth() + 1, anio: now.getFullYear() };
  const target = new Date(f.anio, f.mes - 1, f.dia);
  if (
    Number.isNaN(target.getTime()) ||
    target.getMonth() !== f.mes - 1 ||
    target.getDate() !== f.dia
  ) {
    throw new ValidationError(`Fecha de boleta inválida: ${f.anio}-${f.mes}-${f.dia}.`);
  }
  const min = new Date(now.getTime());
  min.setMonth(min.getMonth() - 3);
  const max = new Date(now.getTime());
  max.setMonth(max.getMonth() + 3);
  if (target < min || target > max) {
    throw new ValidationError(
      'La fecha de la boleta debe estar dentro de ±3 meses respecto de hoy (regla del SII).',
    );
  }
  return f;
}

/** PREVIEW an emission (ADR-017): run the SII flow to the confirmation step and return the
 *  server-computed retención/líquido WITHOUT issuing. Session-keyed (rejects a representing
 *  pointer). Never issues; safe to call freely. */
export async function bteEmitPreview(runtime: Runtime, args: BteEmitArgs): Promise<BtePreview> {
  const input = validateEmit(runtime, args); // fail fast — no session on bad input
  await assertSelfOperating(runtime);
  const start = runtime.clock.now().getTime();
  let emisorRut: string | undefined;
  try {
    const preview = await withSession(runtime, async (session, ctx) => {
      emisorRut = Rut.parse(ctx.sessionRut).canonical; // the emisor = self (safe to audit)
      return previewBteEmision(session, Rut.parse(ctx.sessionRut), input);
    });
    // Receipt carries only the emisor RUT (self) — never the receptor / monto / glosa.
    audit(runtime, 'bte_emit_preview', 'ok', {
      ...(emisorRut ? { rut: emisorRut } : {}),
      durationMs: runtime.clock.now().getTime() - start,
    });
    return preview;
  } catch (e) {
    audit(runtime, 'bte_emit_preview', 'failed', {});
    throw e;
  }
}

/** ISSUE a boleta de honorarios (ADR-017) — a legally-binding act. Runs the full SII flow and
 *  returns the folio (código de barras) + PDF URL. Session-keyed. NEVER retries. The caller
 *  (CLI `--confirm`, MCP `confirmar`) is responsible for the explicit confirmation; this task
 *  assumes the confirmation was given. Optional email send. The audit receipt carries the folio
 *  but NEVER the receptor / monto / glosa (PII / business data). */
export async function bteEmit(runtime: Runtime, args: BteEmitArgs): Promise<BteEmitResult> {
  const input = validateEmit(runtime, args);
  await assertSelfOperating(runtime);
  const start = runtime.clock.now().getTime();
  try {
    const result = await withSession(runtime, async (session, ctx): Promise<BteEmitResult> => {
      const self = Rut.parse(ctx.sessionRut);
      const emitida = await emitBteEmision(session, self, input);
      if (args.enviarA !== undefined && args.enviarA.trim() !== '') {
        const { enviado } = await enviarBteEmision(session, {
          codBarras: emitida.codBarras,
          email: args.enviarA.trim(),
          ...(args.copiaEmisor !== undefined ? { copiaEmisor: args.copiaEmisor } : {}),
        });
        return { ...emitida, enviado };
      }
      return emitida;
    });
    audit(runtime, 'bte_emit', 'ok', {
      folio: result.codBarras, // the emisor's own boleta id (no counterparty PII)
      durationMs: runtime.clock.now().getTime() - start,
    });
    return result;
  } catch (e) {
    audit(runtime, 'bte_emit', 'failed', {});
    throw e;
  }
}
