// Public API of @sii/core. Surfaces (CLI, MCP) import ONLY from here — the task
// layer plus the seam interfaces + the runtime factory (ADR-003). Reaching into
// a sub-module (auth/portal/identity internals) from a surface is forbidden.

// --- tasks: the public operations ---
export { login, consoleLogin, logout, authStatus, statusRefresh } from './tasks/auth.js';
export type {
  AuthIdentity,
  AuthLoginResult,
  AuthLogoutResult,
  AuthStatusLocal,
} from './tasks/auth.js';
export { operate, operateSelf, operatingStatus } from './tasks/operate.js';
export type { OperateResult } from './tasks/operate.js';
export type { OperatingContext } from './identity/index.js';

// --- runtime + seams: surfaces build adapters at their composition root ---
export { createNodeRuntime } from './runtime.js';
export type {
  AuditEntry,
  AuditSink,
  Clock,
  CredentialLoginOptions,
  InteractiveLoginOptions,
  KeyValueStore,
  PortalDriver,
  PortalSession,
  Runtime,
  SecretStore,
} from './seams/index.js';

// --- shared primitives ---
export { Rut } from './rut/index.js';
export { HOSTS, LOGIN_HOST } from './config/index.js';
export * from './errors/index.js';

// --- testing helpers: in-memory fakes for surface / integration tests ---
export * as testing from './adapters/fake/index.js';
