// Public bienes-raíces task the surfaces call (ADR-003 / ADR-032). Wraps the Mi SII facade in
// `withSession` and writes ONE audit receipt. SESSION-KEYED (ADR-005): Mi SII answers for the
// principal, so the task takes no `--rut` and refuses a representing pointer up front.
// The audit records the read only (rut + counts), never a rol, an address or an amount (ADR-006).
import { assertOperatingSelf, withSession } from '../auth/index.js';
import { recordAudit } from '../audit/index.js';
import { BienesRaicesError } from '../errors/index.js';
import { fetchPredios, type Predio } from '../portal/bienes-raices-misii.js';
import type { Runtime } from '../seams/index.js';

export type { CuotaContribucion, Predio } from '../portal/bienes-raices-misii.js';

export interface BienesRaicesResult {
  readonly rut: string;
  readonly predios: readonly Predio[];
  /** Totals over every predio, as Mi SII's table counts them. */
  readonly cuotasVencidas: number;
  readonly cuotasVigentes: number;
}

/** The predios whose contribuciones the session's RUT pays, with their unpaid cuotas. */
export async function bienesRaicesList(runtime: Runtime): Promise<BienesRaicesResult> {
  await assertOperatingSelf(
    runtime,
    (empresa) =>
      new BienesRaicesError(
        `Bienes raíces es session-keyed: Mi SII responde por el titular de la sesión, no por el ` +
          `RUT operado (${empresa}). Para los de esa empresa, inicia sesión como ella ` +
          '(`sii auth logout` y luego `sii auth login`).',
      ),
  );
  const start = runtime.clock.now().getTime();
  try {
    const result = await withSession(runtime, async (session, ctx) => {
      const predios = await fetchPredios(session);
      return {
        rut: ctx.sessionRut,
        predios,
        cuotasVencidas: predios.reduce((n, p) => n + p.cuotasVencidas, 0),
        cuotasVigentes: predios.reduce((n, p) => n + p.cuotasVigentes, 0),
      };
    });
    recordAudit(runtime, {
      action: 'bienes_raices_list',
      result: 'ok',
      rut: result.rut,
      count: result.predios.length,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return result;
  } catch (e) {
    recordAudit(runtime, { action: 'bienes_raices_list', result: 'failed' });
    throw e;
  }
}
