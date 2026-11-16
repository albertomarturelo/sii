// Public BTE/BHE task API the surfaces call (ADR-003). Boletas de Honorarios Electrónicas,
// read-only. `bteList(periodo, side)` returns one month's boletas (emitidas or recibidas).
//
// SESSION-KEYED (ADR-005, confirmed live #62): the BHE CGIs authorize by the session PRINCIPAL
// (`rut_arrastre` does NOT reach a represented empresa), so this reads ONLY self and REJECTS a
// representing operate pointer UP FRONT with an actionable "log in as the empresa" message —
// it ignores the pointer and takes NO `--rut`. The período is validated locally BEFORE any
// session. Pagination is paced via `Clock.sleep` (ADR-004); the facade parses the inline JS maps
// from the report's HTML (`requestText`, not the SDI-JSON path), so no browser runs (#222).
import { withSession } from '../auth/index.js';
import { recordAudit } from '../audit/index.js';
import { readOperateState } from '../identity/index.js';
import { Periodo } from '../periodo/index.js';
import { Rut } from '../rut/index.js';
import { AbortedError, BteError, ValidationError } from '../errors/index.js';
import { checkAborted } from '../errors/abort.js';
import { DEFAULT_SETTINGS } from '../config/index.js';
import { COD_BARRAS, fetchBteMensual, fetchBtePdf } from '../portal/bte.js';
import type { BteBoleta, BteMensual, BteSide } from '../portal/bte.js';
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
 *  An empty month is a clean 0-boleta result, not an error. `signal` lets an embedder with a
 *  deadline stop the page walk between SII calls (ADR-031): a cut throws `AbortedError`, and an
 *  already-aborted signal throws before any session is opened. */
