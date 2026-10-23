#!/usr/bin/env node
// Drive the built sii CLI, the MCP stdio server and the core tasks without touching
// production SII or the owner's ~/.sii. Run `pnpm build` first.
//
//   node .claude/skills/run-sii/driver.mjs home [--seed] [--reset]
//   node .claude/skills/run-sii/driver.mjs cli [--live] <sii args...>
//   node .claude/skills/run-sii/driver.mjs mcp tools | resources
//   node .claude/skills/run-sii/driver.mjs mcp call <tool> ['<json args>'] [--live]
//   node .claude/skills/run-sii/driver.mjs mcp read <uri>
//   node .claude/skills/run-sii/driver.mjs core whoami
//   node .claude/skills/run-sii/driver.mjs smoke
//
// Every surface runs with SII_HOME = an isolated scratch dir (SII_RUN_HOME, else
// <tmpdir>/sii-run-skill), so a session, latch or audit line never lands in ~/.sii.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The skill dir is reached through the .claude/skills symlink or .agents/skills directly;
// either way the repo root is three levels up from the REAL file.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = join(ROOT, 'packages/cli/dist/main.js');
const MCP = join(ROOT, 'packages/mcp/dist/main.js');
const CORE = join(ROOT, 'packages/core/dist');
const HOME = process.env.SII_RUN_HOME ?? join(tmpdir(), 'sii-run-skill');

// Commands that never leave the machine. Anything else reaches production SII, so it
// needs an explicit --live: a request on the scratch home carries no real session, and a
// login attempt counts toward SII's account lock.
const OFFLINE_CLI = [
  ['--help'], ['-h'], ['--version'], ['-V'], ['help'],
  ['auth', 'status'], ['operate'], ['--human', 'auth', 'status'], ['--human', 'operate'],
];
const OFFLINE_MCP_TOOLS = new Set(['auth_status', 'operate']);

function die(msg, code = 1) {
  process.stderr.write(`driver: ${msg}\n`);
  process.exit(code);
}

function ensureBuilt() {
  for (const f of [CLI, MCP, join(CORE, 'index.js')]) {
    if (!existsSync(f)) die(`${f} missing; run \`pnpm build\` at the repo root first`);
  }
}

function ensureHome({ reset = false } = {}) {
  if (resolve(HOME) === resolve(homedir(), '.sii')) die('refusing to use ~/.sii as the driver home');
  if (reset) rmSync(HOME, { recursive: true, force: true });
  mkdirSync(HOME, { recursive: true });
  return HOME;
}

const env = () => ({ ...process.env, SII_HOME: ensureHome() });

async function seed() {
  // SII_HOME is read when the runtime is built, so set it before createNodeRuntime().
  process.env.SII_HOME = ensureHome();
  const { createNodeRuntime } = await import(pathToFileURL(join(CORE, 'node.js')).href);
  const { testing } = await import(pathToFileURL(join(CORE, 'index.js')).href);
  // Synthetic, Mod-11-valid RUT (CONVENTIONS: never real PII). Cookies are empty, so the
  // session only satisfies LOCAL reads; anything that reaches SII will bounce.
  await testing.seedSession(createNodeRuntime(), { rut: '11111111-1' });
}

function isOffline(args) {
  const a = args.filter((x) => x !== '--json');
  if (a.includes('--refresh')) return false; // auth status --refresh reads Mi SII live
  return OFFLINE_CLI.some((p) => p.every((t, i) => a[i] === t)) || a.includes('--help') || a.includes('-h');
}

function runCli(args, { live = false } = {}) {
  if (!live && !isOffline(args)) die(`\`sii ${args.join(' ')}\` reaches production SII; pass --live to run it`);
  const r = spawnSync(process.execPath, [CLI, ...args], { env: env(), encoding: 'utf8' });
  return { exitCode: r.status, stdout: r.stdout, stderr: r.stderr };
}

// Minimal MCP client: newline-delimited JSON-RPC over the server's stdio.
async function withMcp(fn) {
  const child = spawn(process.execPath, [MCP], { env: env(), stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let stderr = '';
  let nextId = 1;
  const pending = new Map();
  child.stderr.on('data', (d) => (stderr += d));
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    }
  });
  const send = (o) => child.stdin.write(`${JSON.stringify(o)}\n`);
  const request = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { resolve: res, reject: rej });
      send({ jsonrpc: '2.0', id, method, params });
      setTimeout(() => pending.has(id) && rej(new Error(`${method} timed out; stderr: ${stderr}`)), 15000);
    });
  try {
    const init = await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'run-sii-driver', version: '0' },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return await fn(request, init);
  } finally {
    child.stdin.end();
    child.kill();
  }
}

