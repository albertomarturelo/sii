// The `sii` command tree (commander, ADR-008). Every action is a thin call into a
// @albertomarturelo/sii-core task — the CLI never reaches past the task layer (ADR-003). The Runtime
// is injected so tests drive the whole tree against fakes (no SII touched).
import { createRequire } from 'node:module';
import { Command } from 'commander';
import {
  LoginFailedError,
  Rut,
  ValidationError,
  authStatus,
  describeOperating,
  formatOperableEntry,
  formatRut as fmt,
  listOperable,
  logout,
  operate,
  operateSelf,
  operatingStatus,
  statusRefresh,
  type AuthWww2Status,
  type LoginBlockEntry,
  type Runtime,
} from '@albertomarturelo/sii-core';
// CLI-only credential login (takes a Clave) — kept off the main barrel so MCP
// can't wire it (ADR-006 / ADR-010).
import {
  consoleLogin,
  keyringLogin,
  suppliedClaveLogin,
  unblockLogin,
} from '@albertomarturelo/sii-core/cli';
import { emit, out, setOutputMode, withOutputFlags } from './io.js';

/** One human line for the www2 app-session layer (ADR-026). */
const www2Line = (w: AuthWww2Status): string =>
  w.authenticated
    ? `Sesión www2: activa${w.expiresAt ? ` (hasta ${w.expiresAt})` : ''}.`
    : 'Sesión www2: no iniciada (la Carpeta Tributaria se usa desde el MCP; ADR-027).';

/** One human line per latched RUT (ADR-028), or nothing: the common case has no block. */
const blockedLines = (blocked: readonly LoginBlockEntry[]): string[] =>
  blocked.map(
    (b) =>
      `Login desatendido bloqueado para ${fmt(b.rut)} desde ${b.at}` +
      `${b.codigo ? ` (el SII rechazó la Clave, código ${b.codigo})` : ''}. ` +
      'Corrige la Clave y ejecuta `sii auth login --console` o `sii auth unblock`.',
  );

import { printOperatingHeader } from './operating-header.js';
import { nodePrompters, type Prompters } from './prompt.js';
// Domain read surfaces — each module owns a commands/<mod>.ts register fn (append-only).
import { registerWhoami } from './commands/whoami.js';
import { registerRcv } from './commands/rcv.js';
import { registerF22 } from './commands/f22.js';
import { registerF29 } from './commands/f29.js';
import { registerDte } from './commands/dte.js';
import { registerBte } from './commands/bte.js';
import { registerPeticiones } from './commands/peticiones.js';

// The published version, read from this package's own package.json at runtime (one
// level up from dist/) so `sii --version` never drifts from the release.
const pkgVersion = (createRequire(import.meta.url)('../package.json') as { version: string })
  .version;

