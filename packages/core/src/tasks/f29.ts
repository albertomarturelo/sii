// Public F29 task API the surfaces call (ADR-003). Wraps the portal facade in `withSession`
// and writes one audit receipt. F29 is SESSION-KEYED (ADR-005): it authorizes by the session
// principal — so each task reads ONLY self and REJECTS a representing operate pointer UP FRONT
// (before any session is opened), with an actionable "log in as the empresa" message. This
// differs from F22, which silently ignores the pointer and reads self; F29 rejects instead, so
// a user who set `operate <empresa>` is told the empresa's F29 needs the empresa's own session
// (logout→login) rather than silently getting their own F29 (the confusing wart). SII confirms
// the contract: the body RUT of a represented empresa returns `Consulta RUT no esta autorizado`
// (Python live 2026-06-26) — we reject locally to avoid a doomed POST. The período is validated
// locally BEFORE any session. Each task makes a SINGLE POST, so no inter-call pacing is needed.
import { withSession } from '../auth/index.js';
import { recordAudit } from '../audit/index.js';
import { readOperateState } from '../identity/index.js';
import { Periodo } from '../periodo/index.js';
import { Rut } from '../rut/index.js';
import { F29Error } from '../errors/index.js';
import { fetchF29Estado, fetchF29Propuesta } from '../portal/f29.js';
import type { F29Estado, F29Propuesta } from '../portal/f29.js';
import type { AuditEntry, Runtime } from '../seams/index.js';

export type { CodigoF29, DeclaracionEstadoF29, F29Estado, F29Propuesta } from '../portal/f29.js';

function audit(runtime: Runtime, action: string, result: string, extra: Partial<AuditEntry>): void {
  recordAudit(runtime, { action, result, ...extra });
}

/** Reject a representing operate pointer BEFORE opening a session (ADR-005). F29 authorizes by
 *  the session principal, so operating as a represented empresa cannot reach its F29 — surface
 *  the actionable path instead of silently reading self or firing a doomed POST. The empresa RUT
 *  is already user-visible (`operate --list`), so it is safe to echo; the razón social is PII and
 *  is NOT included. No operate state (e.g. no session) → defer to `withSession` (which raises the
 *  proper NotAuthenticated). */
async function assertSelfOperating(runtime: Runtime): Promise<void> {
  const op = await readOperateState(runtime.store);
  if (op && op.operatingRut !== op.selfRut) {
    throw new F29Error(
      `El F29 es session-keyed: el SII autoriza por el titular de la sesión, no por el RUT ` +
        `operado (${Rut.parse(op.operatingRut).formatted}). Para la F29 de esa empresa, inicia ` +
        'sesión como ella (`sii auth logout` y luego `sii auth login`).',
    );
  }
}

/** IVA propuesta (SII's pre-filled F29 draft) for one período. Session principal (ADR-005);
 *  rejects a representing pointer up front. Curated tax códigos, no `raw`, no PII. */
export async function f29Draft(runtime: Runtime, args: { periodo: string }): Promise<F29Propuesta> {
  const periodo = Periodo.parse(args.periodo); // fail fast on a bad período — no session opened
  await assertSelfOperating(runtime); // reject representación before any session (no doomed POST)
  const start = runtime.clock.now().getTime();
  try {
    const res = await withSession(runtime, async (session, ctx) =>
      fetchF29Propuesta(session, { rut: Rut.parse(ctx.sessionRut), periodo }),
    );
    audit(runtime, 'f29_propuesta', 'ok', {
      rut: res.rut,
      period: periodo.canonical,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'f29_propuesta', 'failed', { period: periodo.canonical });
    throw e;
  }
}

/** Presented/saved F29 records (estado) for one período. Session principal (ADR-005); rejects a
 *  representing pointer up front. Empty is a clean "nada presentado", not an error. */
export async function f29Status(runtime: Runtime, args: { periodo: string }): Promise<F29Estado> {
  const periodo = Periodo.parse(args.periodo); // fail fast on a bad período — no session opened
  await assertSelfOperating(runtime);
  const start = runtime.clock.now().getTime();
  try {
    const res = await withSession(runtime, async (session, ctx) =>
      fetchF29Estado(session, { rut: Rut.parse(ctx.sessionRut), periodo }),
    );
    audit(runtime, 'f29_estado', 'ok', {
      rut: res.rut,
      period: periodo.canonical,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'f29_estado', 'failed', { period: periodo.canonical });
    throw e;
  }
}
