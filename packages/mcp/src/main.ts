#!/usr/bin/env node
// @sii/mcp entry point. Wires the Node runtime into the server and serves over
// stdio. STDOUT is the JSON-RPC channel — diagnostics go to STDERR only.
import { createNodeRuntime } from '@altumstack/sii-core';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const server = buildServer(createNodeRuntime());
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
