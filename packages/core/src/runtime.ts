import { FileAuditSink, FileKeyValueStore, SystemClock } from './adapters/node/index.js';
import { PlaywrightPortalDriver } from './adapters/node/portal.js';
import type { Runtime } from './seams/index.js';

/** Composition root: wire the Node default adapters into a Runtime. */
export function createNodeRuntime(): Runtime {
  return {
    clock: new SystemClock(),
    audit: new FileAuditSink(),
    store: new FileKeyValueStore(),
    portal: new PlaywrightPortalDriver(),
  };
}
