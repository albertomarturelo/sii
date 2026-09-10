// Public auth API the surfaces call. Uniform: every operation takes a Runtime.
import * as auth from '../auth/index.js';
import type {
  AuthIdentity,
  AuthLoginResult,
  AuthLogoutResult,
  AuthStatusLocal,
  AuthWhoami,
} from '../auth/index.js';
import type { Runtime } from '../seams/index.js';

export function login(runtime: Runtime): Promise<AuthLoginResult> {
  return auth.login(runtime);
}

/** CLI-only (ADR-010): RUT + Clave from the console → headless login → cookies
 *  only. The Clave is used once and never stored. NEVER expose over MCP. */
export function consoleLogin(
  runtime: Runtime,
  credentials: { rut: string; clave: string },
): Promise<AuthLoginResult> {
  return auth.consoleLogin(runtime, credentials);
}

/** CLI-only (ADR-025): the Clave comes from the OS keyring (service `sii`, username =
 *  the RUT) instead of the terminal. ONE attempt, no implicit re-login. NEVER over MCP. */
export function keyringLogin(runtime: Runtime, args: { rut: string }): Promise<AuthLoginResult> {
  return auth.keyringLogin(runtime, args);
}

export function logout(runtime: Runtime): Promise<AuthLogoutResult> {
  return auth.logout(runtime);
}

/** Pure local read (no portal call). */
export function authStatus(runtime: Runtime): Promise<AuthStatusLocal> {
  return auth.localStatus(runtime.store);
}

/** Curated identity readback from the portal (needs a live session). */
export function statusRefresh(runtime: Runtime): Promise<AuthIdentity> {
  return auth.statusRefresh(runtime);
}

/** whoami — the authenticated principal's own razón social/nombre + email (own PII).
 *  Live portal read; session-keyed (ignores the operate pointer). */
export function whoami(runtime: Runtime): Promise<AuthWhoami> {
  return auth.whoami(runtime);
}

export type { AuthIdentity, AuthLoginResult, AuthLogoutResult, AuthStatusLocal, AuthWhoami };
