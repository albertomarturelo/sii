// CLI-ONLY surface of @albertomarturelo/sii-core (subpath `@albertomarturelo/sii-core/cli`). `consoleLogin` accepts
// a Clave argument, so it is DELIBERATELY kept out of the main barrel (`@albertomarturelo/sii-core`)
// — the MCP server imports only the main barrel and must never wire a task that
// takes a password (ADR-006). The terminal CLI imports this subpath instead.
export { consoleLogin } from './tasks/auth.js';
export type { AuthLoginResult } from './tasks/auth.js';
