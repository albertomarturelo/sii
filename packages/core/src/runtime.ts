import { FileAuditSink, FileKeyValueStore, SystemClock } from './adapters/node/index';
import type { PortalDriver, Runtime } from './seams/index';

// The Node PortalDriver (Playwright) lands with the auth increment (ADR-008).
// Until then the store / audit / clock seams are real — so identity/operate work
// end-to-end — and any portal access (auth login) fails loudly rather than
// silently no-op'ing.
function unwiredPortal(): PortalDriver {
  const fail = (): never => {
    throw new Error(
      'PortalDriver not wired yet — the Playwright adapter lands with the auth increment (ADR-008).',
    );
  };
  return { interactiveLogin: fail, restore: fail };
}

/** Composition root: wire the Node default adapters into a Runtime. */
export function createNodeRuntime(): Runtime {
  return {
    clock: new SystemClock(),
    audit: new FileAuditSink(),
    store: new FileKeyValueStore(),
    portal: unwiredPortal(),
  };
}
