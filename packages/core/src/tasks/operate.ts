// Public operate API. Sets/clears the persona's operating RUT (ADR-005).
import { recordAudit } from '../audit/index.js';
import {
  clearOperatingRut,
  operatingContext,
  readOperateState,
  setOperatingRut,
} from '../identity/index.js';
import type { OperableEntry, OperatingContext } from '../identity/index.js';
import type { AuditEntry, Runtime } from '../seams/index.js';

export interface OperateResult {
  readonly context: OperatingContext;
  readonly reason: 'switched' | 'self';
}

export interface OperableList {
  /** The RUT currently operated AS (to flag the active row). */
  readonly operatingRut: string;
  /** Self + represented empresas (the valid `operate` / `--rut` targets). */
  readonly operable: readonly OperableEntry[];
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

/** List the operable set — self + represented empresas (local read). Null when
 *  there is no session. The valid targets for `operate` / `--rut`. */
export async function listOperable(runtime: Runtime): Promise<OperableList | null> {
  const state = await readOperateState(runtime.store);
  return state ? { operatingRut: state.operatingRut, operable: state.operable } : null;
}
