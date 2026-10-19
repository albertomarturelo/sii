#!/usr/bin/env node
// @albertomarturelo/sii-cli — entry point. Thin surface over @albertomarturelo/sii-core tasks (ADR-003): build the
// command tree against the Node runtime and parse argv. Domain errors map to the
// documented exit codes; their Spanish messages pass through unchanged.
import { KeyringSecretStore, createNodeRuntime } from '@albertomarturelo/sii-core/node';
import { buildProgram } from './program.js';
import { err, exitCodeFor, formatError } from './io.js';

async function main(): Promise<void> {
  // The OS keyring is wired HERE and only here: the MCP server builds from the same
  // createNodeRuntime() and must carry no keyring at all (ADR-006 / ADR-025).
  const runtime = createNodeRuntime({ secrets: new KeyringSecretStore() });
  await buildProgram(runtime).parseAsync(process.argv);
}

main().catch((error: unknown) => {
  // Errors go to STDERR (STDOUT stays clean for piping). JSON mode (the default) wraps the
  // verbatim SII message with its stable `type` and exit code (ADR-012 amendment).
  err(formatError(error));
  process.exitCode = exitCodeFor(error);
});
