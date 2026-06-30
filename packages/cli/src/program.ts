// The `sii` command tree (commander, ADR-008). Every action is a thin call into a
// @altumstack/sii-core task — the CLI never reaches past the task layer (ADR-003). The Runtime
// is injected so tests drive the whole tree against fakes (no SII touched).
import { Command } from 'commander';
import {
  LoginFailedError,
  Rut,
  authStatus,
  formatOperableEntry,
  listOperable,
  login,
  logout,
  operate,
  operateSelf,
  operatingStatus,
  statusRefresh,
  type Runtime,
} from '@altumstack/sii-core';
// CLI-only credential login (takes a Clave) — kept off the main barrel so MCP
// can't wire it (ADR-006 / ADR-010).
import { consoleLogin } from '@altumstack/sii-core/cli';
import { emit, out, setOutputMode, withOutputFlags } from './io.js';
import { printOperatingHeader } from './operating-header.js';
import { nodePrompters, type Prompters } from './prompt.js';
// Domain read surfaces — each module owns a commands/<mod>.ts register fn (append-only).
import { registerRcv } from './commands/rcv.js';
import { registerF22 } from './commands/f22.js';
import { registerF29 } from './commands/f29.js';
import { registerDte } from './commands/dte.js';
import { registerBte } from './commands/bte.js';

const fmt = (canonicalRut: string): string => Rut.parse(canonicalRut).formatted;

function describeOperating(rut: string, isSelf: boolean, razonSocial: string | null): string {
  if (isSelf) return `Operando como tú mismo: ${fmt(rut)}.`;
  return `Operando como ${fmt(rut)}${razonSocial ? ` (${razonSocial})` : ''}.`;
}

