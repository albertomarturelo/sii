// Output + error→exit-code mapping for the CLI. SII's Spanish messages are passed
// through unchanged (CONVENTIONS: opaque translations waste the user's time).
import type { Command } from 'commander';
import { classifyError, type ErrorKind } from '@albertomarturelo/sii-core';

// JSON is the DEFAULT output: the CLI is a faithful façade over the @albertomarturelo/sii-core library
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

/** Exit-code contract: the code is a function of the error's stable kind (ADR-012 amendment),
 *  so `type` and the exit code can never disagree. A Record over `ErrorKind`, so a new kind
 *  without a code fails the typecheck. */
const EXIT_CODES: Record<ErrorKind, number> = {
  login_rejected: 3,
  login_blocked: 3,
  login_queued: 3,
  login_failed: 3,
  not_authenticated: 2,
  session_expired: 2,
  www2_session_required: 2,
  rate_limited: 4,
  validation: 1,
  credential_not_found: 1,
  browser_required: 1,
  unexpected_response: 1,
  sii_error: 1,
  // 1, not a new code: a consumer that predates the kind reads it as `unexpected`, which it was.
  network: 1,
  // The CLI never passes a signal (ADR-031); a library consumer's cut, mapped for completeness.
  aborted: 1,
  unexpected: 1,
};

export function exitCodeFor(error: unknown): number {
  return EXIT_CODES[classifyError(error).type];
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The STDERR line for a failed command. `--human`: the bare verbatim message. JSON (the
 *  default): `{ error, type, exitCode, reason?, codigo? }`, so an unattended agent branches on
 *  `type`, never on the Spanish text. `error` is the message the core wrote; no field is
 *  read from the user's input, so nothing here can echo a secret. */
export function formatError(error: unknown): string {
  const message = messageOf(error);
  if (outputMode === 'human') return message;
  const { type, ...detail } = classifyError(error);
  return JSON.stringify({ error: message, type, exitCode: EXIT_CODES[type], ...detail });
}
