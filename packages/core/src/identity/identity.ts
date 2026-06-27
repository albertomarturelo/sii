import type { KeyValueStore } from '../seams/index';
import { ValidationError } from '../errors/index';
import { Rut } from '../rut/index';

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

/** Set the operating RUT, validated against the cached operable set. SELECTS,
 *  never mints (ADR-005). Accepts any RUT format. */
export async function setOperatingRut(store: KeyValueStore, target: string): Promise<OperateState> {
  const state = await readOperateState(store);
  if (!state) {
    throw new ValidationError('No hay sesión activa. Ejecuta `sii auth login` primero.');
  }
  if (state.accountType === 'empresa') {
    throw new ValidationError('Una cuenta empresa no puede operar a nombre de otra.');
  }
  const parsed = Rut.parse(target);
  const match = state.operable.find((e) => e.rut === parsed.canonical);
  if (!match) {
    throw new ValidationError(
      `RUT ${parsed.formatted} no está en el conjunto operable. Revisa los RUT autorizados con \`sii accounts operable\`.`,
    );
  }
  const next: OperateState = { ...state, operatingRut: parsed.canonical };
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

/** Resolver precedence (ADR-005): explicit override > operate pointer > self.
 *  Returns null only when there is no state at all and no override. */
export function resolveOperatingRut(state: OperateState | null, override?: string): string | null {
  if (override) return Rut.parse(override).canonical;
  return state ? state.operatingRut : null;
}
