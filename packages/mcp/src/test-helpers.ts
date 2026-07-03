// Shared fixture for the per-tool MCP suites: an in-memory MCP client wired to
// buildServer, a fake runtime builder, and result-narrowing helpers. Fakes only —
// no SII.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { HOSTS, testing, type Runtime } from '@albertomarturelo/sii-core';
import { buildServer } from './server.js';

// Synthetic, Mod-11-valid RUT (CONVENTIONS): 11.111.111-1.
export const datos = (): unknown => ({
  contribuyente: { rut: 11111111, dv: '1', nombres: 'Juan', apellidoPaterno: 'Pérez' },
});

export function makeRuntime(): Runtime {
  return {
    clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
    audit: new testing.RecordingAuditSink(),
    store: new testing.InMemoryKeyValueStore(),
    portal: new testing.FakePortalDriver({
      loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
      restoreSession: { landingUrl: HOSTS.miSii, evaluate: datos },
    }),
  };
}

/** Wire a real MCP Client to the server over a linked in-memory transport. */
export async function connect(runtime: Runtime): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildServer(runtime).connect(serverTransport);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
  return client;
}

// The SDK result `content`/`contents` items are typed unions (text | image | …);
// narrow to the text payload for assertions.
export const toolText = (res: unknown): string =>
  (res as { content?: { text?: string }[] }).content?.[0]?.text ?? '';

export const resourceText = (res: unknown): string =>
  (res as { contents?: { text?: string }[] }).contents?.[0]?.text ?? '';

export const isError = (res: unknown): boolean => (res as { isError?: boolean }).isError === true;

export const propKeys = (schema: unknown): string[] =>
  Object.keys((schema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {});
