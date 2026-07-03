// Public API of @albertomarturelo/sii-core. Surfaces (CLI, MCP) import ONLY from here — the task
// layer plus the seam interfaces + the runtime factory (ADR-003). Reaching into
// a sub-module (auth/portal/identity internals) from a surface is forbidden.

// --- tasks: the public operations ---
// NOTE: `consoleLogin` (takes a Clave) is intentionally NOT here — it lives in the
// CLI-only subpath `@albertomarturelo/sii-core/cli`, so the MCP server (which imports this barrel)
// cannot wire a password-taking task (ADR-006).
export { login, logout, authStatus, statusRefresh, whoami } from './tasks/auth.js';
export type {
  AuthIdentity,
  AuthLoginResult,
  AuthLogoutResult,
  AuthStatusLocal,
  AuthWhoami,
} from './tasks/auth.js';
export { operate, operateSelf, operatingStatus, listOperable } from './tasks/operate.js';
export type { OperateResult, OperableList } from './tasks/operate.js';
export { describeOperating, formatOperableEntry } from './identity/index.js';
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
export { f29Formulario, f29Overview, f29Status, F29_GRUPO_LABELS } from './tasks/f29.js';
export type {
  F29Formulario,
  F29Overview,
  F29OverviewArgs,
  MesF29,
  LineaF29,
  F29Grupo,
  F29Estado,
  F29Propuesta,
  CodigoF29,
  DeclaracionEstadoF29,
} from './tasks/f29.js';
export { dteAuthorized } from './tasks/dte.js';
export type { DteAutorizados, DteAutorizado } from './tasks/dte.js';
export { bteList, bteEmitPreview, bteEmit } from './tasks/bte.js';
export type {
  BteMensual,
  BteBoleta,
  BteTotales,
  BteSide,
  BteEmitArgs,
  BteEmitResult,
  BteEmitida,
  BtePreview,
  BteRetiene,
  BteLineaEmision,
} from './tasks/bte.js';

// --- seams: the injectable contract a consumer composes a Runtime from ---
// The Node default adapters + `createNodeRuntime` live in the `./node` subpath
// (ADR-016), so this barrel's static graph stays free of node:* and playwright.
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
export { formatMoney, formatRut } from './format/index.js';
export { Periodo, Anio } from './periodo/index.js';
export { HOSTS, LOGIN_HOST } from './config/index.js';
export * from './errors/index.js';

// --- testing helpers: in-memory fakes for surface / integration tests ---
export * as testing from './adapters/fake/index.js';