export function buildProgram(runtime: Runtime, prompters: Prompters = nodePrompters): Command {
  const program = new Command();
  program
    .name('sii')
    .description('CLI para automatizar trámites del SII (Chile).')
    .version(pkgVersion);
  // Output is JSON by default (the @albertomarturelo/sii-core data contract); `--human` for readable text.
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
      'Inicia sesión con Clave Tributaria, sin navegador (ADR-027): introduces RUT y Clave por ' +
        'la terminal y se guardan solo cookies. --keyring lee la Clave del llavero del sistema; ' +
        '--clave-env / --clave-stdin la reciben sin terminal (uso desatendido, ADR-028). Si ya ' +
        'hay una sesión viva para ese RUT no se envía nada. El login con navegador y la sesión ' +
        'www2 (Carpeta Tributaria) viven en el MCP, no en el CLI.',
    )
    .option(
      '--console',
      'Introduce RUT y Clave por la terminal (es el comportamiento por defecto; alias explícito).',
    )
    .option(
      '--keyring',
      'Lee la Clave del llavero del sistema: servicio "sii", username = tu RUT. ' +
        "Guárdala con: secret-tool store --label='SII' service sii username <rut> (Linux) " +
        'o security add-generic-password -s sii -a <rut> -w (macOS). Con --keyring, si ' +
        'omites --rut se usa el RUT de la última sesión local; nunca pregunta (uso desatendido).',
    )
    .option(
      '--clave-env <VAR>',
      'Lee la Clave de la variable de entorno VAR (sin nombre por defecto) y la borra del ' +
        'entorno tras leerla. Requiere --rut. Para agentes y cron: provisiona la variable desde ' +
        'el campo de secretos de la plataforma; nunca la imprimas.',
    )
    .option(
      '--clave-stdin',
      'Lee la Clave de stdin (una línea; p. ej. `--clave-stdin < archivo`). Requiere --rut. ' +
        'Se rechaza si stdin es una terminal: para eso está --console.',
    )
    .option('--rut <rut>', 'RUT para el login (por consola, si se omite, se pregunta).')
    .action(
      async (opts: {
        console?: boolean;
        keyring?: boolean;
        claveEnv?: string;
        claveStdin?: boolean;
        rut?: string;
      }) => {
        // One named source per invocation, and never a fallback from one to another (ADR-028):
        // the Clave's origin must be legible on the command line.
        const sources = [
          opts.console && '--console',
          opts.keyring && '--keyring',
          opts.claveEnv !== undefined && '--clave-env',
          opts.claveStdin && '--clave-stdin',
        ].filter(Boolean);
        if (sources.length > 1) {
          throw new ValidationError(
            `Usa una sola fuente para la Clave; recibí ${sources.join(' y ')}.`,
          );
        }

        if (opts.claveEnv !== undefined || opts.claveStdin) {
          // No prompt on these paths, so the RUT must be explicit — and Mod-11-checked before
          // anything is read or sent (ADR-004).
          if (!opts.rut) {
            throw new ValidationError(`${sources[0]} requiere --rut <rut> (no se pregunta).`);
          }
          const rut = Rut.parse(opts.rut).canonical;
          const source = opts.claveEnv !== undefined ? 'env' : 'stdin';
          const clave =
            opts.claveEnv !== undefined
              ? readClaveEnv(prompters, opts.claveEnv)
              : await readClaveStdin(prompters);
          const result = await suppliedClaveLogin(runtime, { rut, clave, source });
          emit(result, () =>
            out(
              result.reason === 'already_authenticated'
                ? `Ya tienes una sesión activa como ${fmt(result.rut)}.`
                : `Sesión iniciada como ${fmt(result.rut)} (Clave leída de ${
                    source === 'env' ? `$${opts.claveEnv}` : 'stdin'
                  }).`,
            ),
          );
          return;
        }

        if (opts.keyring) {
          // --keyring exists for SCRIPTED, unattended use (ADR-025), so it must never block
          // on a prompt: without --rut it falls back to the last local session's RUT, and
          // failing that it says which flag to pass. The RUT is Mod-11-checked in the task,
          // so a typo never becomes a failed SII attempt (ADR-004). ONE attempt, no retry.
          const rutInput = opts.rut ?? (await authStatus(runtime)).rut;
          if (!rutInput) {
            throw new ValidationError(
              'No hay sesión local previa de la que tomar el RUT. Indica `--rut <rut>`.',
            );
          }
          const result = await keyringLogin(runtime, { rut: rutInput });
          emit(result, () =>
            out(
              result.reason === 'already_authenticated'
                ? `Ya tienes una sesión activa como ${fmt(result.rut)}.`
                : `Sesión iniciada como ${fmt(result.rut)} (Clave leída del llavero).`,
            ),
          );
          return;
        }
        // Default (and the explicit --console alias): the HTTP console login (ADR-027). No browser.
        // Validate the RUT (Mod-11) LOCALLY before any attempt — a malformed RUT must never
        // become a wasted login that counts toward account lockout (ADR-004).
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
      },
    );

  auth
    .command('unblock')
    .description(
      'Levanta el bloqueo de login desatendido (ADR-028): tras un rechazo de Clave, ' +
        '--clave-env / --clave-stdin / --keyring se niegan sin contactar al SII hasta un login ' +
        'por consola exitoso o este comando. Local: no envía nada al SII. Corrige antes la Clave. ' +
        'Solo desde una terminal: un agente o un cron no puede levantar el bloqueo.',
    )
    .option('--rut <rut>', 'Solo para este RUT (por defecto, todos).')
    .action(async (opts: { rut?: string }) => {
      // The latch exists so an unattended caller cannot retry a stale Clave; if that same
      // caller could lift it, it would protect nothing. So the reset needs a human at a TTY,
      // by construction rather than by a line in the agent's instructions (ADR-028).
      if (!prompters.interactive()) {
        throw new ValidationError(
          '`sii auth unblock` solo se ejecuta desde una terminal: levantar el bloqueo le ' +
            'corresponde a una persona, después de corregir la Clave. No se levantó nada.',
        );
      }
      const unblocked = await unblockLogin(
        runtime,
        opts.rut === undefined ? {} : { rut: opts.rut },
      );
      emit({ unblocked }, () =>
        out(
          unblocked.length > 0
            ? `Bloqueo levantado para ${unblocked.map(fmt).join(', ')}.`
            : 'No había bloqueo de login.',
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
          out(www2Line(id.www2));
        });
        return;
      }
      const status = await authStatus(runtime);
      const ctx = status.authenticated && status.rut ? await operatingStatus(runtime) : null;
      emit({ ...status, operating: ctx }, () => {
        if (!status.authenticated || !status.rut) {
          out('No autenticado. Ejecuta `sii auth login`.');
        } else {
          out(`Autenticado (sesión local) como ${fmt(status.rut)}.`);
          if (ctx && !ctx.isSelf) out(describeOperating(ctx));
          out(www2Line(status.www2));
        }
        for (const line of blockedLines(status.loginBlocked)) out(line);
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
        if (result.www2Closed) out('Sesión www2 cerrada.');
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
        emit(result.context, () => out(describeOperating(result.context)));
        return;
      }
      if (rutArg) {
        const result = await operate(runtime, rutArg);
        emit(result.context, () => out(describeOperating(result.context)));
        return;
      }
      // No argument: report the current operating context.
      const ctx = await operatingStatus(runtime);
      emit(ctx ?? { operating: null }, () => {
        if (!ctx) {
          out('No hay sesión activa. Ejecuta `sii auth login`.');
          return;
        }
        out(describeOperating(ctx));
      });
    });

  // --- domain read surfaces (one register call per module — append-only) ---
  registerWhoami(program, runtime);
  registerRcv(program, runtime);
  registerF22(program, runtime);
  registerF29(program, runtime);
  registerDte(program, runtime);
  registerBte(program, runtime);
  registerPeticiones(program, runtime);

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

