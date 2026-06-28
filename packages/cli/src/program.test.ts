import { describe, it, expect, vi } from 'vitest';
import {
  HOSTS,
  LoginFailedError,
  NotAuthenticatedError,
  RateLimitError,
  SessionExpiredError,
  testing,
  type Runtime,
} from '@sii/core';
import { buildProgram } from './program.js';
import { exitCodeFor } from './io.js';
import type { Prompters } from './prompt.js';

// Synthetic, Mod-11-valid RUT (CONVENTIONS): 11.111.111-1.
const SELF_RUT_BODY = 11111111;

// The portal's inline contribuyente snapshot (DatosCntrNow), used by both the
// login mint and the `--refresh` readback.
const datos = (): unknown => ({
  contribuyente: { rut: SELF_RUT_BODY, dv: '1', nombres: 'Juan', apellidoPaterno: 'Pérez' },
});

function makeRuntime(): Runtime {
  return {
    clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
    audit: new testing.RecordingAuditSink(),
    store: new testing.InMemoryKeyValueStore(),
    portal: new testing.FakePortalDriver({
      loginSession: {
        landingUrl: HOSTS.miSii, // off zeusr.sii.cl ⇒ authenticated (URL-based detection)
        evaluate: datos,
        storageState: { cookies: [] },
      },
      // credentialLogin() backs `auth login --console` (ADR-010).
      credentialSession: {
        landingUrl: HOSTS.miSii,
        evaluate: datos,
        storageState: { cookies: [] },
      },
      // restore() backs the idempotent live-probe and `auth status --refresh`.
      restoreSession: { landingUrl: HOSTS.miSii, evaluate: datos },
    }),
  };
}

/** Capture STDOUT while running `fn` (STDERR — incl. the header + prompts — muted). */
async function capture(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    await fn();
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  return lines.join('');
}

/** Run the command tree with the default (real) prompters. */
async function run(runtime: Runtime, ...argv: string[]): Promise<string> {
  return capture(async () => {
    const program = buildProgram(runtime);
    program.exitOverride();
    await program.parseAsync(['node', 'sii', ...argv]);
  });
}

/** Run with injected prompters (for `auth login --console`, no real stdin). */
async function runWith(runtime: Runtime, prompters: Prompters, ...argv: string[]): Promise<string> {
  return capture(async () => {
    const program = buildProgram(runtime, prompters);
    program.exitOverride();
    await program.parseAsync(['node', 'sii', ...argv]);
  });
}

/** Fake prompters: hidden() returns the Clave; line() returns the RUT (if prompted). */
const fakePrompters = (clave: string, rut = ''): Prompters => ({
  line: () => Promise.resolve(rut),
  hidden: () => Promise.resolve(clave),
});

describe('sii CLI command tree (fake runtime, no SII)', () => {
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

  it('operate with no argument reports the current context', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'operate');
    expect(out).toContain('Operando como tú mismo: 11.111.111-1.');
  });

  it('operate --self reports operating as self', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'operate', '--self');
    expect(out).toContain('Operando como tú mismo: 11.111.111-1.');
  });

  it('operate <rut> validates against the operable set (self is operable)', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'operate', '11111111-1');
    expect(out).toContain('Operando como tú mismo: 11.111.111-1.');
  });

  it('operate --list lists the operable set with markers', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'operate', '--list');
    expect(out).toContain('11.111.111-1');
    expect(out).toContain('tú mismo');
    expect(out).toContain('operando ahora');
  });

  it('operate --list without a session says so', async () => {
    const out = await run(makeRuntime(), 'operate', '--list');
    expect(out).toContain('No hay sesión activa.');
  });

  it('logout wipes the session', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'auth', 'logout');
    expect(out).toMatch(/Sesión cerrada/);
    expect(await run(rt, 'auth', 'status')).toContain('No autenticado.');
  });
});

describe('sii rcv command (fake runtime, no SII)', () => {
  const RESUMEN_ENV = {
    respEstado: { codRespuesta: 0 },
    totDocRes: 2,
    data: [
      { rsmnTipoDocInteger: 33, dcvNombreTipoDoc: 'Factura', rsmnTotDoc: 2, rsmnMntTotal: 119000 },
    ],
  };

  // restore() backs withSession; it scripts the RCV facade's requestJson + TOKEN cookie.
  function makeRcvRuntime(requestJson: () => unknown): Runtime {
    return {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          requestJson,
          cookies: { TOKEN: 't' },
        },
      }),
    };
  }

  it('rcv summary prints the resumen rows for a period', async () => {
    const rt = makeRcvRuntime(() => RESUMEN_ENV);
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'rcv', 'summary', '2026-06');
    expect(out).toContain('RCV COMPRA 2026-06');
    expect(out).toContain('33');
    expect(out).toContain('Total documentos: 2');
  });

  it('rcv summary requires a session (NotAuthenticated → exit 2)', async () => {
    const rt = makeRcvRuntime(() => RESUMEN_ENV); // no login
    await expect(run(rt, 'rcv', 'summary', '2026-06')).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
  });
});

describe('sii f22 command (fake runtime, no SII)', () => {
  const BUSCA = {
    metaData: { errors: [] },
    data: {
      decls: [{ folio: '999', vgte: 'S', codConc: 'C1', fecIng: '15/04/2025' }],
      glosas: [{ codConclusion: 'C1', descripcion: 'Vigente' }],
    },
  };
  const GRID = {
    metaData: {},
    data: [
      { codigo: '305', valor: '-100', glosa: 'Resultado liquidación' },
      { codigo: '3', valor: '11111111-1', glosa: 'RUT' }, // header PII → excluded
    ],
  };
  function makeF22Runtime(): Runtime {
    return {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          cookies: { TOKEN: 't' },
          requestJson: (url) =>
            url.includes('buscaDeclVgte')
              ? BUSCA
              : url.includes('f22Compacto')
                ? GRID
                : { metaData: {}, data: null },
        },
      }),
    };
  }

  it('f22 status <año> shows folio/estado + only the curated (non-PII) códigos', async () => {
    const rt = makeF22Runtime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'f22', 'status', '2025');
    expect(out).toContain('F22 2025');
    expect(out).toContain('Estado: Vigente');
    expect(out).toContain('305');
    expect(out).toContain('1 código(s).'); // header código '3' (RUT) excluded
    expect(out).not.toContain('RUT'); // the excluded código's glosa never prints
  });

  it('f22 status (no year) shows the multi-year estado overview', async () => {
    const rt = makeF22Runtime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'f22', 'status', '--years', '3');
    expect(out).toContain('estado por año');
    expect(out).toContain('2026  Vigente');
    expect(out).toContain('2024  Vigente');
  });

  it('f22 status requires a session (NotAuthenticated)', async () => {
    await expect(run(makeF22Runtime(), 'f22', 'status', '2025')).rejects.toBeInstanceOf(
      NotAuthenticatedError,
    );
  });
});

describe('exit-code mapping (errors.ts contract)', () => {
  it('maps domain errors to documented codes', () => {
    expect(exitCodeFor(new NotAuthenticatedError('x'))).toBe(2);
    expect(exitCodeFor(new SessionExpiredError('x'))).toBe(2); // subclass of NotAuthenticated
    expect(exitCodeFor(new LoginFailedError('x'))).toBe(3);
    expect(exitCodeFor(new RateLimitError('x'))).toBe(4);
    expect(exitCodeFor(new Error('x'))).toBe(1);
  });
});
