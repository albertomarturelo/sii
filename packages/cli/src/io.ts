// Output + error→exit-code mapping for the CLI. SII's Spanish messages are passed
// through unchanged (CONVENTIONS: opaque translations waste the user's time).
import type { Command } from 'commander';
import { LoginFailedError, NotAuthenticatedError, RateLimitError } from '@altumstack/sii-core';

// JSON is the DEFAULT output: the CLI is a faithful façade over the @altumstack/sii-core library
// contract (the tasks return plain, JSON-serializable objects), so driving it via Bash yields
// structured data, not text. `--human` switches to the readable rendering for the terminal.
type OutputMode = 'json' | 'human';
let outputMode: OutputMode = 'json';

export function setOutputMode(mode: OutputMode): void {
  outputMode = mode;
}
export function isHumanMode(): boolean {
  return outputMode === 'human';
}

/** STDOUT line — a human-render building block (and what `emit` writes the JSON with). */
export function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Diagnostics + the operating-as header go to STDERR, so STDOUT stays clean. */
export function err(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Emit a command result. Default = the task's object as pretty JSON (the integration
 *  contract); `--human` runs the human renderer instead. The JSON goes to STDOUT, so a
 *  consumer can `sii … | jq` directly. */
export function emit(data: unknown, human: () => void): void {
  if (outputMode === 'human') human();
  else out(JSON.stringify(data, null, 2));
}

/** The two global output flags. Added to the root AND every leaf command so they parse in
 *  any position (`sii --human f22 status` and `sii f22 status --human` both work). */
export function withOutputFlags(cmd: Command): Command {
  return cmd
    .option('--json', 'Salida en JSON (por defecto).')
    .option('--human', 'Salida legible para humanos en vez de JSON.');
}

/** Exit-code contract (see @altumstack/sii-core errors.ts): NotAuthenticated → 2 (incl.
 *  SessionExpired), LoginFailed → 3, RateLimit → 4, anything else → 1. */
export function exitCodeFor(error: unknown): number {
  if (error instanceof NotAuthenticatedError) return 2;
  if (error instanceof LoginFailedError) return 3;
  if (error instanceof RateLimitError) return 4;
  return 1;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
