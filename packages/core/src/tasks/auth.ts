// Public auth API the surfaces call. Uniform: every operation takes a Runtime.
import * as auth from '../auth/index.js';
import type {
  AuthIdentity,
  AuthIdentityRefresh,
  AuthLoginResult,
  AuthLogoutResult,
  AuthStatusLocal,
  AuthWhoami,
  AuthWww2Status,
  LoginBlockEntry,
  LoginOptions,
  LoginSource,
} from '../auth/index.js';
import type { Runtime } from '../seams/index.js';

/** Browser login (ADR-006). `www2: true` also mints the www2 app-session layer in the same headed
 *  browser (ADR-026) — the user types the Clave into SII's OAuth page; never a password argument. */
export function login(runtime: Runtime, options: LoginOptions = {}): Promise<AuthLoginResult> {
  return auth.login(runtime, options);
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

/** CLI-only (ADR-028): the surface read the Clave from a NAMED environment variable or piped
 *  stdin. ONE attempt; refused without contacting SII while the rejection latch is set for the
 *  RUT. NEVER over MCP. */
export function suppliedClaveLogin(
  runtime: Runtime,
  args: { rut: string; clave: string; source: 'env' | 'stdin' },
): Promise<AuthLoginResult> {
  return auth.suppliedClaveLogin(runtime, args);
}

/** CLI-only (ADR-028): lift the rejection latch, for one RUT or all. Local only. Kept off the
 *  MCP on purpose: the latch exists so an unattended caller cannot retry a stale Clave, and
 *  the reset is a human's act, never the model's. */
export function unblockLogin(runtime: Runtime, args: { rut?: string } = {}): Promise<string[]> {
  return auth.unblockLogin(runtime, args);
}

export function logout(runtime: Runtime): Promise<AuthLogoutResult> {
  return auth.logout(runtime);
}

/** Pure local read (no portal call). The www2 layer's `authenticated` is decided by its stored
 *  cookie expiry against the clock. */
export function authStatus(runtime: Runtime): Promise<AuthStatusLocal> {
  return auth.localStatus(runtime.store, runtime.clock.now());
}

/** Curated identity readback from the portal (needs a live session) + the www2 layer read live. */
export function statusRefresh(runtime: Runtime): Promise<AuthIdentityRefresh> {
  return auth.statusRefresh(runtime);
}

/** whoami — the authenticated principal's own razón social/nombre + email (own PII).
 *  Live portal read; session-keyed (ignores the operate pointer). */
export function whoami(runtime: Runtime): Promise<AuthWhoami> {
  return auth.whoami(runtime);
}

export type {
  AuthIdentity,
  AuthIdentityRefresh,
  AuthLoginResult,
  AuthLogoutResult,
  AuthStatusLocal,
  AuthWhoami,
  AuthWww2Status,
  LoginBlockEntry,
  LoginOptions,
  LoginSource,
};
