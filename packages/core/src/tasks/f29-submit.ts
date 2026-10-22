// `f29 submit` (#161): file the monthly IVA declaration from SII's propuesta, as-is. The first F29
// write surface. Posture: ADR-029 and its amendment (two phases, declare only, the safety rule,
// an ambiguous outcome resolved by reading); write template: ADR-017; session-keyed: ADR-005.
// Wire chain: sii-contract/f29.md § Submit.
//
//   - f29SubmitPreview(periodo): runs the chain through SII's validation and the safety rule. It
//     files nothing, but it WRITES: the handoff leaves a borrador "Guardada" at SII.
//   - f29Submit(periodo, total): re-runs the chain from fresh SII responses (never the preview's
//     borrador), refuses on a total that is not the confirmed one or on any disagreement, then
//     saves (guardarBorradorRfiValidado) and files (inyectarBorradorRfi) once, never retried.
//
// The audit records the RUT, the período, the duration and the folio. Never amounts or códigos.
import { withSession } from '../auth/index.js';
import { recordAudit } from '../audit/index.js';
import { F29Error, F29RechazoError, ValidationError } from '../errors/index.js';
import { Periodo } from '../periodo/index.js';
import { Rut } from '../rut/index.js';
import {
  fetchF29Estado,
  fetchF29Propuesta,
  iniciarFlujoPropuestaF29,
  type DeclaracionEstadoF29,
  type F29Estado,
  type F29Propuesta,
} from '../portal/f29.js';
import {
  abrirFormularioF29,
  guardarBorradorF29,
  inyectarBorradorF29,
  rfiCaller,
  validarBorradorF29,
  verificarBorradorF29,
  type F29BorradorValidado,
  type F29Desacuerdo,
} from '../portal/f29-rfi.js';
import type { Gwt7Node } from '../portal/gwt.js';
import { F29_CODIGOS, glosaF29, type F29Grupo } from '../portal/f29-codigos.js';
import type { AuditEntry, PortalSession, Runtime } from '../seams/index.js';
import { agrupar, assertSelfOperating, type LineaF29 } from './f29.js';

export type { F29Desacuerdo, F29MotivoDesacuerdo } from '../portal/f29-rfi.js';

/** What `f29 submit` would file, as SII validated it. */
export interface F29SubmitPreview {
  readonly rut: string;
  readonly periodo: string; // YYYY-MM
  /** SII's propuesta, labeled and grouped like `f29 formulario`. */
  readonly propuesta: Record<F29Grupo, readonly LineaF29[]>;
  /** The códigos SII's own formulas compute on the filled form (e.g. 77, 537), non-zero. */
  readonly calculados: readonly LineaF29[];
  /** TOTAL A PAGAR (código 91) as SII validated it: the value `--confirm` must repeat. */
  readonly total: number;
  /** Where SII's validated borrador and the propuesta disagree. Any entry blocks the submit. */
  readonly desacuerdos: readonly F29Desacuerdo[];
  /** True when nothing blocks the submit. */
  readonly listoParaPresentar: boolean;
  /** Always true: the preview leaves a borrador "Guardada" at SII (non-filing). */
  readonly borradorGuardado: true;
}

/** A filed declaración. `pagoUrl` stays null until SII's payment link is observed (ADR-029
 *  amendment); when `total` > 0 the user pays at SII themselves. */
export interface F29SubmitResult {
  readonly rut: string;
  readonly periodo: string;
  readonly folio: number | null;
  readonly total: number;
  readonly estado: string | null;
  readonly pagoUrl: string | null;
}

/** The SII steps the submit runs. Production uses `SII_F29_SUBMIT`; tests build the tasks over a
 *  fake one with `f29SubmitTasks`. */
export interface F29SubmitChain {
  estado(session: PortalSession, p: { rut: Rut; periodo: Periodo }): Promise<F29Estado>;
  propuesta(session: PortalSession, p: { rut: Rut; periodo: Periodo }): Promise<F29Propuesta>;
  /** The propuesta handoff, the form app and SII's validation. Writes a borrador "Guardada". */
  validar(
    session: PortalSession,
    p: { rut: Rut; periodo: Periodo; hoy: Date },
  ): Promise<F29BorradorValidado>;
  /** Saves the validated borrador; does not file. */
  guardar(session: PortalSession, borrador: Gwt7Node): Promise<Gwt7Node>;
  /** FILES the declaración. */
  inyectar(session: PortalSession, guardado: Gwt7Node): Promise<void>;
}

export const SII_F29_SUBMIT: F29SubmitChain = {
  estado: fetchF29Estado,
  propuesta: fetchF29Propuesta,
  async validar(session, p) {
    const url = await iniciarFlujoPropuestaF29(session, p);
    await abrirFormularioF29(session, url);
    return validarBorradorF29(rfiCaller(session), p);
  },
  guardar: (session, borrador) => guardarBorradorF29(rfiCaller(session), borrador),
  inyectar: (session, guardado) => inyectarBorradorF29(rfiCaller(session), guardado),
};

