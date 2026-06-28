// Terminal prompts for the CLI. Prompts go to STDERR (like diagnostics in io.ts)
// so STDOUT stays clean for machine-readable result lines. The Clave prompt mutes
// echo so the secret never appears on screen and never lands in scrollback
// (ADR-006 spirit: no plaintext exposure; ADR-010 console login).
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/** Injectable so the command tree is testable without real stdin (see program.test.ts). */
export interface Prompters {
  /** Visible line prompt (e.g. the RUT). */
  line(question: string): Promise<string>;
  /** Hidden prompt (the Clave) — keystrokes are NOT echoed. */
  hidden(question: string): Promise<string>;
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

/** Node default prompters (real stdin/stderr). */
export const nodePrompters: Prompters = { line: linePrompt, hidden: hiddenPrompt };
