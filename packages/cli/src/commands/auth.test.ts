import { describe, it, expect } from 'vitest';
import { LoginFailedError, testing, type Runtime } from '@albertomarturelo/sii-core';
import { fakePrompters, makeRuntime, run, runJson, runWith } from '../test-helpers.js';

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

// ADR-028: the two non-interactive Clave sources, the exclusivity rule and the latch, driven
// through the command tree with a fake env / fake stdin. Synthetic RUT + Clave; no SII.
describe('sii auth login --clave-env / --clave-stdin (ADR-028, fakes only)', () => {
  const RUT = ['--rut', '11111111-1'];
  const withEnv = (env: Record<string, string | undefined>) => fakePrompters('', '', { env });
  const withStdin = (piped: string | null) => fakePrompters('', '', { piped });
  /** A runtime whose credentialLogin is rejected by SII with a código. */
  const rejecting = (): Runtime => ({
    ...makeRuntime(),
    portal: new testing.FakePortalDriver({
      failCredentialLogin: new LoginFailedError('La Clave no es correcta (código 01.01)', {
        reason: 'wrong-clave',
        codigo: '01.01',
      }),
    }),
  });

  it('--clave-env reads the named variable, logs in, and deletes it from the environment', async () => {
    const rt = makeRuntime();
    const env: Record<string, string | undefined> = { SII_CLAVE: 'synthetic-clave' };
    const out = await runWith(
      rt,
      withEnv(env),
      'auth',
      'login',
      '--clave-env',
      'SII_CLAVE',
      ...RUT,
    );
    expect(out).toContain('Sesión iniciada como 11.111.111-1 (Clave leída de $SII_CLAVE).');
    expect('SII_CLAVE' in env).toBe(false);
    expect((rt.portal as testing.FakePortalDriver).lastCredential?.clave).toBe('synthetic-clave');
  });

  it('--clave-env with a missing or empty variable names it and sends nothing', async () => {
    for (const env of [{}, { SII_CLAVE: '' }]) {
      const rt = makeRuntime();
      await expect(
        runWith(rt, withEnv(env), 'auth', 'login', '--clave-env', 'SII_CLAVE', ...RUT),
      ).rejects.toThrow(/La variable SII_CLAVE no está definida o está vacía/);
      expect((rt.portal as testing.FakePortalDriver).credentialLoginCalls).toBe(0);
    }
  });

  it('--clave-env refuses a non-name WITHOUT echoing it (it may be the Clave itself)', async () => {
    const err = await runWith(
      makeRuntime(),
      withEnv({}),
      'auth',
      'login',
      '--clave-env',
      'hunter2-secret',
      ...RUT,
    ).catch((e: unknown) => e as Error);
    expect(err.message).toMatch(/espera el NOMBRE de una variable/);
    expect(err.message).not.toContain('hunter2-secret');
  });

  it('--clave-stdin reads one line, stripping one trailing CRLF', async () => {
    const rt = makeRuntime();
    const out = await runWith(
      rt,
      withStdin('synthetic-clave\r\n'),
      'auth',
      'login',
      '--clave-stdin',
      ...RUT,
    );
    expect(out).toContain('(Clave leída de stdin)');
    expect((rt.portal as testing.FakePortalDriver).lastCredential?.clave).toBe('synthetic-clave');
  });

  it('--clave-stdin refuses a TTY and an empty value, sending nothing', async () => {
    const rt = makeRuntime();
    await expect(
      runWith(rt, withStdin(null), 'auth', 'login', '--clave-stdin', ...RUT),
    ).rejects.toThrow(/no una terminal/);
    await expect(
      runWith(rt, withStdin('\n'), 'auth', 'login', '--clave-stdin', ...RUT),
    ).rejects.toThrow(/Clave vacía en stdin/);
    expect((rt.portal as testing.FakePortalDriver).credentialLoginCalls).toBe(0);
  });

  it('both sources require --rut (there is no prompt)', async () => {
    await expect(
      runWith(
        makeRuntime(),
        withEnv({ SII_CLAVE: 'x' }),
        'auth',
        'login',
        '--clave-env',
        'SII_CLAVE',
      ),
    ).rejects.toThrow(/--clave-env requiere --rut/);
    await expect(
      runWith(makeRuntime(), withStdin('x'), 'auth', 'login', '--clave-stdin'),
    ).rejects.toThrow(/--clave-stdin requiere --rut/);
  });

  it.each([
    ['--clave-env', 'SII_CLAVE', '--clave-stdin'],
    ['--clave-env', 'SII_CLAVE', '--keyring'],
    ['--clave-stdin', '--console'],
    ['--keyring', '--console'],
  ])('sources are mutually exclusive: %s …', async (...flags) => {
    const env: Record<string, string | undefined> = { SII_CLAVE: 'x' };
    await expect(
      runWith(
        makeRuntime(),
        fakePrompters('', '', { env, piped: 'x' }),
        'auth',
        'login',
        ...flags,
        ...RUT,
      ),
    ).rejects.toThrow(/Usa una sola fuente para la Clave/);
    expect(env.SII_CLAVE).toBe('x'); // refused before anything was read
  });

  it('a SII rejection latches; the next unattended run refuses without contacting SII', async () => {
    const rt = rejecting();
    const env = (): Record<string, string | undefined> => ({ SII_CLAVE: 'stale' });
    await expect(
      runWith(rt, withEnv(env()), 'auth', 'login', '--clave-env', 'SII_CLAVE', ...RUT),
    ).rejects.toThrow(/La Clave no es correcta/);
    await expect(
      runWith(rt, withEnv(env()), 'auth', 'login', '--clave-env', 'SII_CLAVE', ...RUT),
    ).rejects.toThrow(/Login desatendido bloqueado para 11111111-1[\s\S]*No se contactó al SII/);
    expect((rt.portal as testing.FakePortalDriver).credentialLoginCalls).toBe(1);
  });

  it('auth status shows the latch, so an agent sees it before trying to log in', async () => {
    const rt = rejecting();
    await expect(
      runWith(
        rt,
        withEnv({ SII_CLAVE: 'stale' }),
        'auth',
        'login',
        '--clave-env',
        'SII_CLAVE',
        ...RUT,
      ),
    ).rejects.toThrow();
    const json = (await runJson(rt, 'auth', 'status')) as { loginBlocked: unknown[] };
    expect(json.loginBlocked).toEqual([
      { rut: '11111111-1', at: '2026-06-27T12:00:00.000Z', codigo: '01.01' },
    ]);
    const human = await run(rt, 'auth', 'status');
    expect(human).toContain('No autenticado.');
    expect(human).toContain('Login desatendido bloqueado para 11.111.111-1');
  });

  it('auth unblock lifts the latch from a terminal', async () => {
    const rt = rejecting();
    await expect(
      runWith(
        rt,
        withEnv({ SII_CLAVE: 'stale' }),
        'auth',
        'login',
        '--clave-env',
        'SII_CLAVE',
        ...RUT,
      ),
    ).rejects.toThrow();
    const human = fakePrompters('');
    expect(await runWith(rt, human, 'auth', 'unblock')).toContain(
      'Bloqueo levantado para 11.111.111-1.',
    );
    expect(await runWith(rt, human, 'auth', 'unblock')).toContain('No había bloqueo de login.');
  });

  it('auth unblock refuses without a terminal, so an agent cannot lift its own latch', async () => {
    const rt = rejecting();
    await expect(
      runWith(
        rt,
        withEnv({ SII_CLAVE: 'stale' }),
        'auth',
        'login',
        '--clave-env',
        'SII_CLAVE',
        ...RUT,
      ),
    ).rejects.toThrow();
    const agent = fakePrompters('', '', { interactive: false });
    await expect(runWith(rt, agent, 'auth', 'unblock')).rejects.toThrow(
      /solo se ejecuta desde una terminal/,
    );
    // Still latched: the next unattended login refuses without contacting SII.
    await expect(
      runWith(
        rt,
        withEnv({ SII_CLAVE: 'stale' }),
        'auth',
        'login',
        '--clave-env',
        'SII_CLAVE',
        ...RUT,
      ),
    ).rejects.toThrow(/Login desatendido bloqueado/);
  });
});
