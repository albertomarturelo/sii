// Shared fixture for the per-command CLI suites: fake runtime builders, output
// capture, and run helpers. Fakes only — no SII, no keyring, no wall clock.
import { vi } from 'vitest';
import { HOSTS, testing, type Runtime } from '@albertomarturelo/sii-core';
import { buildProgram } from './program.js';
import type { Prompters } from './prompt.js';

// Synthetic, Mod-11-valid RUT (CONVENTIONS): 11.111.111-1.
const SELF_RUT_BODY = 11111111;

// The portal's inline contribuyente snapshot (DatosCntrNow), used by both the
// login mint and the `--refresh` readback.
export const datos = (): unknown => ({
  contribuyente: { rut: SELF_RUT_BODY, dv: '1', nombres: 'Juan', apellidoPaterno: 'Pérez' },
});

export function makeRuntime(): Runtime {
  return {
    clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
    audit: new testing.RecordingAuditSink(),
    store: new testing.InMemoryKeyValueStore(),
    portal: new testing.FakePortalDriver({
      // credentialLogin() backs the default/`--console` HTTP login (ADR-010 / ADR-027).
      credentialSession: {
        landingUrl: HOSTS.miSii,
        datos,
        storageState: { cookies: [] },
      },
      // restore() backs the idempotent live-probe and `auth status --refresh`.
      restoreSession: { landingUrl: HOSTS.miSii, datos },
    }),
    // The browser engine (BTE list / MIPYME) — present so requireBrowser never throws; the
    // surfaces that need its page-JS behaviour build their own scripted browser driver.
    browser: new testing.FakePortalDriver({ restoreSession: { landingUrl: HOSTS.miSii, datos } }),
  };
}

/** Seed an authenticated self session directly (ADR-027: the CLI login now prompts for a Clave,
 *  so surface tests that just need "logged in" skip the command). */
export const seed = (runtime: Runtime): Promise<void> => testing.seedSession(runtime);

// The www2 app-session login left the CLI (ADR-027: it's MCP-only, reCAPTCHA-gated), so its
// test runtime lives in the MCP suite now (packages/mcp/src/server.test.ts).

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

// Output is JSON by DEFAULT now; these helpers append `--human` so the human-rendering
// assertions in the suites stay focused on the text. The JSON default is covered by
// `runJson` + the dedicated JSON-output tests.
export async function run(runtime: Runtime, ...argv: string[]): Promise<string> {
  return capture(async () => {
    const program = buildProgram(runtime);
    program.exitOverride();
    await program.parseAsync(['node', 'sii', ...argv, '--human']);
  });
}

/** Run with injected prompters (for `auth login --console`, no real stdin). */
export async function runWith(
  runtime: Runtime,
  prompters: Prompters,
  ...argv: string[]
): Promise<string> {
  return capture(async () => {
    const program = buildProgram(runtime, prompters);
    program.exitOverride();
    await program.parseAsync(['node', 'sii', ...argv, '--human']);
  });
}

/** Run with the DEFAULT (JSON) output and parse it — the library/integration contract. */
export async function runJson(runtime: Runtime, ...argv: string[]): Promise<unknown> {
  const text = await capture(async () => {
    const program = buildProgram(runtime);
    program.exitOverride();
    await program.parseAsync(['node', 'sii', ...argv]);
  });
  return JSON.parse(text);
}

/** Fake prompters: hidden() returns the Clave; line() returns the RUT (if prompted). */
export const fakePrompters = (clave: string, rut = ''): Prompters => ({
  line: () => Promise.resolve(rut),
  hidden: () => Promise.resolve(clave),
});
