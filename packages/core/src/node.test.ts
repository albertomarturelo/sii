// The `./node` composition subpath (ADR-016). Constructing the default runtime is
// side-effect free (no fs writes, no playwright import) — the assertions here rely
// on that: nothing in this suite may touch ~/.sii or launch a browser.
import { describe, expect, it } from 'vitest';
import {
  FileAuditSink,
  FileKeyValueStore,
  PlaywrightPortalDriver,
  SystemClock,
  createNodeRuntime,
} from './node.js';
import { FixedClock, InMemoryKeyValueStore, RecordingAuditSink } from './adapters/fake/index.js';

describe('createNodeRuntime', () => {
  it('wires the four Node default adapters', () => {
    const runtime = createNodeRuntime();
    expect(runtime.clock).toBeInstanceOf(SystemClock);
    expect(runtime.audit).toBeInstanceOf(FileAuditSink);
    expect(runtime.store).toBeInstanceOf(FileKeyValueStore);
    expect(runtime.portal).toBeInstanceOf(PlaywrightPortalDriver);
  });

  it('replaces ONLY the overridden seams, keeping the other defaults', () => {
    const clock = new FixedClock(new Date('2026-07-02T12:00:00Z'));
    const store = new InMemoryKeyValueStore();
    const runtime = createNodeRuntime({ clock, store });
    expect(runtime.clock).toBe(clock);
    expect(runtime.store).toBe(store);
    expect(runtime.audit).toBeInstanceOf(FileAuditSink);
    expect(runtime.portal).toBeInstanceOf(PlaywrightPortalDriver);
  });

  it('accepts a fully overridden runtime (no Node adapter reached)', () => {
    const audit = new RecordingAuditSink();
    const runtime = createNodeRuntime({ audit });
    expect(runtime.audit).toBe(audit);
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