function audit(runtime: Runtime, action: string, result: string, extra: Partial<AuditEntry>): void {
  recordAudit(runtime, { action, result, ...extra });
}

/** Observed estados: 1 Vigente (filed), 10 Guardada, 70 Rechazada por pago inconcluso. */
const esVigente = (d: DeclaracionEstadoF29): boolean =>
  d.estadoId === 1 || d.estado?.trim().toLowerCase() === 'vigente';

interface Preparado {
  readonly propuesta: F29Propuesta;
  readonly validado: F29BorradorValidado;
  readonly desacuerdos: F29Desacuerdo[];
}

/** A refusal before anything is saved or filed (Vigente, sin propuesta, a disagreement). Still a
 *  `sii_error`; audited as `refused`. */
class Rehusado extends F29Error {}

/** The part both phases share, from fresh SII responses each time. */
async function preparar(
  chain: F29SubmitChain,
  session: PortalSession,
  rut: Rut,
  periodo: Periodo,
  hoy: Date,
): Promise<Preparado> {
  const estado = await chain.estado(session, { rut, periodo });
  const vigente = estado.declaraciones.find(esVigente);
  if (vigente) {
    throw new Rehusado(
      `El período ${periodo.formatted} ya tiene una declaración vigente` +
        `${vigente.folio ? ` (folio ${vigente.folio})` : ''}. Presentar otra sería una ` +
        'rectificatoria, que `sii f29 submit` no hace.',
    );
  }
  const propuesta = await chain.propuesta(session, { rut, periodo });
  if (!propuesta.tienePropuesta) {
    throw new Rehusado(
      `SII no tiene una propuesta de F29 para ${periodo.formatted}, y \`sii f29 submit\` solo ` +
        'presenta la propuesta de SII. Si el período no tuvo movimiento, igual hay que ' +
        'declararlo: hazlo en SII.',
    );
  }
  const validado = await chain.validar(session, { rut, periodo, hoy });
  const desacuerdos = verificarBorradorF29(propuesta.codigos, validado.campos, validado.declarados);
  return { propuesta, validado, desacuerdos };
}

function calculados(validado: F29BorradorValidado): LineaF29[] {
  const out: LineaF29[] = [];
  for (const c of validado.campos) {
    if (!c.formula || !/^\d+$/.test(c.codigo) || c.valor.trim() === '') continue;
    const valor = Number(c.valor);
    if (!Number.isFinite(valor) || valor === 0) continue;
    const codigo = String(Number(c.codigo));
    out.push({ codigo, glosa: glosaF29(codigo), valor, signo: F29_CODIGOS[codigo]?.signo ?? '' });
  }
  return out.sort((a, b) => Number(a.codigo) - Number(b.codigo));
}

const describirDesacuerdos = (ds: readonly F29Desacuerdo[]): string =>
  ds.map((d) => `${d.codigo} (${d.motivo.replace(/_/g, ' ')})`).join(', ');

async function previewWith(
  chain: F29SubmitChain,
  runtime: Runtime,
  args: { periodo: string },
): Promise<F29SubmitPreview> {
  const periodo = Periodo.parse(args.periodo);
  await assertSelfOperating(runtime);
  const start = runtime.clock.now().getTime();
  let rut: string | undefined;
  try {
    const res = await withSession(runtime, async (session, ctx) => {
      const principal = Rut.parse(ctx.sessionRut);
      rut = principal.canonical;
      const p = await preparar(chain, session, principal, periodo, runtime.clock.now());
      const preview: F29SubmitPreview = {
        rut: principal.canonical,
        periodo: periodo.formatted,
        propuesta: agrupar(p.propuesta.codigos),
        calculados: calculados(p.validado),
        total: p.validado.total,
        desacuerdos: p.desacuerdos,
        listoParaPresentar: p.desacuerdos.length === 0,
        borradorGuardado: true,
      };
      return preview;
    });
    audit(runtime, 'f29_submit_preview', 'ok', {
      rut: res.rut,
      period: periodo.canonical,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'f29_submit_preview', e instanceof Rehusado ? 'refused' : 'failed', {
      ...(rut ? { rut } : {}),
      period: periodo.canonical,
      durationMs: runtime.clock.now().getTime() - start,
    });
    throw e;
  }
}

/** Parse the confirmed total: a non-negative integer, dots allowed as thousands separators. */
function parseTotal(total: number | string): number {
  const n = typeof total === 'number' ? total : Number(String(total).trim().replace(/\./g, ''));
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new ValidationError(
      'El total de confirmación debe ser un entero no negativo: el TOTAL A PAGAR de la vista previa.',
    );
  }
  return n;
}

