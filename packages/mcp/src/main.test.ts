// The MCP composition root (ADR-006 / ADR-025). The one thing this suite pins is a
// NEGATIVE: the runtime this server is built from carries NO keyring. Keeping the
// Clave-handling tasks off the main barrel controls which TASK the MCP can reach; this
// controls which SEAM it holds, so "the MCP never reads the keyring" is true by
// construction rather than because no code happens to call it.
import { describe, expect, it } from 'vitest';
import { createNodeRuntime } from '@albertomarturelo/sii-core/node';

describe('@albertomarturelo/sii-mcp composition root', () => {
  it('builds a runtime with no SecretStore', () => {
    // main.ts calls createNodeRuntime() with no overrides — the CLI is the only surface
    // that passes `secrets`.
    expect(createNodeRuntime().secrets).toBeUndefined();
  });
});