export async function bteList(
  runtime: Runtime,
  args: { periodo: string; side: BteSide; signal?: AbortSignal | undefined },
): Promise<BteMensual> {
  const periodo = Periodo.parse(args.periodo); // fail fast on a bad período — no session opened
  await assertSelfOperating(runtime);
  const start = runtime.clock.now().getTime();
  let paginas = 0;
  try {
    checkAborted(args.signal); // before the session: an expired deadline costs SII nothing
    // The report's maps (xml_values / arr_informe_mensual) are literals in its HTML, so the
    // HTTP engine reads them, like bte emit's form-POSTs (ADR-027, amended #222).
    const res = await withSession(runtime, async (session, ctx) =>
      fetchBteMensual(
        session,
        { rut: Rut.parse(ctx.sessionRut), periodo, side: args.side }, // session-keyed: the principal
        () => runtime.clock.sleep(pacingMs()),
        { signal: args.signal, onPagina: () => paginas++ },
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
    // A cut is not a failure: the receipt says how far the walk got, never what it read.
    const result = e instanceof AbortedError ? 'aborted' : 'failed';
    audit(runtime, 'bte_list', result, {
      period: periodo.canonical,
      side: args.side,
      ...(result === 'aborted' ? { paginas } : {}),
    });
    throw e;
  }
}

// --- bte pdf (#282) ---------------------------------------------------------------

/** A downloaded boleta — a DESCRIPTOR, never the bytes (ADR-022 / ADR-006). */
export interface BtePdfDoc {
  readonly path: string;
  readonly archivo: string;
  readonly bytes: number;
  readonly contentType: 'application/pdf';
  /** Session principal (canonical): the emisor on EMITIDAS, the receptor on RECIBIDAS. */
  readonly rut: string;
  readonly side: BteSide;
  readonly codBarras: string;
  /** The listing row, when the boleta was addressed by período + folio; null by código. */
  readonly boleta: BteBoleta | null;
}

export interface BtePdfArgs {
  readonly side: BteSide;
  /** SII's código de barras (`BteBoleta.codBarras`): one GET, no listing. */
  readonly codBarras?: string;
  /** Or the período + folio, resolved through that month's listing. */
  readonly periodo?: string;
  readonly folio?: number;
  /** RECIBIDAS only: the emisor's RUT, needed when two emisores share the folio. */
  readonly emisor?: string;
  /** REQUIRED: the pure core cannot know `$HOME`; each surface applies its default (ADR-022). */
  readonly directorio: string;
}

type PdfTarget =
  | { kind: 'codigo'; codBarras: string }
  | { kind: 'folio'; periodo: Periodo; folio: number; emisor: Rut | null };

/** Validate the address locally, before any session: exactly one of código or período + folio. */
function pdfTarget(args: BtePdfArgs): PdfTarget {
  const porFolio = args.periodo !== undefined || args.folio !== undefined;
  if (args.codBarras !== undefined) {
    if (porFolio || args.emisor !== undefined) {
      throw new ValidationError('Indica el código de barras O el período y el folio, no ambos.');
    }
    const codBarras = args.codBarras.trim();
    if (!COD_BARRAS.test(codBarras)) {
      throw new ValidationError(
        'Código de barras inválido: el SII usa 20 letras o dígitos (columna codBarras de `bte list`).',
      );
    }
    return { kind: 'codigo', codBarras };
  }
  if (args.periodo === undefined || args.folio === undefined) {
    throw new ValidationError('Indica el período y el folio de la boleta (o su código de barras).');
  }
  if (!Number.isInteger(args.folio) || args.folio <= 0) {
    throw new ValidationError(`Folio inválido: "${args.folio}" (entero positivo).`);
  }
  if (args.emisor !== undefined && args.side !== 'RECIBIDAS') {
    throw new ValidationError(
      'El emisor sólo distingue boletas RECIBIDAS (las emitidas son tuyas).',
    );
  }
  return {
    kind: 'folio',
    periodo: Periodo.parse(args.periodo),
    folio: args.folio,
    emisor: args.emisor === undefined ? null : Rut.parse(args.emisor),
  };
}

/** The listing row a período + folio names. A folio is unique per emisor, so on RECIBIDAS two
 *  emisores can share one: then the emisor must be given, and nothing is guessed. */
function pickBoleta(mes: BteMensual, folio: number, emisor: Rut | null): BteBoleta {
  const hits = mes.boletas.filter(
    (b) => b.folio === folio && (emisor === null || b.contraparteRut === emisor.canonical),
  );
  const donde = `${mes.side.toLowerCase()} de ${mes.periodo}`;
  if (hits.length === 0) {
    throw new BteError(
      `No hay una boleta con folio ${folio}${emisor ? ` de ${emisor.formatted}` : ''} en las ${donde}. ` +
        'Revisa `bte list`.',
    );
  }
  if (hits.length > 1) {
    throw new BteError(
      `Hay ${hits.length} boletas con folio ${folio} en las ${donde}, de distintos emisores. ` +
        'Indica el RUT del emisor.',
    );
  }
  const boleta = hits[0]!;
  if (boleta.codBarras === null) {
    throw new BteError(`La boleta folio ${folio} no trae código de barras en el listado del SII.`);
  }
  return boleta;
}

/** Download one boleta de honorarios as a PDF, emitida or recibida, for the session principal
 *  (session-keyed, ADR-005). Addressed by its código de barras (one GET) or by período + folio
 *  (the month's listing first, then the PDF, paced). Returns a descriptor written through
 *  `runtime.files`, never the bytes: the document carries both parties' identity and the montos
 *  (ADR-006 / ADR-022). An anulada is served too (observed 2026-11-15). The receipt records the
 *  RUT, side, folio and byte count only: never the counterparty, montos or glosa. */
export async function btePdf(runtime: Runtime, args: BtePdfArgs): Promise<BtePdfDoc> {
  const target = pdfTarget(args); // fail fast — no session on bad input
  const files = runtime.files;
  if (!files) {
    throw new BteError(
      'Este runtime no tiene un FileSink configurado, así que no puede escribir el PDF. ' +
        'Usa `createNodeRuntime()` o inyecta `files`.',
    );
  }
  await assertSelfOperating(runtime);
  const start = runtime.clock.now().getTime();
  const folioPedido = target.kind === 'folio' ? target.folio : null;
  try {
    const res = await withSession(runtime, async (session, ctx) => {
      const rut = Rut.parse(ctx.sessionRut); // session-keyed: the principal
      let boleta: BteBoleta | null = null;
      let codBarras: string;
      if (target.kind === 'folio') {
        const mes = await fetchBteMensual(
          session,
          { rut, periodo: target.periodo, side: args.side },
          () => runtime.clock.sleep(pacingMs()),
        );
        boleta = pickBoleta(mes, target.folio, target.emisor);
        codBarras = boleta.codBarras!; // pickBoleta refuses a row without one
        await runtime.clock.sleep(pacingMs()); // listing → PDF: two SII calls (ADR-004)
      } else {
        codBarras = target.codBarras;
      }
      const bytes = await fetchBtePdf(session, { side: args.side, codBarras });
      // SII names no file; the código is unique and stable, so a re-download refreshes in place.
      const archivo = `bte-${args.side === 'EMITIDAS' ? 'emitida' : 'recibida'}-${codBarras}.pdf`;
      const path = await files.write(args.directorio, archivo, bytes);
      return {
        path,
        archivo,
        bytes: bytes.length,
        contentType: 'application/pdf' as const,
        rut: rut.canonical,
        side: args.side,
        codBarras,
        boleta,
      };
    });
    audit(runtime, 'bte_pdf', 'ok', {
      rut: res.rut,
      side: args.side,
      folio: res.boleta?.folio ?? null,
      bytes: res.bytes,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'bte_pdf', 'failed', { side: args.side, folio: folioPedido });
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
