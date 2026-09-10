// The CLI-only subpath (ADR-006 / ADR-010 / ADR-025). Tasks that handle a Clave —
// `consoleLogin` (takes one) and `keyringLogin` (reads one) — live HERE and must stay
// unreachable from the main barrel, which is all the MCP server imports.
import { describe, expect, it } from 'vitest';
import * as barrel from './index.js';
import * as cliOnly from './cli.js';

describe('CLI-only subpath (ADR-006 / ADR-025)', () => {
  it('exports the Clave-handling login tasks', () => {
    expect(typeof cliOnly.consoleLogin).toBe('function');
    expect(typeof cliOnly.keyringLogin).toBe('function');
  });

  it('the main barrel exposes NEITHER, so the MCP server cannot wire them', () => {
    const names = Object.keys(barrel);
    expect(names).not.toContain('consoleLogin');
    expect(names).not.toContain('keyringLogin');
  });
});
