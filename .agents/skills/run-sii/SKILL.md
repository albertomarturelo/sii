---
name: run-sii
description: "Build, run, smoke-test and drive the sii CLI, the sii-mcp stdio server and the core tasks locally, without touching production SII or ~/.sii. Use when asked to run, start, try, smoke-test or exercise the CLI / MCP server / a core task, or to check that a change works in the built binaries and not only in vitest."
metadata:
  token-budget: "~1,000"
---

sii is a CLI (`packages/cli`), an MCP stdio server (`packages/mcp`) and the core they share
(`packages/core`). The agent path is **`driver.mjs`** in this skill. It runs the BUILT binaries
with `SII_HOME` set to a scratch dir, speaks JSON-RPC to the MCP server, and calls core tasks
against the core's own fakes (`testing`). Paths below are relative to the repo root;
`.claude/skills` is a symlink to `.agents/skills`, so either path works.

## Build

```bash
pnpm install --frozen-lockfile
pnpm build
```

The driver reads `packages/*/dist`. Rebuild after every source change, or it runs stale code.

## Run (agent path)

One command checks everything: CLI, MCP handshake + a tool + a resource, a core task vs fakes.

```bash
node .claude/skills/run-sii/driver.mjs smoke
```

It prints `PASS`/`FAIL` per check and exits non-zero on any failure. Pieces:

```bash
D=.claude/skills/run-sii/driver.mjs
node $D home --reset --seed            # fresh scratch SII_HOME + a synthetic session (11111111-1)
node $D cli auth status                # any sii args; JSON on stdout, exit code preserved
node $D cli --human operate --list
node $D cli f29 submit --help          # --help of any verb is offline
node $D mcp tools                      # tool names (32 today)
node $D mcp resources                  # sii://session, sii://operating, sii://operable, sii://config
node $D mcp read sii://operating
node $D mcp call auth_status
node $D mcp call operate '{"list":true}'
node $D core whoami                    # a domain task vs FakePortalDriver: result + audit entries
```

**Direct invocation is the path most PRs need.** Most PRs touch a portal facade or a task,
and those only run against fakes. `core whoami` in `driver.mjs` is the template: build a
`Runtime` from `testing.FakePortalDriver` / `FixedClock` / `RecordingAuditSink` /
`InMemoryKeyValueStore`, call `testing.seedSession`, call the task. Script the fake with
`requestJson` / `requestText` / `requestBinary` for the surface you changed. Copy a fixture
from that module's `*.test.ts`.

## Run (human path)

```bash
node packages/cli/dist/main.js --help
```

Real use needs a real session (`sii auth login`, which prompts for the Clave). That is the
owner's to run, never an agent's: a failed login counts toward SII's account lock.

## Test

```bash
pnpm test
pnpm vitest run packages/core/src/auth/auth.test.ts
```

## Gotchas

- **Anything past a local read hits production SII.** The driver refuses it unless the
  arguments start with `--live` (CLI) or end with `--live` (MCP call). Offline: `--help` /
  `--version`, `auth status` without `--refresh`, `operate`, MCP `auth_status` / `operate`, every
  resource. The seeded session has an EMPTY jar, so a live read on it just bounces
  (`session_expired`). It is still a real request to SII, so don't do it casually.
- **Never point the driver at the real `~/.sii`.** `SII_RUN_HOME` moves the scratch home, and
  the driver refuses `~/.sii`. The real session, the `operate` pointer, the login latch and the
  audit log all live there.
- **`SII_HOME` must be absolute.** A relative value is a `validation` error (exit 1) before any
  command runs.
- **The MCP's auth/operate tools answer Spanish TEXT, not JSON** (`"Autenticado (sesión local)
  como 11.111.111-1. …"`). The domain tools (`tools/*.ts`) and the `sii://` resources are JSON.
  Parse each one accordingly. Tracked as a bug in #198; once it is fixed, update this line and
  the `auth_status` check in `driver.mjs`.
- **The `operating as:` header goes to STDERR and appears only with `--human`.** In JSON mode
  stdout carries the result alone.
- **`seedSession` must run with `SII_HOME` already set.** `createNodeRuntime()` picks the store
  directory when it is built. The driver's `home --seed` does that.
- 3 test files skip unless `SII_F29_CAPTURES` points at private captures (never committed).
  "3 skipped" in `pnpm test` is normal.

## Troubleshooting

- `driver: …/dist/main.js missing` → run `pnpm build`.
- `driver: \`sii <verb> …\` reaches production SII; pass --live` → working as designed. Use a
  core-vs-fakes call instead, or ask the owner before going live.
- `SyntaxError: Unexpected token 'A', "Autenticad"…` when you parse an MCP result → it is one
  of the text tools (see Gotchas). Don't `JSON.parse` it.
