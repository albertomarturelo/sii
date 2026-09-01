import { describe, it, expect, afterEach } from 'vitest';
import { promises as fsp } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFileSink } from './index.js';

// Real filesystem, but only under the OS temp dir — never SII, never the user's data.
const made: string[] = [];
const tmp = (): string => {
  const d = join(tmpdir(), `sii-filesink-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  made.push(d);
  return d;
};
afterEach(async () => {
  for (const d of made.splice(0)) await fsp.rm(d, { recursive: true, force: true });
});

describe('NodeFileSink', () => {
  it('creates the directory, writes the bytes, and returns the absolute path', async () => {
    const dir = join(tmp(), 'nested', 'deeper'); // does not exist yet
    const bytes = new TextEncoder().encode('%PDF-1.4 synthetic');

    const path = await new NodeFileSink().write(dir, 'doc.pdf', bytes);

    expect(path).toBe(join(dir, 'doc.pdf'));
    expect(new Uint8Array(await fsp.readFile(path))).toEqual(bytes);
  });

  it('writes mode 0600 — these are PII-dense documents (ADR-006/ADR-022)', async () => {
    const path = await new NodeFileSink().write(tmp(), 'doc.pdf', new Uint8Array([1, 2, 3]));
    const { mode } = await fsp.stat(path);
    expect(mode & 0o777).toBe(0o600);
  });

  it('expands a leading ~ so a user- or model-supplied path works as typed', async () => {
    // Resolve only — asserting the path, not writing into the real home.
    const dir = join(tmpdir(), `sii-home-${Date.now()}`);
    made.push(dir);
    const relative = dir.startsWith(homedir()) ? `~${dir.slice(homedir().length)}` : null;
    if (!relative) return; // tmpdir isn't under $HOME on this platform — nothing to assert

    const path = await new NodeFileSink().write(relative, 'doc.pdf', new Uint8Array([1]));
    expect(path).toBe(join(dir, 'doc.pdf'));
    expect(path.startsWith('~')).toBe(false);
  });

  it('overwrites in place — the filename is deterministic, so a re-download refreshes', async () => {
    const dir = tmp();
    const sink = new NodeFileSink();
    await sink.write(dir, 'doc.pdf', new TextEncoder().encode('old'));
    const path = await sink.write(dir, 'doc.pdf', new TextEncoder().encode('new'));

    expect(await fsp.readFile(path, 'utf8')).toBe('new');
  });
});
