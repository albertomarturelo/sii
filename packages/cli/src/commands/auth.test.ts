import { describe, it, expect } from 'vitest';
import { testing } from '@albertomarturelo/sii-core';
import {
  fakePrompters,
  makeRuntime,
  makeWww2Runtime,
  run,
  runWith,
  WWW2_EXPIRES,
} from '../test-helpers.js';

describe('sii auth commands (fake runtime, no SII)', () => {
  it('auth login mints a session and reports the RUT', async () => {
    const out = await run(makeRuntime(), 'auth', 'login');
    expect(out).toContain('Sesión iniciada como 11.111.111-1.');
  });

  it('auth login is idempotent when a live session exists', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'auth', 'login');
    expect(out).toContain('Ya tienes una sesión activa como 11.111.111-1.');
  });

  it('auth login --www2 mints the second layer and prints the www2 line', async () => {
    const out = await run(makeWww2Runtime(), 'auth', 'login', '--www2', '--human');
    expect(out).toContain('Sesión iniciada como 11.111.111-1.');
    expect(out).toContain('Sesión www2: activa');
    expect(out).toContain(new Date(WWW2_EXPIRES * 1000).toISOString());
  });

  it('auth status shows the www2 layer as not-iniciada after a plain login', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'auth', 'status', '--human');
    expect(out).toContain('Sesión www2: no iniciada');
  });

  it('auth login --www2 --console is refused before any attempt (reCAPTCHA, ADR-026)', async () => {
    await expect(
      runWith(
        makeRuntime(),
        fakePrompters('x'),
        'auth',
        'login',
        '--www2',
        '--console',
        '--rut',
        '11111111-1',
      ),
    ).rejects.toThrow(/--www2 solo funciona con el login por navegador/);
  });

  it('auth login --console mints a session from terminal RUT + Clave', async () => {
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

  it('auth login --console prompts for the RUT when --rut is omitted', async () => {
    const out = await runWith(
      makeRuntime(),
      fakePrompters('synthetic-clave', '11111111-1'),
      'auth',
      'login',
      '--console',
    );
    expect(out).toContain('Sesión iniciada como 11.111.111-1.');
  });

  it('auth login --console with an empty Clave fails before any attempt', async () => {
    await expect(
      runWith(
        makeRuntime(),
        fakePrompters(''),
        'auth',
        'login',
        '--console',
        '--rut',
        '11111111-1',
      ),
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
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'auth', 'status');
    expect(out).toContain('Autenticado (sesión local) como 11.111.111-1.');
  });

  it('auth status without a session says so', async () => {
    const out = await run(makeRuntime(), 'auth', 'status');
    expect(out).toContain('No autenticado.');
  });

  it('auth status --refresh reads the identity from the portal', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'auth', 'status', '--refresh');
    expect(out).toContain('11.111.111-1');
    expect(out).toContain('Juan Pérez');
    expect(out).toContain('persona');
  });

  it('logout wipes the session', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'auth', 'logout');
    expect(out).toMatch(/Sesión cerrada/);
    expect(await run(rt, 'auth', 'status')).toContain('No autenticado.');
  });
});
