// Public operate API. Sets/clears the persona's operating RUT (ADR-005).
import { recordAudit } from '../audit/index';
import {
  clearOperatingRut,
  operatingContext,
  readOperateState,
  setOperatingRut,
} from '../identity/index';
import type { OperatingContext } from '../identity/index';
import type { AuditEntry, Runtime } from '../seams/index';

export interface OperateResult {
  readonly context: OperatingContext;
  readonly reason: 'switched' | 'self';
}

/** Operate AS a represented empresa (validated against the operable set). */
export async function operate(runtime: Runtime, target: string): Promise<OperateResult> {
  const context = operatingContext(await setOperatingRut(runtime.store, target));
  // rutAuth only when operating ≠ self (ADR-015 audit discipline). razón social is PII — never logged.
  const base: AuditEntry = {
    action: 'operate',
    result: 'ok',
    rut: context.operatingRut,
    reason: 'switched',
  };
  recordAudit(runtime, context.isSelf ? base : { ...base, rutAuth: context.selfRut });
  return { context, reason: 'switched' };
}

/** Clear the operating context back to self. */
export async function operateSelf(runtime: Runtime): Promise<OperateResult> {
  const context = operatingContext(await clearOperatingRut(runtime.store));
  recordAudit(runtime, { action: 'operate', result: 'ok', rut: context.selfRut, reason: 'self' });
  return { context, reason: 'self' };
}

/** Current operating context (local read). Null when there is no session. */
export async function operatingStatus(runtime: Runtime): Promise<OperatingContext | null> {
  const state = await readOperateState(runtime.store);
  return state ? operatingContext(state) : null;
}