// Direct invocation: a domain task against the core's in-memory fakes. No SII, no fs.
async function coreWhoami() {
  const core = await import(pathToFileURL(join(CORE, 'index.js')).href);
  const { testing, whoami, HOSTS } = core;
  const datos = () => ({
    contribuyente: { rut: 20000042, dv: '0', nombres: 'Juan Sintético', apellidoPaterno: 'Pérez', apellidoMaterno: 'Soto', eMail: 'sintetico@example.cl' },
  });
  const driver = new testing.FakePortalDriver({ restoreSession: { landingUrl: HOSTS.miSii, datos } });
  const rt = {
    clock: new testing.FixedClock(new Date('2026-10-22T12:00:00Z')),
    audit: new testing.RecordingAuditSink(),
    store: new testing.InMemoryKeyValueStore(),
    portal: driver,
  };
  await testing.seedSession(rt, { rut: '20000042-0' });
  const result = await whoami(rt);
  return { result, restoreCalls: driver.restoreCalls, audit: rt.audit.entries };
}

const print = (o) => process.stdout.write(`${typeof o === 'string' ? o : JSON.stringify(o, null, 2)}\n`);

async function smoke() {
  const checks = [];
  const check = (name, ok, detail = '') => {
    checks.push(ok);
    print(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  };
  ensureHome({ reset: true });

  const v = runCli(['--version']);
  check('cli --version', v.exitCode === 0 && /^\d+\.\d+\.\d+/.test(v.stdout), v.stdout.trim());
  let s = runCli(['auth', 'status']);
  check('cli auth status (empty home) → not authenticated', s.exitCode === 0 && JSON.parse(s.stdout).authenticated === false);
  await seed();
  s = runCli(['auth', 'status']);
  check('cli auth status (seeded) → 11111111-1', s.exitCode === 0 && JSON.parse(s.stdout).rut === '11111111-1');
  const h = runCli(['--human', 'operate', '--list']);
  check('cli --human operate --list', h.exitCode === 0 && h.stderr.includes('operating as:'), h.stdout.trim());

  await withMcp(async (request, init) => {
    check('mcp initialize', !!init.serverInfo, `${init.serverInfo.name} ${init.serverInfo.version}`);
    const { tools } = await request('tools/list');
    check('mcp tools/list', tools.length > 20, `${tools.length} tools`);
    // The auth/operate tools in server.ts answer Spanish text, not JSON (the domain tools
    // and the sii:// resources are JSON) — so match the formatted RUT.
    const st = await request('tools/call', { name: 'auth_status', arguments: {} });
    check('mcp auth_status (seeded)', st.content[0].text.includes('11.111.111-1'), st.content[0].text.split('\n')[0]);
    const res = await request('resources/read', { uri: 'sii://operating' });
    check('mcp read sii://operating', res.contents[0].text.includes('11111111-1'));
  });

  const w = await coreWhoami();
  check('core whoami vs fakes', w.result.rut === '20000042-0' && w.result.nombre?.includes('Sintético'), JSON.stringify(w.result));
  check('core whoami audit carries no PII', !JSON.stringify(w.audit).includes('Sintético'));

  const failed = checks.filter((c) => !c).length;
  print(`\n${checks.length - failed}/${checks.length} passed (SII_HOME=${HOME})`);
  process.exit(failed ? 1 : 0);
}

const [cmd, ...rest] = process.argv.slice(2);
ensureBuilt();
switch (cmd) {
  case 'home': {
    ensureHome({ reset: rest.includes('--reset') });
    if (rest.includes('--seed')) await seed();
    print(HOME);
    break;
  }
  case 'cli': {
    const live = rest[0] === '--live';
    const r = runCli(live ? rest.slice(1) : rest, { live });
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    process.exit(r.exitCode ?? 1);
  }
  case 'mcp': {
    const [sub, a, b] = rest;
    const live = rest.includes('--live');
    await withMcp(async (request) => {
      if (sub === 'tools') print((await request('tools/list')).tools.map((t) => t.name).join('\n'));
      else if (sub === 'resources') print((await request('resources/list')).resources.map((r) => r.uri).join('\n'));
      else if (sub === 'read') print((await request('resources/read', { uri: a })).contents);
      else if (sub === 'call') {
        if (!live && !OFFLINE_MCP_TOOLS.has(a)) die(`tool ${a} may reach production SII; pass --live to call it`);
        const args = b && b !== '--live' ? JSON.parse(b) : {};
        if (!live && a === 'auth_status' && args.refresh) die('auth_status refresh reads Mi SII live; pass --live');
        print(await request('tools/call', { name: a, arguments: args }));
      } else die('mcp: tools | resources | read <uri> | call <tool> [json] [--live]');
    });
    break;
  }
  case 'core': {
    if (rest[0] !== 'whoami') die('core: whoami');
    print(await coreWhoami());
    break;
  }
  case 'smoke':
    await smoke();
    break;
  default:
    die('usage: home [--seed] [--reset] | cli [--live] <args> | mcp … | core whoami | smoke');
}
