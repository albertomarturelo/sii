#!/usr/bin/env node
// @sii/cli — entry point. Thin surface over @sii/core tasks (ADR-003): build the
// command tree against the Node runtime and parse argv. Domain errors map to the
// documented exit codes; their Spanish messages pass through unchanged.
import { createNodeRuntime } from '@sii/core';
import { buildProgram } from './program.js';
import { err, exitCodeFor, messageOf } from './io.js';

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  await buildProgram(runtime).parseAsync(process.argv);
}

main().catch((error: unknown) => {
  err(messageOf(error));
  process.exitCode = exitCodeFor(error);
});
