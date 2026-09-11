// Public Carpeta Tributaria tasks the surfaces call (ADR-003). Wraps the `cte-api` facade in
// `withSession` and writes ONE audit receipt per call.
//
// Carpeta is SESSION-KEYED (ADR-005): the app serves the principal's own Carpeta, so the tasks
// read `ctx.sessionRut`, take NO `--rut`, and reject a representing operate pointer up front
// (same posture as F29). NOTE (observed 2026-09-11): the www2 `cte-api` is authorized by a www2
// APP SESSION (OAuth) that the cookies-only login does not mint — the facade detects that and
// fails actionably; minting it is an auth decision pending an ADR (see the contract doc).
//
// #110 ships `carpetaInstituciones` (the live `enfinCodigo` catalog); #109 adds `carpetaRegular`
// (the PDF, ADR-022 descriptor) on top of the same facade.
import { withSession } from '../auth/index.js';
import { recordAudit } from '../audit/index.js';
import { readOperateState } from '../identity/index.js';
import { CarpetaError } from '../errors/index.js';
import { Rut } from '../rut/index.js';
import { listInstituciones } from '../portal/carpeta-tributaria-regular.js';
import type { CarpetaInstitucion } from '../portal/carpeta-tributaria-regular.js';
import type { AuditEntry, Runtime } from '../seams/index.js';

export type { CarpetaInstitucion } from '../portal/carpeta-tributaria-regular.js';

function audit(runtime: Runtime, action: string, result: string, extra: Partial<AuditEntry>): void {
  recordAudit(runtime, { action, result, ...extra });
}

/** Reject a representing operate pointer BEFORE opening a session (ADR-005, session-keyed). The
 *  empresa RUT is already user-visible (`operate --list`), so it is safe to echo; the razón social
 *  is PII and is NOT included. No operate state → defer to `withSession` (raises NotAuthenticated). */
async function assertSelfOperating(runtime: Runtime): Promise<void> {
  const op = await readOperateState(runtime.store);
  if (op && op.operatingRut !== op.selfRut) {
    throw new CarpetaError(
      `La Carpeta Tributaria es session-keyed: el SII autoriza por el titular de la sesión, no ` +
        `por el RUT operado (${Rut.parse(op.operatingRut).formatted}). Para la carpeta de esa ` +
        'empresa, inicia sesión como ella (`sii auth logout` y luego `sii auth login`).',
    );
  }
}

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
