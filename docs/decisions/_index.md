# Architecture Decision Records

Foundational decisions for the TypeScript rewrite. Lineage to the Python
`sii-cli` ADRs is cited inside each record where a rule is ported.

| ID  | Title                                                                                          | Status   | Date       |
| --- | ---------------------------------------------------------------------------------------------- | -------- | ---------- |
| 001 | [Adopt Context-First Development (CFD) for this repo](001-adopt-cfd-methodology.md)             | Accepted | 2026-06-27 |
| 002 | [TypeScript + Node + pnpm-workspaces monorepo toolchain](002-typescript-node-pnpm-monorepo.md)  | Accepted | 2026-06-27 |
| 003 | [Shared core consumed by CLI + MCP; injectable seams for external deps](003-shared-core-ports-adapters.md) | Accepted | 2026-06-27 |
| 004 | [Port the SII guardrails + ToS posture from sii-py](004-port-sii-guardrails-and-tos-posture.md) | Accepted | 2026-06-27 |
| 005 | [Single-account, operate-centric identity model](005-single-account-operate-centric-identity.md)| Accepted | 2026-06-27 |
| 006 | [Auth posture — browser cookies-only default + keyring fallback](006-auth-posture-browser-cookies-host-secrets.md) | Accepted | 2026-06-27 |
| 007 | [Modular core layout + worktree-parallel boundaries](007-modular-core-layout.md) | Accepted | 2026-06-27 |
| 008 | [Runtime library choices — commander CLI, browser-first auth](008-runtime-library-choices.md) | Accepted | 2026-06-27 |
| 009 | [NodeNext module resolution for Node-runnable surface builds](009-nodenext-module-resolution.md) | Accepted | 2026-06-27 |
| 010 | [CLI console login — headless form-fill to a cookies-only session](010-cli-console-login.md) | Accepted | 2026-06-28 |
| 011 | [Adopt zod for MCP tool input schemas (and wire-boundary validation)](011-zod-validation.md) | Accepted | 2026-06-28 |
| 012 | [JSON is the default output; `@sii/core` is the JSON contract](012-json-default-output.md) | Accepted | 2026-06-29 |
| 013 | [F29 read surface — phased; robust SDI-JSON now, GWT-RPC presented form deferred](013-f29-phased-read-gwt-rpc-deferred.md) | Accepted | 2026-06-29 |
| 014 | [Unauthenticated `PortalDriver.requestPublic` seam for public login-free consultas](014-public-consulta-seam.md) | Accepted | 2026-06-29 |
| 015 | [Publish `@sii/core` as a private package on GitHub Packages](015-publish-core-github-packages.md) | Accepted | 2026-06-30 |
