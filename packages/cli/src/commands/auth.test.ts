import { describe, it, expect } from 'vitest';
import { fakePrompters, makeRuntime, run, runWith } from '../test-helpers.js';

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
