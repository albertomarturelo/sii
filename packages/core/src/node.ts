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
  FileAuditSink,
  FileKeyValueStore,
  NodeFileSink,
  SystemClock,
  documentosDir,
  siiDir,
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
 *  (ADR-006 / ADR-025).
 *  A default is built only for a seam NOT overridden: the fs defaults read `SII_HOME`
 *  (`siiDir()`), and a consumer that supplies its own `store` and `audit` must not be
 *  refused over a variable it never uses. */
export function createNodeRuntime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    clock: overrides.clock ?? new SystemClock(),
    audit: overrides.audit ?? new FileAuditSink(),
    store: overrides.store ?? new FileKeyValueStore(),
    portal: overrides.portal ?? new HttpPortalDriver(),
    browser: overrides.browser ?? new PlaywrightPortalDriver(),
    files: overrides.files ?? new NodeFileSink(),
    ...overrides,
  };
}
