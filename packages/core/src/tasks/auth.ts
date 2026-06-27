// Public auth API the surfaces call. Uniform: every operation takes a Runtime.
import * as auth from '../auth/index';
import type {
  AuthIdentity,
  AuthLoginResult,
  AuthLogoutResult,
  AuthStatusLocal,
} from '../auth/index';
import type { Runtime } from '../seams/index';

export function login(runtime: Runtime): Promise<AuthLoginResult> {
  return auth.login(runtime);
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

export type { AuthIdentity, AuthLoginResult, AuthLogoutResult, AuthStatusLocal };
