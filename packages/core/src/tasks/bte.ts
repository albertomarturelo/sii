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
import { BteError } from '../errors/index.js';
import { DEFAULT_SETTINGS } from '../config/index.js';
import { fetchBteMensual } from '../portal/bte.js';
import type { BteMensual, BteSide } from '../portal/bte.js';
import type { AuditEntry, Runtime } from '../seams/index.js';

export type { BteBoleta, BteMensual, BteSide, BteTotales } from '../portal/bte.js';

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
