import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { HOSTS, testing, type Runtime } from '@sii/core';
import { buildServer } from './server.js';

// Synthetic, Mod-11-valid RUT (CONVENTIONS): 11.111.111-1.
const datos = (): unknown => ({
  contribuyente: { rut: 11111111, dv: '1', nombres: 'Juan', apellidoPaterno: 'Pérez' },
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

/** Wire a real MCP Client to the server over a linked in-memory transport. */
async function connect(runtime: Runtime): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildServer(runtime).connect(serverTransport);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
  return client;
}

// The SDK result `content`/`contents` items are typed unions (text | image | …);
// narrow to the text payload for assertions.
const toolText = (res: unknown): string =>
  (res as { content?: { text?: string }[] }).content?.[0]?.text ?? '';

const resourceText = (res: unknown): string =>
  (res as { contents?: { text?: string }[] }).contents?.[0]?.text ?? '';

const isError = (res: unknown): boolean => (res as { isError?: boolean }).isError === true;

const propKeys = (schema: unknown): string[] =>
  Object.keys((schema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {});

describe('@sii/mcp server (in-memory client, fake runtime, no SII)', () => {
  it('exposes the auth/identity tools — and auth_login takes NO password', async () => {
    const client = await connect(makeRuntime());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'auth_login',
      'auth_logout',
      'auth_status',
      'operate',
      'rcv_list',
      'rcv_summary',
    ]);

    // ADR-006: no tool INPUT FIELD accepts a password (descriptions may mention
    // "Clave" — that's fine; we inspect the input-schema property names only).
    const allInputKeys = tools.flatMap((t) => propKeys(t.inputSchema));
    expect(allInputKeys.some((k) => /password|clave/i.test(k))).toBe(false);
    // auth_login has no input fields at all (it delegates to the browser flow).
    expect(propKeys(tools.find((t) => t.name === 'auth_login')?.inputSchema)).toEqual([]);
    // auth_status surfaces the refresh flag (the first zod input schema, ADR-011).
    expect(propKeys(tools.find((t) => t.name === 'auth_status')?.inputSchema)).toContain('refresh');
  });

  it('exposes the orientation resources', async () => {
    const client = await connect(makeRuntime());
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      'sii://config',
      'sii://operable',
      'sii://operating',
      'sii://session',
    ]);
    const cfg = await client.readResource({ uri: 'sii://config' });
    expect(resourceText(cfg)).toContain(HOSTS.login);
  });

  it('auth_status reports not-authenticated before login', async () => {
    const client = await connect(makeRuntime());
    const res = await client.callTool({ name: 'auth_status', arguments: {} });
    expect(toolText(res)).toContain('No autenticado');
  });

  it('auth_login mints a session, then auth_status + sii://session reflect it', async () => {
    const runtime = makeRuntime();
    const client = await connect(runtime);

    expect(toolText(await client.callTool({ name: 'auth_login', arguments: {} }))).toContain(
      'Sesión iniciada como 11.111.111-1.',
    );
    expect(toolText(await client.callTool({ name: 'auth_status', arguments: {} }))).toContain(
      'Autenticado (sesión local) como 11.111.111-1.',
    );
    const session = await client.readResource({ uri: 'sii://session' });
    expect(resourceText(session)).toContain('11111111-1');
    const operable = await client.readResource({ uri: 'sii://operable' });
    expect(resourceText(operable)).toContain('11111111-1'); // self in the operable set
  });

  it('auth_logout takes no input and ends the session (server + local)', async () => {
    const runtime = makeRuntime();
    const client = await connect(runtime);

    // No input fields — it delegates to the logout task, carries no secret (ADR-006).
    const { tools } = await client.listTools();
    expect(propKeys(tools.find((t) => t.name === 'auth_logout')?.inputSchema)).toEqual([]);

    await client.callTool({ name: 'auth_login', arguments: {} });
    // The fake lands off the logout host → serverClosed=true; pin the exact mapped
    // string so the branch that ran is unambiguous (the false-branch mapping is
    // trivial and is core's concern — see auth.test.ts).
    expect(toolText(await client.callTool({ name: 'auth_logout', arguments: {} }))).toBe(
      'Sesión cerrada (servidor y local).',
    );
    // After logout the local session is gone → auth_status reports not-authenticated.
    expect(toolText(await client.callTool({ name: 'auth_status', arguments: {} }))).toContain(
      'No autenticado',
    );
  });

  it('auth_logout with no live session reports nothing to close', async () => {
    const client = await connect(makeRuntime());
    expect(toolText(await client.callTool({ name: 'auth_logout', arguments: {} }))).toContain(
      'No había sesión activa.',
    );
  });

  it('operate reports the context and selects self', async () => {
    const runtime = makeRuntime();
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });
    expect(toolText(await client.callTool({ name: 'operate', arguments: {} }))).toContain(
      'Operando como tú mismo: 11.111.111-1.',
    );
    expect(
      toolText(await client.callTool({ name: 'operate', arguments: { self: true } })),
    ).toContain('Operando como tú mismo: 11.111.111-1.');
  });

  it('operate list=true lists the operable set (self/current markers)', async () => {
    const client = await connect(makeRuntime());
    // No session → actionable hint, no throw.
    expect(
      toolText(await client.callTool({ name: 'operate', arguments: { list: true } })),
    ).toContain('No hay sesión activa. Usa la tool auth_login.');
    await client.callTool({ name: 'auth_login', arguments: {} });
    const listed = toolText(await client.callTool({ name: 'operate', arguments: { list: true } }));
    expect(listed).toContain('11.111.111-1');
    expect(listed).toContain('tú mismo');
    expect(listed).toContain('operando ahora');
  });

  it('auth_status refresh=true reads the identity from the portal', async () => {
    const client = await connect(makeRuntime());
    await client.callTool({ name: 'auth_login', arguments: {} });
    const text = toolText(
      await client.callTool({ name: 'auth_status', arguments: { refresh: true } }),
    );
    expect(text).toContain('11.111.111-1');
    expect(text).toContain('Juan Pérez');
    expect(text).toContain('persona');
  });

  it('operate by a rut in the operable set selects it; outside it errors (isError)', async () => {
    const client = await connect(makeRuntime());
    await client.callTool({ name: 'auth_login', arguments: {} });
    // self IS operable → selects it.
    expect(
      toolText(await client.callTool({ name: 'operate', arguments: { rut: '11111111-1' } })),
    ).toContain('Operando como tú mismo: 11.111.111-1.');
    // A valid RUT NOT in the operable set → domain error surfaced as isError.
    const res = await client.callTool({ name: 'operate', arguments: { rut: '12345670-K' } });
    expect(isError(res)).toBe(true);
    expect(toolText(res).length).toBeGreaterThan(0); // SII/domain message passed through
  });

  it('rcv_summary returns the curated resumen as JSON (body-RUT, read-only)', async () => {
    const env = {
      respEstado: { codRespuesta: 0 },
      totDocRes: 2,
      data: [
        {
          rsmnTipoDocInteger: 33,
          dcvNombreTipoDoc: 'Factura',
          rsmnTotDoc: 2,
          rsmnMntTotal: 119000,
        },
      ],
    };
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          requestJson: () => env,
          cookies: { TOKEN: 't' },
        },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({ name: 'rcv_summary', arguments: { periodo: '2026-06' } });
    const parsed = JSON.parse(toolText(res)) as {
      side: string;
      periodo: string;
      rows: { codigoTipoDoc: string }[];
    };
    expect(parsed).toMatchObject({ side: 'COMPRA', periodo: '2026-06' });
    expect(parsed.rows[0]?.codigoTipoDoc).toBe('33');
    // rcv_summary is read-only.
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'rcv_summary')?.annotations?.readOnlyHint).toBe(true);
  });
});
