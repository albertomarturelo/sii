# Architecture Decision Records

Foundational decisions for the TypeScript rewrite. Lineage to the Python
`sii-cli` ADRs is cited inside each record where a rule is ported.

| ID  | Title                                                                                          | Status   | Date       |
| --- | ---------------------------------------------------------------------------------------------- | -------- | ---------- |
| 001 | [Adopt Context-First Development (CFD) for this repo](001-adopt-cfd-methodology.md)             | Accepted (amended: Agent Skills) | 2026-06-27 |
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
| 012 | [JSON is the default output; `@altumstack/sii-core` is the JSON contract](012-json-default-output.md) | Accepted (amended: error kinds, `network`, `aborted`) | 2026-06-29 |
| 013 | [F29 read surface — phased; robust SDI-JSON now, GWT-RPC presented form deferred](013-f29-phased-read-gwt-rpc-deferred.md) | Accepted | 2026-06-29 |
| 014 | [Unauthenticated `PortalDriver.requestPublic` seam for public login-free consultas](014-public-consulta-seam.md) | Accepted | 2026-06-29 |
| 015 | [Publish `@altumstack/sii-core` as a private package on GitHub Packages](015-publish-core-github-packages.md) | Accepted | 2026-06-30 |
| 016 | [Embeddable core — pure main barrel, `./node` composition subpath, optional Playwright peer](016-embeddable-core-node-subpath.md) | Accepted | 2026-07-02 |
| 017 | [BHE emission — the first write surface (`bte emit`) posture](017-bte-emit-write-posture.md) | Accepted | 2026-07-02 |
| 018 | [Public release under the MIT license](018-public-release-mit-license.md) | Accepted | 2026-07-02 |
| 019 | [Publish to public npm under the personal scope `@albertomarturelo/sii-core`](019-publish-public-npm-personal-scope.md) | Accepted | 2026-07-02 |
| 020 | [GWT-RPC read capability behind the seam (SISPAD peticiones)](020-gwt-rpc-read-capability.md) | Accepted | 2026-07-03 |
| 021 | [Publish the CLI + MCP surfaces to public npm](021-publish-cli-mcp-surfaces-npm.md) | Accepted (amended: Unreleased + bump rule) | 2026-07-03 |
| 022 | [Binary download seam + document output contract (F29 PDFs)](022-document-download-seams.md) | Accepted | 2026-08-31 |
| 023 | [Factura electrónica (Portal MIPYME): borradores only, no emission](023-factura-borradores-only.md) | Accepted | 2026-09-08 |
| 024 | [Surfaces are named by SII artifact; portal and auth mode are implementation axes](024-surfaces-named-by-artifact.md) | Accepted | 2026-09-09 |
| 025 | [Keyring `SecretStore` — the Clave from the OS keyring, explicit login only](025-keyring-secret-store.md) | Accepted | 2026-09-09 |
| 026 | [The www2 app session — a second cookies-only login, minted only by the user at SII's OAuth page](026-www2-app-session-login.md) | Accepted | 2026-09-12 |
| 027 | [HTTP `PortalDriver` as the default; the CLI never needs a human at a browser](027-http-portal-driver.md) | Accepted (amended: BTE `list` over HTTP) | 2026-10-18 |
| 028 | [Non-interactive login — `--clave-env` / `--clave-stdin`, `--if-needed`, a rejection latch](028-non-interactive-login.md) | Accepted (amended: no `--if-needed`) | 2026-10-18 |
| 029 | [F29 submit — send the propuesta as-is, declare only, return the payment link](029-f29-submit-propuesta.md) | Accepted (amended: transport, oracle, plazo, sin movimiento) | 2026-10-18 |
| 030 | [`alertas` — a session-keyed composite read with stable ids](030-alertas-composite-read.md) | Accepted (amended: regime obligation, `bienes_raices`) | 2026-10-23 |
| 031 | [A caller bounds a multi-call task with an `AbortSignal`, checked between SII calls](031-task-abort-signal.md) | Accepted | 2026-10-26 |
| 032 | [`bienes-raices` — the predios a RUT pays and their cuotas, from Mi SII](032-bienes-raices-mi-sii.md) | Accepted (amended: public cuota breakdown) | 2026-10-28 |
