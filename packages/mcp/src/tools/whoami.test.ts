import { describe, it, expect } from 'vitest';
import { HOSTS, testing, type Runtime } from '@albertomarturelo/sii-core';
import { connect, toolText } from '../test-helpers.js';

// Persona DatosCntrNow with email; synthetic RUT 11.111.111-1 (CONVENTIONS).
const datos = (): unknown => ({
  contribuyente: {
    rut: 11111111,
    dv: '1',
    nombres: 'Juan',
    apellidoPaterno: 'Pérez',
    eMail: 'juan@example.cl',
  },
});

function makeRuntime(): Runtime {
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

describe('@albertomarturelo/sii-mcp whoami tool (in-memory client, fake runtime, no SII)', () => {
  it('whoami returns the authenticated principal identity + email as JSON', async () => {
    const client = await connect(makeRuntime());
    await client.callTool({ name: 'auth_login', arguments: {} }); // seed the session
    const res = await client.callTool({ name: 'whoami', arguments: {} });
    const parsed = JSON.parse(toolText(res)) as {
      rut: string;
      accountType: string;
      nombre: string | null;
      email: string | null;
    };
    expect(parsed).toMatchObject({
      rut: '11111111-1',
      accountType: 'persona',
      nombre: 'Juan Pérez',
      email: 'juan@example.cl',
    });
  });

  it('whoami is read-only', async () => {
    const client = await connect(makeRuntime());
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'whoami')?.annotations?.readOnlyHint).toBe(true);
  });
});
