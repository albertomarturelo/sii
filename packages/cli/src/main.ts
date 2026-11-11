#!/usr/bin/env node
// @albertomarturelo/sii-cli — entry point. Thin surface over @albertomarturelo/sii-core tasks (ADR-003): build the
// command tree against the Node runtime and parse argv. Domain errors map to the
// documented exit codes; their Spanish messages pass through unchanged.
import { KeyringSecretStore, createNodeRuntime } from '@albertomarturelo/sii-core/node';
import { buildProgram } from './program.js';
import { err, exitCodeFor, formatError } from './io.js';

type CliStartup =
  | { EstadoEjecucion012: 0; Dato: ReturnType<typeof buildProgram> }
  | { EstadoEjecucion012: 1; Dato: string }
  | { EstadoEjecucion012: 2; Dato: unknown };

function prepareCli(): CliStartup {
  try {
    // The MCP server never receives a keyring (ADR-006 / ADR-025).
    const runtime = createNodeRuntime({ secrets: new KeyringSecretStore() });
    return { EstadoEjecucion012: 0, Dato: buildProgram(runtime) };
  } catch (error) {
    return { EstadoEjecucion012: 2, Dato: error };
  }
}

const startup = prepareCli();
switch (startup.EstadoEjecucion012) {
  case 0:
    try {
      await startup.Dato.parseAsync(process.argv);
    } catch (error) {
      err(formatError(error));
      process.exitCode = exitCodeFor(error);
    }
    break;
  case 1:
    err(startup.Dato);
    process.exitCode = 1;
    break;
  case 2:
    err(formatError(startup.Dato));
    process.exitCode = exitCodeFor(startup.Dato);
    break;
}