export function buildProgram(runtime: Runtime, prompters: Prompters = nodePrompters): Command {
  const program = new Command();
  program
    .name('sii')
    .description('CLI para automatizar trámites del SII (Chile).')
    .version('0.0.0');
  // Output is JSON by default (the @altumstack/sii-core data contract); `--human` for readable text.
  // Declared on the root so `sii --human <cmd>` parses; `withOutputFlags` adds them to each
  // leaf too so `sii <cmd> --human` parses as well.
  withOutputFlags(program);

  // Resolve the output mode from the flags, then (human mode only) print the always-visible
  // operating-as header (ADR-005). In JSON mode the header is omitted — STDOUT is pure JSON
  // and the operating RUT is already a field in every result.
  program.hook('preAction', async (_thisCommand, actionCommand) => {
    setOutputMode(actionCommand.optsWithGlobals().human ? 'human' : 'json');
    await printOperatingHeader(runtime);
  });

  const auth = program.command('auth').description('Autenticación y sesión.');

  auth
    .command('login')
    .description(
      'Inicia sesión con Clave Tributaria (navegador por defecto; --console por terminal).',
    )
    .option(
      '--console',
      'Introduce RUT y Clave por la terminal (sin navegador); guarda solo cookies.',
    )
    .option('--rut <rut>', 'RUT para el login por consola (si se omite, se pregunta).')
    .action(async (opts: { console?: boolean; rut?: string }) => {
      if (opts.console) {
        // Validate the RUT (Mod-11) LOCALLY before any attempt — a malformed RUT must
        // never become a wasted login that counts toward account lockout (ADR-004).
        const rutInput = opts.rut ?? (await prompters.line('RUT: '));
        const rut = Rut.parse(rutInput).canonical;
        // The Clave is ALWAYS prompted (hidden) — never a flag/arg (ADR-010).
        const clave = await prompters.hidden('Clave: ');
        if (!clave) throw new LoginFailedError('Clave vacía. No se intentó iniciar sesión.');
        const result = await consoleLogin(runtime, { rut, clave });
        emit(result, () =>
          out(
            result.reason === 'already_authenticated'
              ? `Ya tienes una sesión activa como ${fmt(result.rut)}.`
              : `Sesión iniciada como ${fmt(result.rut)}.`,
          ),
        );
        return;
      }
      const result = await login(runtime);
      emit(result, () =>
        out(
          result.reason === 'already_authenticated'
            ? `Ya tienes una sesión activa como ${fmt(result.rut)}.`
            : `Sesión iniciada como ${fmt(result.rut)}.`,
        ),
      );
    });

  auth
    .command('status')
    .description('Muestra la sesión actual (lectura local).')
    .option('--refresh', 'Lee la identidad desde el portal (requiere sesión viva).')
    .action(async (opts: { refresh?: boolean }) => {
      if (opts.refresh) {
        const id = await statusRefresh(runtime);
        emit(id, () => {
          out(`RUT:    ${fmt(id.rut)}`);
          out(`Nombre: ${id.nombre ?? '—'}`);
          out(`Tipo:   ${id.accountType}`);
        });
        return;
      }
      const status = await authStatus(runtime);
      const ctx = status.authenticated && status.rut ? await operatingStatus(runtime) : null;
      emit({ ...status, operating: ctx }, () => {
        if (!status.authenticated || !status.rut) {
          out('No autenticado. Ejecuta `sii auth login`.');
          return;
        }
        out(`Autenticado (sesión local) como ${fmt(status.rut)}.`);
        if (ctx && !ctx.isSelf)
          out(describeOperating(ctx.operatingRut, ctx.isSelf, ctx.razonSocial));
      });
    });

  auth
    .command('logout')
    .description('Cierra la sesión (servidor, mejor esfuerzo + limpieza local).')
    .action(async () => {
      const result = await logout(runtime);
      emit(result, () => {
        if (!result.loggedOut) {
          out('No había sesión activa.');
          return;
        }
        out(result.serverClosed ? 'Sesión cerrada (servidor y local).' : 'Sesión cerrada (local).');
      });
    });

  program
    .command('operate')
    .description('Selecciona el RUT bajo el que operas (tú mismo o una empresa representada).')
    .argument('[rut]', 'RUT de la empresa a representar (del conjunto operable).')
    .option('--self', 'Vuelve a operar como tú mismo.')
    .option('--list', 'Lista los RUT operables (tú mismo + empresas representadas).')
    .action(async (rutArg: string | undefined, opts: { self?: boolean; list?: boolean }) => {
      if (opts.list) {
        const result = await listOperable(runtime);
        emit(result ?? { operable: null }, () => {
          if (!result) {
            out('No hay sesión activa. Ejecuta `sii auth login`.');
            return;
          }
          for (const e of result.operable) out(formatOperableEntry(e, result.operatingRut));
        });
        return;
      }
      if (opts.self) {
        const result = await operateSelf(runtime);
        emit(result.context, () => out(describeOperating(result.context.selfRut, true, null)));
        return;
      }
      if (rutArg) {
        const result = await operate(runtime, rutArg);
        const { operatingRut, isSelf, razonSocial } = result.context;
        emit(result.context, () => out(describeOperating(operatingRut, isSelf, razonSocial)));
        return;
      }
      // No argument: report the current operating context.
      const ctx = await operatingStatus(runtime);
      emit(ctx ?? { operating: null }, () => {
        if (!ctx) {
          out('No hay sesión activa. Ejecuta `sii auth login`.');
          return;
        }
        out(describeOperating(ctx.operatingRut, ctx.isSelf, ctx.razonSocial));
      });
    });

  // --- domain read surfaces (one register call per module — append-only) ---
  registerRcv(program, runtime);
  registerF22(program, runtime);
  registerF29(program, runtime);
  registerDte(program, runtime);
  registerBte(program, runtime);

  // Make `--json`/`--human` parse after a subcommand too (`sii f22 status --human`), by
  // adding them to every leaf command — after the register fns have built their subtrees.
  addOutputFlagsToLeaves(program);
  return program;
}

/** Add the global output flags to every leaf (action) command in the tree. */
function addOutputFlagsToLeaves(cmd: Command): void {
  if (cmd.commands.length === 0) {
    withOutputFlags(cmd);
    return;
  }
  for (const sub of cmd.commands) addOutputFlagsToLeaves(sub);
}
