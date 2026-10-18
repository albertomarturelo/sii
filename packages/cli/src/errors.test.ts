// The JSON error contract (ADR-012 amendment, #134): what an unattended agent reads on STDERR
// when a command fails. Real command paths over a fake runtime, rendered the way main.ts does.
// Synthetic RUT + Clave; no SII.
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  HOSTS,
  LoginFailedError,
  LoginQueuedError,
  RateLimitError,
  SessionExpiredError,
  testing,
  type Runtime,
} from '@albertomarturelo/sii-core';
import { buildProgram } from './program.js';
import type { Prompters } from './prompt.js';
import { exitCodeFor, formatError, setOutputMode } from './io.js';
import { datos, fakePrompters, makeRuntime, seed } from './test-helpers.js';

const RUT = ['--rut', '11111111-1'];
const env = (vars: Record<string, string | undefined>): Prompters =>
  fakePrompters('', '', { env: vars });

/** Run a command that must fail, as main.ts would: JSON output (the default), the error
 *  rendered by `formatError`. Returns the parsed STDERR object. */
async function failJson(
  runtime: Runtime,
  prompters: Prompters,
  ...argv: string[]
): Promise<Record<string, unknown>> {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  let caught: unknown;
  try {
    const program = buildProgram(runtime, prompters);
    program.exitOverride();
    await program.parseAsync(['node', 'sii', ...argv]);
  } catch (e) {
    caught = e;
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  expect(caught, 'the command was expected to fail').toBeDefined();
  const parsed = JSON.parse(formatError(caught)) as Record<string, unknown>;
  // `exitCode` in the object is the process exit code, always.
  expect(parsed.exitCode).toBe(exitCodeFor(caught));
  return parsed;
}

/** A runtime whose HTTP login SII answers with `error`. */
const loginFailsWith = (error: Error): Runtime => ({
  ...makeRuntime(),
  portal: new testing.FakePortalDriver({ failCredentialLogin: error }),
});

afterEach(() => setOutputMode('json'));

describe('JSON errors carry a stable type (ADR-012 amendment)', () => {
  it('SII rejecting the Clave is login_rejected, with reason + codigo', async () => {
    const rt = loginFailsWith(
      new LoginFailedError('La Clave no es correcta (código 01.01)', {
        reason: 'wrong-clave',
        codigo: '01.01',
      }),
    );
    const e = await failJson(
      rt,
      env({ SII_CLAVE: 'synthetic-clave' }),
      'auth',
      'login',
      '--clave-env',
      'SII_CLAVE',
      ...RUT,
    );
    expect(e).toEqual({
      error: 'La Clave no es correcta (código 01.01)',
      type: 'login_rejected',
      exitCode: 3,
      reason: 'wrong-clave',
      codigo: '01.01',
    });
  });

  it('the latch refusing the next unattended login is login_blocked, same exit code', async () => {
    const rt = loginFailsWith(
      new LoginFailedError('La Clave no es correcta (código 01.01)', {
        reason: 'wrong-clave',
        codigo: '01.01',
      }),
    );
    const login = (): Promise<Record<string, unknown>> =>
      failJson(
        rt,
        env({ SII_CLAVE: 'synthetic-clave' }),
        'auth',
        'login',
        '--clave-env',
        'SII_CLAVE',
        ...RUT,
      );
    await login(); // trips the latch
    const e = await login();
    expect(e).toMatchObject({ type: 'login_blocked', exitCode: 3, codigo: '01.01' });
    expect(e.error).toMatch(/No se contactó al/);
    expect((rt.portal as testing.FakePortalDriver).credentialLoginCalls).toBe(1);
  });

  it("SII's waiting room is login_queued (SII never judged the Clave)", async () => {
    const rt = loginFailsWith(new LoginQueuedError('El SII está derivando el ingreso…'));
    const e = await failJson(
      rt,
      env({ SII_CLAVE: 'synthetic-clave' }),
      'auth',
      'login',
      '--clave-env',
      'SII_CLAVE',
      ...RUT,
    );
    expect(e).toEqual({
      error: 'El SII está derivando el ingreso…',
      type: 'login_queued',
      exitCode: 3,
      reason: 'unknown',
      codigo: null,
    });
  });

  it('a missing --clave-env variable is login_failed, and nothing reaches SII', async () => {
    const rt = makeRuntime();
    const e = await failJson(rt, env({}), 'auth', 'login', '--clave-env', 'SII_CLAVE', ...RUT);
    expect(e).toMatchObject({ type: 'login_failed', exitCode: 3, codigo: null });
    expect((rt.portal as testing.FakePortalDriver).credentialLoginCalls).toBe(0);
  });

  it('a --clave-env argument that looks like a value is validation, and is never echoed', async () => {
    const e = await failJson(
      makeRuntime(),
      env({}),
      'auth',
      'login',
      '--clave-env',
      'hunter2-secret',
      ...RUT,
    );
    expect(e).toMatchObject({ type: 'validation', exitCode: 1 });
    expect(JSON.stringify(e)).not.toContain('hunter2-secret');
    expect(e).not.toHaveProperty('reason');
  });

  it('a domain read with no session is not_authenticated (exit 2)', async () => {
    const e = await failJson(makeRuntime(), fakePrompters(''), 'whoami');
    expect(e).toMatchObject({ type: 'not_authenticated', exitCode: 2 });
    expect(e).not.toHaveProperty('codigo');
  });

  it('a dead stored session is session_expired (exit 2)', async () => {
    // The first SDI POST is the liveness test: the seam raises SessionExpired on the login wall.
    const rt: Runtime = {
      ...makeRuntime(),
      portal: new testing.FakePortalDriver({
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          cookies: { TOKEN: 't' },
          requestJson: () => {
            throw new SessionExpiredError('La sesión expiró. Vuelve a iniciar sesión.');
          },
        },
      }),
    };
    await seed(rt);
    const e = await failJson(rt, fakePrompters(''), 'rcv', 'summary', '2026-06');
    expect(e).toEqual({
      error: 'La sesión expiró. Vuelve a iniciar sesión.',
      type: 'session_expired',
      exitCode: 2,
    });
  });
});

describe('formatError', () => {
  it('rate limits keep exit code 4 under their own kind', () => {
    expect(JSON.parse(formatError(new RateLimitError('Demasiadas consultas')))).toEqual({
      error: 'Demasiadas consultas',
      type: 'rate_limited',
      exitCode: 4,
    });
  });

  it('a non-domain error is unexpected (exit 1)', () => {
    expect(JSON.parse(formatError(new TypeError('boom')))).toEqual({
      error: 'boom',
      type: 'unexpected',
      exitCode: 1,
    });
  });

  it('--human prints the bare verbatim message, unchanged', () => {
    setOutputMode('human');
    expect(formatError(new LoginFailedError('La Clave no es correcta', { codigo: '01.01' }))).toBe(
      'La Clave no es correcta',
    );
  });
});
