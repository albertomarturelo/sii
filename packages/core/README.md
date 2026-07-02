# @altumstack/sii-core

The shared SII (Servicio de Impuestos Internos, Chile) domain core — the engine
behind the `sii` CLI and the `sii-mcp` server. A Node library: every legal and
operational guardrail (throttling, audit, credential handling, the operate-centric
identity model) lives here, so a consumer that codes against the task layer gets
the same rails the first-party surfaces do.

> **Private package.** Published to GitHub Packages under the `AltumStack` org for
> internal use only (`license: UNLICENSED`). Access is limited to org members with
> read on the repo. See [ADR-015](../../docs/decisions/015-publish-core-github-packages.md).

## Install

This package lives on **GitHub Packages**, not the public npm registry. Point the
`@altumstack` scope at GitHub Packages and authenticate with a token that has
`read:packages`.

`.npmrc` (in the consuming project, or `~/.npmrc`):

```ini
@altumstack:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then, with `GITHUB_TOKEN` set to a PAT (classic) carrying `read:packages`:

```bash
pnpm add @altumstack/sii-core
# or: npm install @altumstack/sii-core
```

`zod` comes along as a dependency. **`playwright` is an OPTIONAL peer** (ADR-016):
only the default `PortalDriver` (the `@altumstack/sii-core/node` subpath) needs it.
If you use that default driver — i.e. you actually drive a real browser against
SII — install it plus the Chromium binary once:

```bash
pnpm add playwright
pnpm exec playwright install chromium
```

If you inject your own `PortalDriver` (or only use the tasks/primitives), skip
this entirely — nothing in the main barrel imports playwright or `node:*`.

## Usage

A consumer builds a `Runtime` (the composition root that wires the Node default
adapters, from the `./node` subpath) and calls **tasks** — the public operations.
Never reach past the task layer into a sub-module; that bypasses the guardrails
(ADR-003).

```ts
import { authStatus, rcvSummary } from '@altumstack/sii-core';
import { createNodeRuntime } from '@altumstack/sii-core/node';

const runtime = createNodeRuntime();

// Who is the current session operating as? (pure-local read)
const status = await authStatus(runtime);

// Read the RCV compra summary for a period (body-RUT surface — `rut` optional).
const resumen = await rcvSummary(runtime, { periodo: '2026-05', side: 'compra' });
console.log(JSON.stringify(resumen, null, 2));
```

Tasks return plain JSON-serializable objects (no `Date`/`Map`/`Set`) — that is the
library contract (ADR-012). Authentication is an explicit verb: tasks consume a
live session or raise `NotAuthenticated`; only `login` mints one. Logging in opens
a real browser where the user types their Clave (cookies-only; the password never
crosses the library boundary — ADR-006).

### Injecting your own seams

The external side-effects are interfaces (`PortalDriver`, `KeyValueStore`,
`AuditSink`, `Clock`, …). `createNodeRuntime` accepts a `Partial<Runtime>` of
overrides, so partial reuse is a supported path — e.g. Node defaults with your
own audit sink and portal driver (an embedding app's mediated browser):

```ts
import { createNodeRuntime } from '@altumstack/sii-core/node';

const runtime = createNodeRuntime({ audit: myAuditSink, portal: myPortalDriver });
```

In-memory fakes ship under `testing` so a consumer's tests never touch the real
SII, keyring, or clock — assemble a `Runtime` from them:

```ts
import { testing, type Runtime } from '@altumstack/sii-core';

const runtime: Runtime = {
  clock: new testing.FixedClock(new Date('2026-06-29T12:00:00Z')),
  audit: new testing.RecordingAuditSink(),
  store: new testing.InMemoryKeyValueStore(),
  portal: new testing.FakePortalDriver({ requestPublic: () => '<html>…</html>' }),
};
```

## What's inside

- **auth / identity** — single-account, operate-centric session model (ADR-005).
- **read surfaces** — `rcv`, `f22`, `f29`, `bte`, `dte` (authorized, public).
- **primitives** — `Rut` (Mod-11), `Periodo` / `Anio`, prod `HOSTS`, audit.

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) and
[`docs/ROADMAP.md`](../../docs/ROADMAP.md) for the full picture, and
[`CHANGELOG.md`](./CHANGELOG.md) for release notes.

## Releasing (maintainers)

Bump `version` in `package.json`, then push a matching `v*` tag — the
`publish-core` GitHub Action builds and publishes to GitHub Packages on tag
(ADR-015):

```bash
# after bumping version to e.g. 0.2.0 and merging to main
git tag v0.2.0
git push origin v0.2.0
```
