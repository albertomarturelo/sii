#!/usr/bin/env node
// @sii/cli — entry point. Thin surface over @altumstack/sii-core tasks (ADR-003): build the
// command tree against the Node runtime and parse argv. Domain errors map to the
// documented exit codes; their Spanish messages pass through unchanged.
import { createNodeRuntime } from '@altumstack/sii-core';
import { buildProgram } from './program.js';
import { err, exitCodeFor, isHumanMode, messageOf } from './io.js';

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  await buildProgram(runtime).parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = messageOf(error);
  // Errors go to STDERR (STDOUT stays clean for piping). JSON mode (the default) wraps the
  // verbatim SII message in a `{ error }` object so a consumer can parse failures too.
  err(isHumanMode() ? message : JSON.stringify({ error: message }));
  process.exitCode = exitCodeFor(error);
});
