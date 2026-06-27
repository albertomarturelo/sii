// Node default adapters used by createNodeRuntime(). No SII network here — the
// Playwright PortalDriver lands with the auth increment (ADR-008).
import { promises as fsp, appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AuditEntry, AuditSink, Clock, KeyValueStore } from '../../seams/index';

export const SII_DIR = join(homedir(), '.sii');

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** fs-backed JSON store: ~/.sii/<key>.json, dir 0700 / files 0600, atomic write. */
export class FileKeyValueStore implements KeyValueStore {
  constructor(private readonly baseDir: string = SII_DIR) {}
  private pathFor(key: string): string {
    return join(this.baseDir, `${key}.json`);
  }
  async read<T>(key: string): Promise<T | null> {
    try {
      const raw = await fsp.readFile(this.pathFor(key), 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return null; // missing / garbage degrades to null (pure read)
    }
  }
  async write<T>(key: string, value: T): Promise<void> {
    await fsp.mkdir(this.baseDir, { recursive: true, mode: 0o700 });
    const target = this.pathFor(key);
    const tmp = `${target}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fsp.rename(tmp, target);
  }
  async delete(key: string): Promise<void> {
    try {
      await fsp.unlink(this.pathFor(key));
    } catch {
      // already gone
    }
  }
}

/** Append-only JSONL receipt: ~/.sii/audit.jsonl. Best-effort, never throws. */
export class FileAuditSink implements AuditSink {
  constructor(private readonly path: string = join(SII_DIR, 'audit.jsonl')) {}
  record(entry: AuditEntry): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch {
      // a receipt is never a gatekeeper — failures degrade silently (ADR-004)
    }
  }
}
