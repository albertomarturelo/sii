// Node default adapters used by createNodeRuntime(). No SII network here — the
// Playwright PortalDriver lands with the auth increment (ADR-008).
import { promises as fsp, appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { ValidationError } from '../../errors/index.js';
import type { AuditEntry, AuditSink, Clock, FileSink, KeyValueStore } from '../../seams/index.js';

/** The CLI/MCP state directory: `$SII_HOME`, or `~/.sii` when it is unset or empty (#164).
 *  Session, `operate` pointer, rejection latch, audit and documents all live under it, so a
 *  host that persists only one path (Grok Bot keeps `/workspace`) points it there instead of
 *  symlinking `~/.sii`. Read when a default adapter is BUILT, never at import: a bad value
 *  must reach the surface's error handler as a `validation` error, not crash the import. A
 *  relative or `~` value is refused, never resolved against the cwd — a cron's cwd moves,
 *  and a state dir that silently moves loses the latch (ADR-028). */
export function siiDir(env: NodeJS.ProcessEnv = process.env): string {
  const value = env['SII_HOME'];
  if (value === undefined || value === '') return join(homedir(), '.sii');
  if (value.startsWith('~') || !isAbsolute(value)) {
    throw new ValidationError(
      `SII_HOME debe ser una ruta absoluta (p. ej. /workspace/.sii); se recibió "${value}".`,
    );
  }
  return resolve(value);
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** fs-backed JSON store: <siiDir>/<key>.json, dir 0700 / files 0600, atomic write. */
export class FileKeyValueStore implements KeyValueStore {
  constructor(private readonly baseDir: string = siiDir()) {}
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

/** Append-only JSONL receipt: <siiDir>/audit.jsonl. Best-effort, never throws once built. */
export class FileAuditSink implements AuditSink {
  constructor(private readonly path: string = join(siiDir(), 'audit.jsonl')) {}
  record(entry: AuditEntry): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch {
      // a receipt is never a gatekeeper — failures degrade silently (ADR-004)
    }
  }
}

/** Default document destination: <siiDir>/documentos (ADR-022). A downloaded artifact is a
 *  tax document, so it lands under the tool's own dir unless the user names another. */
export function documentosDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(siiDir(env), 'documentos');
}

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
