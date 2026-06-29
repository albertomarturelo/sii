// Public API of @sii/core. Surfaces (CLI, MCP) import ONLY from here — the task
// layer plus the seam interfaces + the runtime factory (ADR-003). Reaching into
// a sub-module (auth/portal/identity internals) from a surface is forbidden.

// --- tasks: the public operations ---
// NOTE: `consoleLogin` (takes a Clave) is intentionally NOT here — it lives in the
// CLI-only subpath `@sii/core/cli`, so the MCP server (which imports this barrel)
// cannot wire a password-taking task (ADR-006).
export { login, logout, authStatus, statusRefresh } from './tasks/auth.js';
export type {
  AuthIdentity,
  AuthLoginResult,
  AuthLogoutResult,
  AuthStatusLocal,
} from './tasks/auth.js';
export { operate, operateSelf, operatingStatus, listOperable } from './tasks/operate.js';
export type { OperateResult, OperableList } from './tasks/operate.js';
export { formatOperableEntry } from './identity/index.js';
export type { OperatingContext, OperableEntry } from './identity/index.js';
export { rcvSummary, rcvList } from './tasks/rcv.js';
export type { RcvResumen, RcvResumenRow, RcvDetalle, RcvDetalleDoc, RcvSide } from './tasks/rcv.js';
export { f22Status, f22Overview, f22Observaciones, f22Historial } from './tasks/f22.js';
export type {
  F22Estado,
  F22Declaraciones,
  F22Overview,
  F22Observaciones,
  F22Historial,
  F22Grupos,
  DeclaracionF22,
  CodigoF22,
  EventoF22,
  ObservacionF22,
} from './tasks/f22.js';

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
export { Periodo, Anio } from './periodo/index.js';
export { HOSTS, LOGIN_HOST } from './config/index.js';
export * from './errors/index.js';

// --- testing helpers: in-memory fakes for surface / integration tests ---
export * as testing from './adapters/fake/index.js';
