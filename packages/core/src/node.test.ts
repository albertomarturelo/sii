// The `./node` composition subpath (ADR-016). Constructing the default runtime is
// side-effect free (no fs writes, no playwright import) — the assertions here rely
// on that: nothing in this suite may touch ~/.sii or launch a browser. The SII_HOME
// tests write only under a fresh tmp dir they point the variable at.
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FileAuditSink,
  FileKeyValueStore,
  HttpPortalDriver,
  KeyringSecretStore,
  PlaywrightPortalDriver,
  SystemClock,
  createNodeRuntime,
  documentosDir,
  siiDir,
} from './node.js';
import { FixedClock, InMemoryKeyValueStore, RecordingAuditSink } from './adapters/fake/index.js';
import { ValidationError, classifyError } from './errors/index.js';

describe('createNodeRuntime', () => {
  it('wires the Node default adapters', () => {
    const runtime = createNodeRuntime();
    expect(runtime.clock).toBeInstanceOf(SystemClock);
    expect(runtime.audit).toBeInstanceOf(FileAuditSink);
    expect(runtime.store).toBeInstanceOf(FileKeyValueStore);
    // Default portal is the browser-free HTTP driver; the Playwright engine is `browser` (ADR-027).
    expect(runtime.portal).toBeInstanceOf(HttpPortalDriver);
    expect(runtime.browser).toBeInstanceOf(PlaywrightPortalDriver);
  });

  it('does NOT default a keyring: only the CLI wires one (ADR-006 / ADR-025)', () => {
    // The MCP server builds from this same function, so a `secrets` default would hand
    // it a live OS-keyring reader. The CLI passes one explicitly instead.
    expect(createNodeRuntime().secrets).toBeUndefined();
    expect(createNodeRuntime({ secrets: new KeyringSecretStore() }).secrets).toBeInstanceOf(
      KeyringSecretStore,
    );
  });

  it('replaces ONLY the overridden seams, keeping the other defaults', () => {
    const clock = new FixedClock(new Date('2026-07-02T12:00:00Z'));
    const store = new InMemoryKeyValueStore();
    const runtime = createNodeRuntime({ clock, store });
    expect(runtime.clock).toBe(clock);
    expect(runtime.store).toBe(store);
    expect(runtime.audit).toBeInstanceOf(FileAuditSink);
    expect(runtime.portal).toBeInstanceOf(HttpPortalDriver);
  });

  it('accepts a fully overridden runtime (no Node adapter reached)', () => {
    const audit = new RecordingAuditSink();
    const runtime = createNodeRuntime({ audit });
    expect(runtime.audit).toBe(audit);
  });
});

describe('KeyringSecretStore', () => {
  it('constructs without importing the native keyring binding (lazy, ADR-025)', () => {
    // Same rule as the portal driver: composing a runtime must not load a native
    // module. Only an actual get/set/delete reaches @napi-rs/keyring.
    expect(() => new KeyringSecretStore()).not.toThrow();
  });
});

describe('PlaywrightPortalDriver', () => {
  it('constructs without importing playwright (lazy optional peer, ADR-016)', () => {
    // Construction must never evaluate the playwright module — only the launch
    // methods load it. This keeps `createNodeRuntime()` usable in a consumer that
    // overrides `portal` and does not install the optional peer.
    expect(() => new PlaywrightPortalDriver()).not.toThrow();
  });
});

describe('siiDir / SII_HOME (#164)', () => {
  it('is ~/.sii when SII_HOME is unset or empty, exactly as before', () => {
    expect(siiDir({})).toBe(join(homedir(), '.sii'));
    expect(siiDir({ SII_HOME: '' })).toBe(join(homedir(), '.sii'));
    expect(documentosDir({})).toBe(join(homedir(), '.sii', 'documentos'));
  });

  it('moves the state dir and the documents under an absolute SII_HOME', () => {
    expect(siiDir({ SII_HOME: '/workspace/.sii' })).toBe('/workspace/.sii');
    expect(siiDir({ SII_HOME: '/workspace/.sii/' })).toBe('/workspace/.sii');
    expect(documentosDir({ SII_HOME: '/workspace/.sii' })).toBe('/workspace/.sii/documentos');
  });

  it.each(['.sii', 'workspace/.sii', './.sii', '~/.sii', '~'])(
    'refuses %j as a validation error naming the variable (never resolved against the cwd)',
    (value) => {
      let error: unknown;
      try {
        siiDir({ SII_HOME: value });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as Error).message).toContain('SII_HOME');
      expect(classifyError(error)).toEqual({ type: 'validation' });
    },
  );
});

describe('createNodeRuntime under SII_HOME (#164)', () => {
  let dir: string | undefined;
  afterEach(() => {
    vi.unstubAllEnvs();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('puts the store (session, latch) and the audit receipt under SII_HOME, dir 0700', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sii-home-'));
    const home = join(dir, 'state');
    vi.stubEnv('SII_HOME', home);
    const runtime = createNodeRuntime();
    await runtime.store.write('login-blocked', { synthetic: true });
    runtime.audit.record({ action: 'test', result: 'ok' });
    expect(JSON.parse(readFileSync(join(home, 'login-blocked.json'), 'utf8'))).toEqual({
      synthetic: true,
    });
    expect(readFileSync(join(home, 'audit.jsonl'), 'utf8')).toContain('"action":"test"');
    expect(statSync(home).mode & 0o777).toBe(0o700);
  });

  it('refuses a relative SII_HOME when it builds an fs default', () => {
    vi.stubEnv('SII_HOME', 'relative/.sii');
    expect(() => createNodeRuntime()).toThrow(ValidationError);
  });

  it('lets explicit store + audit overrides win, without reading SII_HOME at all', () => {
    vi.stubEnv('SII_HOME', 'relative/.sii');
    const store = new InMemoryKeyValueStore();
    const audit = new RecordingAuditSink();
    const runtime = createNodeRuntime({ store, audit });
    expect(runtime.store).toBe(store);
    expect(runtime.audit).toBe(audit);
  });
});
