// Node default adapters used by createNodeRuntime(). No SII network here — the
// Playwright PortalDriver lands with the auth increment (ADR-008).
import { promises as fsp, appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { AuditEntry, AuditSink, Clock, FileSink, KeyValueStore } from '../../seams/index.js';

export const SII_DIR = join(homedir(), '.sii');

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

/** Default document destination: ~/.sii/documentos (ADR-022). A downloaded artifact is a
 *  tax document, so it lands under the tool's own dir unless the user names another. */
export const DOCUMENTOS_DIR = join(SII_DIR, 'documentos');

/** fs-backed FileSink: writes a produced document, creating the directory. Files are 0600
 *  — these are PII-dense tax documents (ADR-006 / ADR-022). A leading `~` is expanded so a
 *  user- or model-supplied `~/Downloads` works as typed. */
export class NodeFileSink implements FileSink {
  async write(dir: string, name: string, bytes: Uint8Array): Promise<string> {
    const expanded = dir.startsWith('~') ? join(homedir(), dir.slice(1)) : dir;
    const target = resolve(expanded);
    await fsp.mkdir(target, { recursive: true, mode: 0o700 });
    const path = join(target, name);
    await fsp.writeFile(path, bytes, { mode: 0o600 });
    return path;
  }
}
