import type { KeyValueStore } from '../seams/index.js';
import { ValidationError } from '../errors/index.js';
import { Rut } from '../rut/index.js';

export type AccountType = 'persona' | 'empresa';

export interface OperableEntry {
  /** Canonical RUT (`<body>-<DV>`). */
  readonly rut: string;
  /** Razón social / nombre — PII: never audited, never chatted. */
  readonly razonSocial: string;
  readonly isSelf: boolean;
}

export interface OperateState {
  /** The session principal (who is logged in), canonical. */
  readonly selfRut: string;
  readonly accountType: AccountType;
  /** Currently operating AS this RUT (defaults to selfRut), canonical. */
  readonly operatingRut: string;
  /** Empresas this account can operate. For an empresa account: just self. */
  readonly operable: readonly OperableEntry[];
}

// Distinct KeyValueStore key (ADR-007) — never shares a file with `auth`'s 'session'.
const OPERATE_KEY = 'operate';

export async function readOperateState(store: KeyValueStore): Promise<OperateState | null> {
  return store.read<OperateState>(OPERATE_KEY);
}

/** Initialise on login: operatingRut defaults to self, operable cached. */
export async function initOperateState(
  store: KeyValueStore,
  input: { selfRut: string; accountType: AccountType; operable: readonly OperableEntry[] },
): Promise<OperateState> {
  const state: OperateState = {
    selfRut: input.selfRut,
    accountType: input.accountType,
    operatingRut: input.selfRut,
    operable: input.operable,
  };
  await store.write(OPERATE_KEY, state);
  return state;
}

export async function clearOperateState(store: KeyValueStore): Promise<void> {
  await store.delete(OPERATE_KEY);
}

/** Validate + canonicalise an operate target against the cached operable set —
 *  SELECTS, never mints (ADR-005). Throws `ValidationError` for an empresa account
 *  (no operate capability) or a RUT outside the operable set. Shared by the
 *  persistent `operate` command AND the per-call `--rut` override so both enforce the
 *  same value-domain (CONVENTIONS: `--rut` is the operable set, not a separate concept). */
export function resolveOperableTarget(state: OperateState, target: string): string {
  if (state.accountType === 'empresa') {
    throw new ValidationError('Una cuenta empresa no puede operar a nombre de otra.');
  }
  const parsed = Rut.parse(target);
  if (!state.operable.some((e) => e.rut === parsed.canonical)) {
    throw new ValidationError(
      `RUT ${parsed.formatted} no está en el conjunto operable. Revisa los RUT autorizados con \`sii operate --list\`.`,
    );
  }
  return parsed.canonical;
}

/** Set the operating RUT, validated against the cached operable set. SELECTS,
 *  never mints (ADR-005). Accepts any RUT format. */
export async function setOperatingRut(store: KeyValueStore, target: string): Promise<OperateState> {
  const state = await readOperateState(store);
  if (!state) {
    throw new ValidationError('No hay sesión activa. Ejecuta `sii auth login` primero.');
  }
  const next: OperateState = { ...state, operatingRut: resolveOperableTarget(state, target) };
  await store.write(OPERATE_KEY, next);
  return next;
}

/** Reset the operating RUT back to self. */
export async function clearOperatingRut(store: KeyValueStore): Promise<OperateState> {
  const state = await readOperateState(store);
  if (!state) {
    throw new ValidationError('No hay sesión activa. Ejecuta `sii auth login` primero.');
  }
  const next: OperateState = { ...state, operatingRut: state.selfRut };
  await store.write(OPERATE_KEY, next);
  return next;
}

export interface OperatingContext {
  readonly operatingRut: string;
  readonly selfRut: string;
  readonly isSelf: boolean;
  readonly razonSocial: string | null;
}

export function operatingContext(state: OperateState): OperatingContext {
  const isSelf = state.operatingRut === state.selfRut;
  const entry = state.operable.find((e) => e.rut === state.operatingRut);
  return {
    operatingRut: state.operatingRut,
    selfRut: state.selfRut,
    isSelf,
    razonSocial: entry?.razonSocial ?? null,
  };
}

/** Render the operating context as the shared `Operando como …` display line
 *  (the CLI STDERR header / `operate` output and the MCP `sii://operating`
 *  resource + `operate` tool used to carry verbatim copies of this). The razón
 *  social only appears for a represented empresa — never for self (own-name PII
 *  stays off the line). */
export function describeOperating(ctx: OperatingContext): string {
  if (ctx.isSelf) return `Operando como tú mismo: ${Rut.parse(ctx.operatingRut).formatted}.`;
  const name = ctx.razonSocial ? ` (${ctx.razonSocial})` : '';
  return `Operando como ${Rut.parse(ctx.operatingRut).formatted}${name}.`;
}

/** Render one operable entry as a single display line (shared by CLI `operate --list`
 *  and the MCP `operate list=true` tool, so the format stays in one place):
 *  `<rut>[ <razón social>][ (tú mismo, operando ahora)]`. Razón social falls back to
 *  the RUT when SII returned no name — omit it then so the RUT isn't repeated. */
export function formatOperableEntry(entry: OperableEntry, operatingRut: string): string {
  const marks = [
    entry.isSelf ? 'tú mismo' : null,
    entry.rut === operatingRut ? 'operando ahora' : null,
  ]
    .filter(Boolean)
    .join(', ');
  const name = entry.razonSocial && entry.razonSocial !== entry.rut ? ` ${entry.razonSocial}` : '';
  return `${Rut.parse(entry.rut).formatted}${name}${marks ? ` (${marks})` : ''}`;
}
