// Public API of @sii/core. Surfaces (CLI, MCP) import ONLY from here — the task
// layer plus the seam interfaces + the runtime factory (ADR-003). Reaching into
// a sub-module (auth/portal/identity internals) from a surface is forbidden.

// --- tasks: the public operations ---
export { login, logout, authStatus, statusRefresh } from './tasks/auth';
export type {
  AuthIdentity,
  AuthLoginResult,
  AuthLogoutResult,
  AuthStatusLocal,
} from './tasks/auth';
export { operate, operateSelf, operatingStatus } from './tasks/operate';
export type { OperateResult } from './tasks/operate';
export type { OperatingContext } from './identity/index';

// --- runtime + seams: surfaces build adapters at their composition root ---
export { createNodeRuntime } from './runtime';
export type {
  AuditEntry,
  AuditSink,
  Clock,
  InteractiveLoginOptions,
  KeyValueStore,
  PortalDriver,
  PortalSession,
  Runtime,
  SecretStore,
} from './seams/index';

// --- shared primitives ---
export { Rut } from './rut/index';
export { HOSTS, LOGIN_HOST } from './config/index';
export * from './errors/index';

// --- testing helpers: in-memory fakes for surface / integration tests ---
export * as testing from './adapters/fake/index';
