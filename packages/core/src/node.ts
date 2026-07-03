// Composition subpath `@albertomarturelo/sii-core/node` (ADR-016): the Node default
// adapters plus the composition root. Kept OFF the main barrel so importing the
// library's tasks/primitives never evaluates node:* or playwright — a consumer
// that injects its own seams (ADR-003) stays free of them entirely.
import { FileAuditSink, FileKeyValueStore, SystemClock } from './adapters/node/index.js';
import { PlaywrightPortalDriver } from './adapters/node/portal.js';
import type { Runtime } from './seams/index.js';

export { FileAuditSink, FileKeyValueStore, SII_DIR, SystemClock } from './adapters/node/index.js';
export { PlaywrightPortalDriver } from './adapters/node/portal.js';

/** Composition root: the Node default adapters, any seam replaceable (ADR-016).
 *  e.g. `createNodeRuntime({ audit: myAuditSink })` keeps the other three defaults.
 *  The default portal is the Playwright driver — its `playwright` OPTIONAL peer is
 *  loaded lazily on first use, so composing (or overriding `portal`) never needs it. */
export function createNodeRuntime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    clock: new SystemClock(),
    audit: new FileAuditSink(),
    store: new FileKeyValueStore(),
    portal: new PlaywrightPortalDriver(),
    ...overrides,
  };
}
