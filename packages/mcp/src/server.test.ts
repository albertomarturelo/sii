// Server-level tests: tool/resource surface + the auth/operate tools, which are
// registered in server.ts itself (per-module tool suites live in tools/*.test.ts;
// the shared fixture is test-helpers.ts). Fakes only — no SII.
import { describe, it, expect } from 'vitest';
import {
  HOSTS,
  authStatus,
  listOperable,
  operatingStatus,
  testing,
} from '@albertomarturelo/sii-core';
import {
  connect,
  datos,
  isError,
  makeRuntime,
  propKeys,
  resourceText,
  toolText,
} from './test-helpers.js';

/** The session tools answer the task's object as JSON, like every other tool (ADR-012, #198). */
type Obj = Record<string, unknown>;
const toolJson = (res: unknown): Obj => JSON.parse(toolText(res)) as Obj;

describe('@albertomarturelo/sii-mcp server (in-memory client, fake runtime, no SII)', () => {
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
      'carpeta_instituciones',
      'dte_authorized',
      'dte_borrador_delete',
      'dte_borrador_list',
      'dte_borrador_save',
      'dte_emitidos',
      'dte_empresas',
      'dte_pdf',
      'dte_preview_pdf',
      'f22_formulario',
      'f22_historial',
      'f22_observaciones',
      'f22_status',
      'f22_terceros',
      'f29_formulario',
      'f29_overview',
      'f29_pdf',
      'f29_status',
      'f29_submit',
      'f29_submit_preview',
      'operate',
      'peticiones_list',
      'rcv_all',
      'rcv_list',
      'rcv_summary',
      'whoami',
    ]);

    // ADR-006: no tool INPUT FIELD accepts a password (descriptions may mention
    // "Clave" — that's fine; we inspect the input-schema property names only).
    const allInputKeys = tools.flatMap((t) => propKeys(t.inputSchema));
    expect(allInputKeys.some((k) => /password|clave/i.test(k))).toBe(false);
    // auth_login carries only the optional www2 flag (ADR-026) — never a password (ADR-006).
    expect(propKeys(tools.find((t) => t.name === 'auth_login')?.inputSchema)).toEqual(['www2']);
    // auth_status surfaces the refresh flag (the first zod input schema, ADR-011).
    expect(propKeys(tools.find((t) => t.name === 'auth_status')?.inputSchema)).toContain('refresh');
  });

  it('auth_login www2=true mints the second layer and reports it (still no password arg)', async () => {
    let www2Done = false;
    // Only the /app/session/status URL is scripted; `undefined` for Mi SII lets the fake
    // synthesise the identity HTML from `datos` (ADR-027 moved identity off `evaluate`).
    const status = (url: string): { status: 401; body: string } | string | undefined =>
      url.includes('/app/session/status')
        ? www2Done
          ? JSON.stringify({ userId: '11111111-1', userAuthType: 'CT', seconds: 5999 })
          : { status: 401 as const, body: '' }
        : undefined;
    const runtime = makeRuntime({
      loginSession: {
        landingUrl: HOSTS.miSii,
        datos,
        storageState: () =>
          www2Done
            ? {
                cookies: [
                  { name: 'X-SII-STATE-CT', domain: '.sii.cl', path: '/', expires: 1789006000 },
                ],
              }
            : { cookies: [{ name: 'TOKEN', domain: '.sii.cl', path: '/', value: 'c' }] },
        requestText: (url: string) => {
          if (!www2Done && url.includes('/app/session/status')) www2Done = true;
          return status(url);
        },
      },
      restoreSession: { landingUrl: HOSTS.miSii, datos, requestText: status },
    });
    const client = await connect(runtime);
    const r = toolJson(await client.callTool({ name: 'auth_login', arguments: { www2: true } }));
    expect(r).toMatchObject({
      authenticated: true,
      rut: '11111111-1',
      reason: 'browser_login',
      www2: { authenticated: true, expiresAt: expect.any(String) },
    });
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
    expect(toolJson(res)).toMatchObject({ authenticated: false, rut: null, operating: null });
  });

  it('auth_login mints a session, then auth_status + sii://session reflect it', async () => {
    const runtime = makeRuntime();
    const client = await connect(runtime);

    expect(toolJson(await client.callTool({ name: 'auth_login', arguments: {} }))).toEqual({
      authenticated: true,
      rut: '11111111-1',
      reason: 'browser_login',
    });
    expect(toolJson(await client.callTool({ name: 'auth_status', arguments: {} }))).toMatchObject({
      authenticated: true,
      rut: '11111111-1',
      sessionSource: 'cached',
      operating: { operatingRut: '11111111-1', isSelf: true },
    });
    const session = await client.readResource({ uri: 'sii://session' });
    expect(resourceText(session)).toContain('11111111-1');
    const operable = await client.readResource({ uri: 'sii://operable' });
    expect(resourceText(operable)).toContain('11111111-1'); // self in the operable set
  });

  it('auth_logout takes no input and ends the session (server + local)', async () => {
    // A fake SII whose logout kills the session: after autTermino.cgi, Mi SII bounces any
    // session restored from the old cookies to the login, which is the close proof (#135).
    const LOGOUT_URL = `${HOSTS.login}${HOSTS.logoutPath}`;
    const LOGIN_URL = `${HOSTS.login}${HOSTS.loginPath}`;
    let closed = false;
    const runtime = makeRuntime({
      loginSession: { landingUrl: HOSTS.miSii, datos, storageState: { cookies: [] } },
      restoreSession: {
        landingUrl: HOSTS.miSii,
        datos,
        gotoLanding: (url) => {
          if (url === LOGOUT_URL) {
            closed = true;
            return LOGOUT_URL;
          }
          return url === HOSTS.miSii && closed ? LOGIN_URL : undefined;
        },
      },
    });
    const client = await connect(runtime);

    // No input fields — it delegates to the logout task, carries no secret (ADR-006).
    const { tools } = await client.listTools();
    expect(propKeys(tools.find((t) => t.name === 'auth_logout')?.inputSchema)).toEqual([]);

    await client.callTool({ name: 'auth_login', arguments: {} });
    // The close is proven → serverClosed=true (the unproven branch is core's concern — see
    // auth.test.ts). No www2 layer was stored, so www2ValidUntil is absent.
    expect(toolJson(await client.callTool({ name: 'auth_logout', arguments: {} }))).toEqual({
      loggedOut: true,
      serverClosed: true,
      www2Closed: false,
    });
    // After logout the local session is gone → auth_status reports not-authenticated.
    expect(toolJson(await client.callTool({ name: 'auth_status', arguments: {} }))).toMatchObject({
      authenticated: false,
    });
  });

  it('auth_logout says when a www2 layer SII did not revoke stops working (#146)', async () => {
    // The www2 status read keeps answering a session after the close, as observed live.
    const runtime = makeRuntime({
      restoreSession: {
        landingUrl: HOSTS.miSii,
        datos,
        requestText: (url) =>
          url.includes('/app/session/status')
            ? JSON.stringify({ userId: '11111111-1', userAuthType: 'CT' })
            : undefined,
      },
    });
    const until = '2026-06-27T13:40:00.000Z';
    await testing.seedSession(runtime, {
      www2: { savedAt: '2026-06-27T12:00:00.000Z', expiresAt: until },
    });
    const client = await connect(runtime);
    const r = toolJson(await client.callTool({ name: 'auth_logout', arguments: {} }));
    expect(r).toMatchObject({ loggedOut: true, www2Closed: false, www2ValidUntil: until });
  });

  it('auth_logout with no live session reports nothing to close', async () => {
    const client = await connect(makeRuntime());
    expect(toolJson(await client.callTool({ name: 'auth_logout', arguments: {} }))).toMatchObject({
      loggedOut: false,
    });
  });

  it('operate reports the context and selects self', async () => {
    const runtime = makeRuntime();
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });
    const self = { operatingRut: '11111111-1', selfRut: '11111111-1', isSelf: true };
    expect(toolJson(await client.callTool({ name: 'operate', arguments: {} }))).toMatchObject(self);
    expect(
      toolJson(await client.callTool({ name: 'operate', arguments: { self: true } })),
    ).toMatchObject(self);
  });

  it('operate list=true lists the operable set (self/current markers)', async () => {
    const client = await connect(makeRuntime());
    // No session → the CLI's no-session shape, no throw (the description names auth_login).
    expect(toolJson(await client.callTool({ name: 'operate', arguments: { list: true } }))).toEqual(
      { operable: null },
    );
    expect(toolJson(await client.callTool({ name: 'operate', arguments: {} }))).toEqual({
      operating: null,
    });
    await client.callTool({ name: 'auth_login', arguments: {} });
    const listed = toolJson(await client.callTool({ name: 'operate', arguments: { list: true } }));
    expect(listed).toMatchObject({
      operatingRut: '11111111-1',
      operable: [{ rut: '11111111-1', isSelf: true }],
    });
  });

  it('auth_status refresh=true reads the identity from the portal', async () => {
    const client = await connect(makeRuntime());
    await client.callTool({ name: 'auth_login', arguments: {} });
    const id = toolJson(
      await client.callTool({ name: 'auth_status', arguments: { refresh: true } }),
    );
    expect(id).toMatchObject({
      rut: '11111111-1',
      nombre: expect.stringContaining('Juan Pérez'),
      accountType: 'persona',
      www2: { authenticated: false },
    });
  });

  it('operate by a rut in the operable set selects it; outside it errors (isError)', async () => {
    const client = await connect(makeRuntime());
    await client.callTool({ name: 'auth_login', arguments: {} });
    // self IS operable → selects it.
    expect(
      toolJson(await client.callTool({ name: 'operate', arguments: { rut: '11111111-1' } })),
    ).toMatchObject({ operatingRut: '11111111-1', isSelf: true });
    // A valid RUT NOT in the operable set → domain error surfaced as isError.
    const res = await client.callTool({ name: 'operate', arguments: { rut: '12345670-K' } });
    expect(isError(res)).toBe(true);
    // The CLI's JSON error without exitCode (ADR-012 amendment): verbatim message + kind.
    const e = JSON.parse(toolText(res)) as Record<string, unknown>;
    expect(e.type).toBe('validation');
    expect(e.error).toEqual(expect.any(String));
    expect(e).not.toHaveProperty('exitCode');
  });

  it('the session tools answer the same objects as the CLI, not text (ADR-012, #198)', async () => {
    const runtime = makeRuntime();
    await testing.seedSession(runtime);
    const client = await connect(runtime);
    // `sii auth status` prints { ...authStatus, operating }; `sii operate --list` the list.
    expect(toolJson(await client.callTool({ name: 'auth_status', arguments: {} }))).toEqual({
      ...(await authStatus(runtime)),
      operating: await operatingStatus(runtime),
    });
    expect(toolJson(await client.callTool({ name: 'operate', arguments: { list: true } }))).toEqual(
      await listOperable(runtime),
    );
    expect(toolJson(await client.callTool({ name: 'operate', arguments: {} }))).toEqual(
      await operatingStatus(runtime),
    );
  });

  it('a tool error names its stable type (not_authenticated with no session)', async () => {
    const client = await connect(makeRuntime());
    const res = await client.callTool({ name: 'whoami', arguments: {} });
    expect(isError(res)).toBe(true);
    expect(JSON.parse(toolText(res))).toMatchObject({ type: 'not_authenticated' });
  });
});
