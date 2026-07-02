// Server-level tests: tool/resource surface + the auth/operate tools, which are
// registered in server.ts itself (per-module tool suites live in tools/*.test.ts;
// the shared fixture is test-helpers.ts). Fakes only — no SII.
import { describe, it, expect } from 'vitest';
import { HOSTS } from '@altumstack/sii-core';
import { connect, isError, makeRuntime, propKeys, resourceText, toolText } from './test-helpers.js';

describe('@sii/mcp server (in-memory client, fake runtime, no SII)', () => {
  it('exposes the auth/identity tools — and auth_login takes NO password', async () => {
    const client = await connect(makeRuntime());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'auth_login',
      'auth_logout',
      'auth_status',
      'bte_emit',
      'bte_emit_preview',
      'bte_list',
      'dte_authorized',
      'f22_formulario',
      'f22_historial',
      'f22_observaciones',
      'f22_status',
      'f29_formulario',
      'f29_overview',
      'f29_status',
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
});