async function submitWith(
  chain: F29SubmitChain,
  runtime: Runtime,
  args: { periodo: string; total: number | string },
): Promise<F29SubmitResult> {
  const periodo = Periodo.parse(args.periodo);
  const totalEcho = parseTotal(args.total);
  await assertSelfOperating(runtime);
  const start = runtime.clock.now().getTime();
  let rut: string | undefined;
  let result = 'failed';
  let folio: number | null = null;
  try {
    const res = await withSession(runtime, async (session, ctx) => {
      const principal = Rut.parse(ctx.sessionRut);
      rut = principal.canonical;
      const p = await preparar(chain, session, principal, periodo, runtime.clock.now());
      if (p.validado.total !== totalEcho) {
        result = 'refused';
        throw new ValidationError(
          `El TOTAL A PAGAR que SII valida hoy para ${periodo.formatted} es ${p.validado.total}, ` +
            `no ${totalEcho}. Revisa la vista previa (\`sii f29 submit ${periodo.formatted}\`) y ` +
            'confirma con ese total. No se presentó nada.',
        );
      }
      if (p.desacuerdos.length > 0) {
        throw new Rehusado(
          'El borrador que SII validó no coincide con la propuesta en los códigos ' +
            `${describirDesacuerdos(p.desacuerdos)}. No se presentó nada. Que SII diga ` +
            '"no presenta errores" no basta: revisa la propuesta en SII.',
        );
      }

      const guardado = await chain.guardar(session, p.validado.borrador);
      try {
        await chain.inyectar(session, guardado);
      } catch (e) {
        // The filing call was sent: SII's state decides what happened. Never resend it. Only
        // SII's own refusal (//EX) proves nothing was filed; any other failure (a lost answer,
        // a body we cannot decode, a dead session) leaves the outcome unknown.
        const estado = await chain.estado(session, { rut: principal, periodo }).catch(() => null);
        if (!estado?.declaraciones.some(esVigente)) {
          if (e instanceof F29RechazoError) throw e;
          result = 'unconfirmed';
          throw new F29Error(
            `No se pudo confirmar si SII recibió el F29 de ${periodo.formatted}. NO lo vuelvas a ` +
              `enviar: revisa \`sii f29 status ${periodo.formatted}\` (y SII) primero. ` +
              `Detalle: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        // Filed although the answer was lost: report it.
      }

      const estado = await chain.estado(session, { rut: principal, periodo }).catch(() => null);
      const fila = estado?.declaraciones.find(esVigente) ?? estado?.declaraciones.at(-1) ?? null;
      folio = fila?.folio ?? null;
      result = 'ok';
      const filed: F29SubmitResult = {
        rut: principal.canonical,
        periodo: periodo.formatted,
        folio,
        total: p.validado.total,
        estado: fila?.estado ?? null,
        pagoUrl: null,
      };
      return filed;
    });
    audit(runtime, 'f29_submit', 'ok', {
      rut: res.rut,
      period: periodo.canonical,
      durationMs: runtime.clock.now().getTime() - start,
      ...(res.folio !== null ? { folio: res.folio } : {}),
    });
    return res;
  } catch (e) {
    audit(runtime, 'f29_submit', e instanceof Rehusado ? 'refused' : result, {
      ...(rut ? { rut } : {}),
      period: periodo.canonical,
      durationMs: runtime.clock.now().getTime() - start,
      ...(folio !== null ? { folio } : {}),
    });
    throw e;
  }
}

/** The two tasks over a given chain. Tests pass a fake one; the barrel exports only the pair
 *  bound to SII below, so no surface reaches the chain (ADR-003). */
export function f29SubmitTasks(chain: F29SubmitChain): {
  f29SubmitPreview: (runtime: Runtime, args: { periodo: string }) => Promise<F29SubmitPreview>;
  f29Submit: (
    runtime: Runtime,
    args: { periodo: string; total: number | string },
  ) => Promise<F29SubmitResult>;
} {
  return {
    f29SubmitPreview: (runtime, args) => previewWith(chain, runtime, args),
    f29Submit: (runtime, args) => submitWith(chain, runtime, args),
  };
}

/** The preview: SII's propuesta, what SII's formulas compute, SII's validated total and every
 *  disagreement. Files nothing; leaves a borrador "Guardada" at SII. */
export function f29SubmitPreview(
  runtime: Runtime,
  args: { periodo: string },
): Promise<F29SubmitPreview> {
  return previewWith(SII_F29_SUBMIT, runtime, args);
}

/** FILE the declaración. Refuses, without saving or filing, when SII's total today is not
 *  `total`, or when the borrador SII validated disagrees with the propuesta. Then saves and
 *  files once. If the filing call fails, SII's state decides what happened; it is never resent. */
export function f29Submit(
  runtime: Runtime,
  args: { periodo: string; total: number | string },
): Promise<F29SubmitResult> {
  return submitWith(SII_F29_SUBMIT, runtime, args);
}
