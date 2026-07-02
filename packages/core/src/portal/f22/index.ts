// The F22 facade, split per view (shared wire plumbing in shared.ts). This barrel
// preserves the public surface the tasks import — same names as the pre-split
// single-file facade.
export {
  fetchF22Declaraciones,
  pickVigenteFolio,
  type DeclaracionF22,
  type F22Declaraciones,
  type F22Estado,
} from './declaraciones.js';
export { fetchF22Grid } from './grid.js';
export { fetchF22Observaciones, type ObservacionF22 } from './observaciones.js';
export { eventoDateKey, fetchF22Historial, type EventoF22 } from './historial.js';
// The código taxonomy (PII denylist + contador grouping) — re-exported so the public
// surface is unchanged.
export { groupCodigos, isHeaderCodigo } from '../f22-codigos.js';
export type { CodigoF22, F22Grupos } from '../f22-codigos.js';
