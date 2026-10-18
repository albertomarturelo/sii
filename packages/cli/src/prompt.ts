// Terminal prompts for the CLI. Prompts go to STDERR (like diagnostics in io.ts)
// so STDOUT stays clean for machine-readable result lines. The Clave prompt mutes
// echo so the secret never appears on screen and never lands in scrollback
// (ADR-006 spirit: no plaintext exposure; ADR-010 console login).
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/** Where the CLI's input comes from — injectable so the command tree is testable without real
 *  stdin or a real environment (see program.test.ts). */
export interface Prompters {
  /** Visible line prompt (e.g. the RUT). */
  line(question: string): Promise<string>;
  /** Hidden prompt (the Clave) — keystrokes are NOT echoed. */
  hidden(question: string): Promise<string>;
  /** All of PIPED stdin (`--clave-stdin`, ADR-028), or `null` when stdin is a TTY: a human at
   *  a terminal is `--console`'s job, with its hidden prompt. */
  piped(): Promise<string | null>;
  /** Is a human at a terminal (stdin is a TTY)? Gates `auth unblock`, the latch's reset,
   *  which must be a person's act and never an unattended agent's (ADR-028). */
  interactive(): boolean;
  /** The environment `--clave-env <VAR>` reads. Mutable on purpose: the variable is deleted
   *  right after the read, so no child process inherits the Clave (ADR-028). */
  readonly env: Record<string, string | undefined>;
}

function linePrompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function hiddenPrompt(question: string): Promise<string> {
  // Write the prompt ourselves, then read with a swallow-everything output so the
  // user's keystrokes are never echoed. terminal:true keeps line editing working.
  process.stderr.write(question);
  const sink = new Writable({
    write(_chunk, _encoding, callback): void {
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output: sink, terminal: true });
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
  });
}

async function pipedStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  // ONE line (ADR-028): stop at the first newline instead of waiting for EOF, which an agent
  // harness that keeps stdin open as a pipe may never send. Breaking out destroys the stream,
  // which is fine: nothing else in this process reads stdin.
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const buf = Buffer.from(chunk as Uint8Array);
    chunks.push(buf);
    if (buf.includes(0x0a)) break;
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Node default prompters (real stdin/stderr, the real `process.env`). */
export const nodePrompters: Prompters = {
  line: linePrompt,
  hidden: hiddenPrompt,
  piped: pipedStdin,
  interactive: () => process.stdin.isTTY === true,
  env: process.env,
};
