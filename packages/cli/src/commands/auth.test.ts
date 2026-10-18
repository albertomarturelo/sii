import { describe, it, expect } from 'vitest';
import { testing } from '@albertomarturelo/sii-core';
import { fakePrompters, makeRuntime, run, runWith } from '../test-helpers.js';

// Since ADR-027 the CLI login is the HTTP console flow (no browser): it prompts RUT + hidden
// Clave, so these drive it with injected prompters. `--www2` and the headed browser login left
// the CLI (they live in the MCP), so there are no cases for them here.
const loginCli = (rt: Parameters<typeof run>[0], ...extra: string[]): Promise<string> =>
  runWith(rt, fakePrompters('synthetic-clave', '11111111-1'), 'auth', 'login', ...extra);

describe('sii auth commands (fake runtime, no SII)', () => {
  it('auth login (default, no flags) mints a session from terminal RUT + Clave', async () => {
    const out = await loginCli(makeRuntime());
    expect(out).toContain('Sesión iniciada como 11.111.111-1.');
  });

  it('auth login is idempotent when a live session exists', async () => {
    const rt = makeRuntime();
    await loginCli(rt);
    const out = await loginCli(rt);
    expect(out).toContain('Ya tienes una sesión activa como 11.111.111-1.');
  });

  it('auth status shows the www2 layer as not-iniciada after a plain login', async () => {
    const rt = makeRuntime();
    await loginCli(rt);
    const out = await run(rt, 'auth', 'status', '--human');
    expect(out).toContain('Sesión www2: no iniciada');
  });

  it('auth login --console (explicit alias of the default) mints a session', async () => {
    const out = await runWith(
      makeRuntime(),
      fakePrompters('synthetic-clave'),
      'auth',
      'login',
      '--console',
      '--rut',
      '11111111-1',
    );
    expect(out).toContain('Sesión iniciada como 11.111.111-1.');
  });

  it('auth login prompts for the RUT when --rut is omitted', async () => {
    const out = await runWith(
      makeRuntime(),
      fakePrompters('synthetic-clave', '11111111-1'),
      'auth',
      'login',
    );
    expect(out).toContain('Sesión iniciada como 11.111.111-1.');
  });

  it('auth login with an empty Clave fails before any attempt', async () => {
    await expect(
      runWith(makeRuntime(), fakePrompters(''), 'auth', 'login', '--rut', '11111111-1'),
    ).rejects.toThrow(/Clave vacía/);
  });

  it('auth login --keyring mints a session from the stored Clave, no prompt', async () => {
    const rt = {
      ...makeRuntime(),
      secrets: new testing.InMemorySecretStore(new Map([['11111111-1', 'synthetic-clave']])),
    };
    const out = await run(rt, 'auth', 'login', '--keyring', '--rut', '11111111-1');
    expect(out).toContain('Sesión iniciada como 11.111.111-1 (Clave leída del llavero).');
  });

  it('auth login --keyring without a stored entry says how to store it', async () => {
    const rt = { ...makeRuntime(), secrets: new testing.InMemorySecretStore() };
    await expect(run(rt, 'auth', 'login', '--keyring', '--rut', '11111111-1')).rejects.toThrow(
      /secret-tool store .* service sii username 11111111-1/,
    );
  });

  it('auth login --keyring without --rut and without a session says which flag to pass', async () => {
    // --keyring is for unattended use: it must fail fast, never block on a prompt.
    const rt = { ...makeRuntime(), secrets: new testing.InMemorySecretStore() };
    await expect(run(rt, 'auth', 'login', '--keyring')).rejects.toThrow(/--rut <rut>/);
  });

  it('auth status reports the local session after login', async () => {
    const rt = makeRuntime();
    await loginCli(rt);
    const out = await run(rt, 'auth', 'status');
    expect(out).toContain('Autenticado (sesión local) como 11.111.111-1.');
  });

  it('auth status without a session says so', async () => {
    const out = await run(makeRuntime(), 'auth', 'status');
    expect(out).toContain('No autenticado.');
  });

  it('auth status --refresh reads the identity from the portal', async () => {
    const rt = makeRuntime();
    await loginCli(rt);
    const out = await run(rt, 'auth', 'status', '--refresh');
    expect(out).toContain('11.111.111-1');
    expect(out).toContain('Juan Pérez');
    expect(out).toContain('persona');
  });

  it('logout wipes the session', async () => {
    const rt = makeRuntime();
    await loginCli(rt);
    const out = await run(rt, 'auth', 'logout');
    expect(out).toMatch(/Sesión cerrada/);
    expect(await run(rt, 'auth', 'status')).toContain('No autenticado.');
  });
});
