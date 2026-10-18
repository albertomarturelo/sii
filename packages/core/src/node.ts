// Composition subpath `@albertomarturelo/sii-core/node` (ADR-016): the Node default
// adapters plus the composition root. Kept OFF the main barrel so importing the
// library's tasks/primitives never evaluates node:* or playwright — a consumer
// that injects its own seams (ADR-003) stays free of them entirely.
import {
  FileAuditSink,
  FileKeyValueStore,
  NodeFileSink,
  SystemClock,
} from './adapters/node/index.js';
import { HttpPortalDriver } from './adapters/node/http.js';
import { PlaywrightPortalDriver } from './adapters/node/portal.js';
import type { Runtime } from './seams/index.js';

export {
  DOCUMENTOS_DIR,
  FileAuditSink,
  FileKeyValueStore,
  NodeFileSink,
  SII_DIR,
  SystemClock,
} from './adapters/node/index.js';
export { KeyringSecretStore } from './adapters/node/keyring.js';
export { HttpPortalDriver } from './adapters/node/http.js';
export { PlaywrightPortalDriver } from './adapters/node/portal.js';

/** Composition root: the Node default adapters, any seam replaceable (ADR-016).
 *  e.g. `createNodeRuntime({ audit: myAuditSink })` keeps the other defaults.
 *  The default `portal` is the browser-free HTTP driver (ADR-027); `browser` is the
 *  Playwright engine, used only where SII's own page JS must run (BTE list, MIPYME) and
 *  by the MCP's headed / www2 logins. Constructing the Playwright driver is free — its
 *  `playwright` OPTIONAL peer loads lazily on the first browser call — so a runtime that
 *  never touches JS never loads Chromium.
 *  `secrets` is DELIBERATELY not defaulted here: the OS keyring is wired by the CLI's
 *  composition root alone (`createNodeRuntime({ secrets: new KeyringSecretStore() })`),
 *  so the MCP server — which builds from this same function — carries no keyring at all
 *  (ADR-006 / ADR-025). */
export function createNodeRuntime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    clock: new SystemClock(),
    audit: new FileAuditSink(),
    store: new FileKeyValueStore(),
    portal: new HttpPortalDriver(),
    browser: new PlaywrightPortalDriver(),
    files: new NodeFileSink(),
    ...overrides,
  };
}
