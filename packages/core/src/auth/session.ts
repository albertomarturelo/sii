import { NotAuthenticatedError } from '../errors/index.js';
import { readOperateState, resolveOperableTarget } from '../identity/index.js';
import type { KeyValueStore, PortalSession, Runtime } from '../seams/index.js';

// Distinct KeyValueStore key (ADR-007) — never shares a file with `identity`'s 'operate'.
const SESSION_KEY = 'session';

export interface StoredSession {
  /** Canonical session-principal RUT (read from the portal, not a credential). */
  readonly rut: string;
  /** Cookies-only storage state (opaque to the core). */
  readonly cookies: unknown;
  readonly savedAt: string;
}

export async function readSession(store: KeyValueStore): Promise<StoredSession | null> {
  return store.read<StoredSession>(SESSION_KEY);
}

export async function writeSession(store: KeyValueStore, session: StoredSession): Promise<void> {
  await store.write(SESSION_KEY, session);
}

export async function deleteSession(store: KeyValueStore): Promise<void> {
  await store.delete(SESSION_KEY);
}

export interface SessionContext {
  /** Canonical session-principal RUT (who is logged in). */
  readonly sessionRut: string;
  /** Canonical RUT this operation acts as: `--rut` override > operate pointer > self
   *  (ADR-005). Body-RUT facades put this in the request; session-keyed surfaces
   *  ignore it and authorize by `sessionRut`. */
  readonly operatingRut: string;
}

/** Acquire a live `PortalSession` from the stored cookies-only session and run `fn`
 *  against it. This is how DOMAIN TASKS reach SII: they consume a session, they
 *  NEVER mint one (only `login` mints — ADR-006, sii-py ADR-019). The operating/body
 *  RUT is resolved by precedence (override > pointer > self — ADR-005) and handed to
 *  `fn`. The session is ALWAYS closed; a missing local session raises
 *  `NotAuthenticated`. It does NOT eagerly probe liveness — an expired cookie jar
 *  surfaces as the facade's own typed error (representacion.ts) — and it NEVER
 *  retries after a SII block (CONVENTIONS). */
export async function withSession<T>(
  runtime: Runtime,
  fn: (session: PortalSession, ctx: SessionContext) => Promise<T>,
  options: { rut?: string } = {},
): Promise<T> {
  const stored = await readSession(runtime.store);
  if (!stored) {
    throw new NotAuthenticatedError('No hay sesión. Ejecuta `sii auth login`.');
  }
  // Resolve the operating/body RUT (ADR-005). A `--rut` override is the same
  // value-domain as the operate pointer, so it is validated against the operable set
  // HERE (empresa account / out-of-set RUT rejected locally, not round-tripped to SII)
  // — the single enforcement point for per-call `--rut`. No override → the operate
  // pointer; missing operate state alongside a session is broken → re-login.
  const operateState = await readOperateState(runtime.store);
  let operatingRut: string;
  if (options.rut !== undefined) {
    if (!operateState) {
      throw new NotAuthenticatedError('No hay sesión. Ejecuta `sii auth login`.');
    }
    operatingRut = resolveOperableTarget(operateState, options.rut);
  } else {
    operatingRut = operateState?.operatingRut ?? stored.rut;
  }

  let s: PortalSession | null = null;
  try {
    s = await runtime.portal.restore(stored.cookies);
    return await fn(s, { sessionRut: stored.rut, operatingRut });
  } finally {
    await s?.close();
  }
}
