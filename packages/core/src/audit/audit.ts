import type { AuditEntry, AuditSink, Clock } from '../seams/index.js';

/** Keys whose presence (substring, case-insensitive) means "secret" — dropped
 *  before the line hits the sink. RUTs are NOT secrets and pass through. */
const SECRET_KEY = /password|clave|cookie|secret|token/i;

/** Compose the final receipt: stamp `ts` from the clock, drop secret-substring
 *  keys, hand it to the sink. Never throws (the sink is best-effort). (ADR-004) */
export function recordAudit(deps: { clock: Clock; audit: AuditSink }, entry: AuditEntry): void {
  const safe: Record<string, unknown> = { ts: deps.clock.now().toISOString() };
  for (const [k, v] of Object.entries(entry)) {
    if (SECRET_KEY.test(k)) continue;
    safe[k] = v;
  }
  deps.audit.record(safe as AuditEntry);
}
