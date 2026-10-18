// CLI-ONLY surface of @albertomarturelo/sii-core (subpath `@albertomarturelo/sii-core/cli`). `consoleLogin` accepts
// a Clave argument, so it is DELIBERATELY kept out of the main barrel (`@albertomarturelo/sii-core`)
// — the MCP server imports only the main barrel and must never wire a task that
// takes a password (ADR-006). The terminal CLI imports this subpath instead.
// `keyringLogin` joins it for the same reason: it READS a Clave (from the OS keyring),
// so it must be unreachable from the MCP server (ADR-025).
// `suppliedClaveLogin` takes a Clave the CLI read from a named env var or stdin, and
// `unblockLogin` lifts the rejection latch that guards it — a human's reset, never the
// model's (ADR-028).
export { consoleLogin, keyringLogin, suppliedClaveLogin, unblockLogin } from './tasks/auth.js';
export type { AuthLoginResult, LoginSource } from './tasks/auth.js';
