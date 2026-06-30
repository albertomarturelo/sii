// Public DTE task API the surfaces call (ADR-003). Unlike rcv/f22/f29, `dteAuthorized`
// is PUBLIC and login-free: it does NOT use `withSession` and works for ANY RUT
// (counterparties included) without a session — the consulta touches no account, an
// in-bounds class of access (ADR-004 ToS carve-out / ADR-014). The RUT is Mod-11-validated
// locally BEFORE any request so a malformed RUT never becomes a wasted call.
import { recordAudit } from '../audit/index.js';
import { Rut } from '../rut/index.js';
import { fetchDteAutorizados } from '../portal/dte-public.js';
import type { DteAutorizados } from '../portal/dte-public.js';
import type { Runtime } from '../seams/index.js';

export type { DteAutorizados, DteAutorizado } from '../portal/dte-public.js';

interface DteAuthorizedArgs {
  /** RUT to query (e.g. "12345670-K") — any RUT; public consulta. Mod-11-validated. */
  readonly rut: string;
}

export async function dteAuthorized(
  runtime: Runtime,
  args: DteAuthorizedArgs,
): Promise<DteAutorizados> {
  const rut = Rut.parse(args.rut); // fail fast on a bad RUT — no request issued
  const start = runtime.clock.now().getTime();
  try {
    const res = await fetchDteAutorizados(runtime.portal, rut);
    // Both authorized and not-authorized are valid outcomes → result "ok". Audit records
    // rut=<subject> with NO rutAuth: there is no authenticated principal (ADR-014).
    recordAudit(runtime, {
      action: 'dte_autorizados',
      result: 'ok',
      rut: res.rut,
      autorizado: res.autorizado,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    recordAudit(runtime, { action: 'dte_autorizados', result: 'failed', rut: rut.canonical });
    throw e;
  }
}
