// Public Carpeta Tributaria tasks the surfaces call (ADR-003). Wraps the `cte-api` facade in
// `withSession` and writes ONE audit receipt per call.
//
// Carpeta is SESSION-KEYED (ADR-005): the app serves the principal's own Carpeta, so the tasks
// read `ctx.sessionRut`, take NO `--rut`, and reject a representing operate pointer up front
// (same posture as F29). The www2 `cte-api` also needs the www2 APP SESSION (ADR-026): the
// facade reads it first (`portal/www2-session.ts`) and raises `Www2SessionError` (a
// NotAuthenticated) when it is missing — minting it is `sii auth login --www2`, pending.
//
// #110 ships `carpetaInstituciones` (the live `enfinCodigo` catalog); #109 adds `carpetaRegular`
// (the PDF, ADR-022 descriptor) on top of the same facade.
import { assertOperatingSelf, withSession } from '../auth/index.js';
import { recordAudit } from '../audit/index.js';
import { CarpetaError } from '../errors/index.js';
import { listInstituciones } from '../portal/carpeta-tributaria-regular.js';
import type { CarpetaInstitucion } from '../portal/carpeta-tributaria-regular.js';
import type { AuditEntry, Runtime } from '../seams/index.js';

export type { CarpetaInstitucion } from '../portal/carpeta-tributaria-regular.js';

function audit(runtime: Runtime, action: string, result: string, extra: Partial<AuditEntry>): void {
  recordAudit(runtime, { action, result, ...extra });
}

// Session-keyed (ADR-005): the shared guard, with this surface's own error + wording.
const assertSelfOperating = (runtime: Runtime): Promise<void> =>
  assertOperatingSelf(
    runtime,
    (empresa) =>
      new CarpetaError(
        `La Carpeta Tributaria es session-keyed: el SII autoriza por el titular de la sesión, no ` +
          `por el RUT operado (${empresa}). Para la carpeta de esa empresa, inicia sesión como ` +
          'ella (`sii auth logout` y luego `sii auth login`).',
      ),
  );

/** SII's LIVE list of destination institutions for the Carpeta Tributaria Regular — the
 *  `enfinCodigo` catalog `carpeta regular --institucion` is validated against. Never cached, never
 *  hardcoded: the codes drift (#110). Public catalog rows (no taxpayer data); the audit records
 *  the read (rut + count) only. */
export async function carpetaInstituciones(
  runtime: Runtime,
): Promise<readonly CarpetaInstitucion[]> {
  await assertSelfOperating(runtime);
  const start = runtime.clock.now().getTime();
  try {
    const { res, rut } = await withSession(runtime, async (session, ctx) => ({
      // session-keyed: the www2 app session IS the principal (the facade reads its userId);
      // the audit records the classic principal we acted for.
      res: await listInstituciones(session),
      rut: ctx.sessionRut,
    }));
    audit(runtime, 'carpeta_instituciones', 'ok', {
      rut,
      count: res.length,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'carpeta_instituciones', 'failed', {});
    throw e;
  }
}
