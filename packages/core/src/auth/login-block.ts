// The rejection latch (ADR-028). After SII rejects a Clave, an unattended login must not
// try the same stale value again on the next cron tick: repeated failures lock the account
// (ADR-004). The latch is a local record, `~/.sii/login-blocked.json` through the store seam
// (0600 like every store file), holding NO secret — only which RUT, when, and SII's código.
import { LoginFailedError, LoginQueuedError } from '../errors/index.js';
import type { LoginFailureReason } from '../errors/index.js';
import type { KeyValueStore, Runtime } from '../seams/index.js';
import { WRONG_CLAVE_CODIGO } from './login-error.js';

const LOGIN_BLOCK_KEY = 'login-blocked';

export interface LoginBlockEntry {
  readonly rut: string;
  readonly at: string;
  readonly codigo: string | null;
}

/** One entry per RUT, so tripping a second account never silently lifts the first's latch. */
interface LoginBlockFile {
  readonly entries: readonly LoginBlockEntry[];
}

async function readEntries(store: KeyValueStore): Promise<readonly LoginBlockEntry[]> {
  const file = await store.read<LoginBlockFile>(LOGIN_BLOCK_KEY);
  return Array.isArray(file?.entries) ? file.entries : [];
}

async function writeEntries(store: KeyValueStore, entries: LoginBlockEntry[]): Promise<void> {
  if (entries.length === 0) await store.delete(LOGIN_BLOCK_KEY);
  else await store.write<LoginBlockFile>(LOGIN_BLOCK_KEY, { entries });
}

/** Every latched RUT — what `auth status` reports, so a caller sees the block BEFORE it
 *  decides to log in, instead of discovering it as a refusal. */
export async function listLoginBlocks(store: KeyValueStore): Promise<readonly LoginBlockEntry[]> {
  return readEntries(store);
}

export async function readLoginBlock(
  store: KeyValueStore,
  rut: string,
): Promise<LoginBlockEntry | null> {
  return (await readEntries(store)).find((e) => e.rut === rut) ?? null;
}

/** Did SII actually judge the Clave? Only then may the latch trip. SII's error page is the
 *  one that prints a código (`parseSiiLoginErrorDetail`), so a código is the signal — not
 *  `reason === 'wrong-clave'` alone: the locked-account página has its own, still unobserved
 *  código (login-error.ts), and locking out a locked account is the safe direction. Queue-it,
 *  a WAF refusal, a timeout or a network error carry no código: SII never saw the Clave. */
export function siiJudgedClave(err: unknown): err is LoginFailedError {
  return err instanceof LoginFailedError && !(err instanceof LoginQueuedError) && !!err.codigo;
}

export async function tripLoginBlock(
  runtime: Runtime,
  rut: string,
  codigo: string | null,
): Promise<void> {
  const rest = (await readEntries(runtime.store)).filter((e) => e.rut !== rut);
  await writeEntries(runtime.store, [
    ...rest,
    { rut, at: runtime.clock.now().toISOString(), codigo },
  ]);
}

/** Lift the latch for one RUT, or for every RUT when none is given. Returns the RUTs lifted. */
export async function clearLoginBlock(store: KeyValueStore, rut?: string): Promise<string[]> {
  const entries = await readEntries(store);
  const lifted = entries.filter((e) => rut === undefined || e.rut === rut).map((e) => e.rut);
  if (lifted.length > 0) {
    await writeEntries(
      store,
      entries.filter((e) => !lifted.includes(e.rut)),
    );
  }
  return lifted;
}

export function reasonForCodigo(codigo: string | null): LoginFailureReason {
  return codigo === WRONG_CLAVE_CODIGO ? 'wrong-clave' : 'unknown';
}