// An environment variable NAME, shell-style. The name is required (no default, ADR-028): an
// implicit source could pick up a leftover value from some other tool.
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/** `--clave-env <VAR>`: read, then delete from the environment at once so no child process
 *  inherits it. Errors name the VARIABLE, never the value, and nothing reaches SII. */
function readClaveEnv(prompters: Prompters, name: string): string {
  if (!ENV_NAME.test(name)) {
    // Never echo `name`: the likeliest mistake is passing the Clave ITSELF as the argument,
    // and repeating it would put it in the terminal scrollback or the agent's transcript.
    throw new ValidationError(
      '--clave-env espera el NOMBRE de una variable (A-Z, 0-9, _; p. ej. SII_CLAVE), no su ' +
        'valor. No se intentó iniciar sesión.',
    );
  }
  const clave = prompters.env[name];
  delete prompters.env[name];
  if (!clave) {
    throw new LoginFailedError(
      `La variable ${name} no está definida o está vacía. No se intentó iniciar sesión.`,
    );
  }
  return clave;
}

/** `--clave-stdin`: the first line of piped stdin, one trailing `\n`/`\r\n` stripped. */
async function readClaveStdin(prompters: Prompters): Promise<string> {
  const raw = await prompters.piped();
  if (raw === null) {
    throw new ValidationError(
      '--clave-stdin necesita la Clave por una tubería o redirección, no una terminal. ' +
        'En una terminal usa `sii auth login --console`.',
    );
  }
  const clave = raw.split('\n')[0]?.replace(/\r$/, '') ?? '';
  if (!clave) throw new LoginFailedError('Clave vacía en stdin. No se intentó iniciar sesión.');
  return clave;
}
