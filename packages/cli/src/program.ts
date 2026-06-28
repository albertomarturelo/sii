// The `sii` command tree (commander, ADR-008). Every action is a thin call into a
// @sii/core task — the CLI never reaches past the task layer (ADR-003). The Runtime
// is injected so tests drive the whole tree against fakes (no SII touched).
import { Command } from 'commander';
import {
  Rut,
  authStatus,
  login,
  logout,
  operate,
  operateSelf,
  operatingStatus,
  statusRefresh,
  type Runtime,
} from '@sii/core';
import { out } from './io.js';
import { printOperatingHeader } from './operating-header.js';

const fmt = (canonicalRut: string): string => Rut.parse(canonicalRut).formatted;

function describeOperating(rut: string, isSelf: boolean, razonSocial: string | null): string {
  if (isSelf) return `Operando como tú mismo: ${fmt(rut)}.`;
  return `Operando como ${fmt(rut)}${razonSocial ? ` (${razonSocial})` : ''}.`;
}

export function buildProgram(runtime: Runtime): Command {
  const program = new Command();
  program
    .name('sii')
    .description('CLI para automatizar trámites del SII (Chile).')
    .version('0.0.0');

  // Always-visible operating-as header (ADR-005), before every subcommand action.
  program.hook('preAction', () => printOperatingHeader(runtime));

  const auth = program.command('auth').description('Autenticación y sesión.');

  auth
    .command('login')
    .description('Inicia sesión con Clave Tributaria (abre el navegador en la página del SII).')
    .action(async () => {
      const result = await login(runtime);
      out(
        result.reason === 'already_authenticated'
          ? `Ya tienes una sesión activa como ${fmt(result.rut)}.`
          : `Sesión iniciada como ${fmt(result.rut)}.`,
      );
    });

  auth
    .command('status')
    .description('Muestra la sesión actual (lectura local).')
    .option('--refresh', 'Lee la identidad desde el portal (requiere sesión viva).')
    .action(async (opts: { refresh?: boolean }) => {
      if (opts.refresh) {
        const id = await statusRefresh(runtime);
        out(`RUT:    ${fmt(id.rut)}`);
        out(`Nombre: ${id.nombre ?? '—'}`);
        out(`Tipo:   ${id.accountType}`);
        return;
      }
      const status = await authStatus(runtime);
      if (!status.authenticated || !status.rut) {
        out('No autenticado. Ejecuta `sii auth login`.');
        return;
      }
      out(`Autenticado (sesión local) como ${fmt(status.rut)}.`);
      const ctx = await operatingStatus(runtime);
      if (ctx && !ctx.isSelf) {
        out(describeOperating(ctx.operatingRut, ctx.isSelf, ctx.razonSocial));
      }
    });

  auth
    .command('logout')
    .description('Cierra la sesión (servidor, mejor esfuerzo + limpieza local).')
    .action(async () => {
      const result = await logout(runtime);
      if (!result.loggedOut) {
        out('No había sesión activa.');
        return;
      }
      out(result.serverClosed ? 'Sesión cerrada (servidor y local).' : 'Sesión cerrada (local).');
    });

  program
    .command('operate')
    .description('Selecciona el RUT bajo el que operas (tú mismo o una empresa representada).')
    .argument('[rut]', 'RUT de la empresa a representar (del conjunto operable).')
    .option('--self', 'Vuelve a operar como tú mismo.')
    .action(async (rutArg: string | undefined, opts: { self?: boolean }) => {
      if (opts.self) {
        const result = await operateSelf(runtime);
        out(describeOperating(result.context.selfRut, true, null));
        return;
      }
      if (rutArg) {
        const result = await operate(runtime, rutArg);
        const { operatingRut, isSelf, razonSocial } = result.context;
        out(describeOperating(operatingRut, isSelf, razonSocial));
        return;
      }
      // No argument: report the current operating context.
      const ctx = await operatingStatus(runtime);
      if (!ctx) {
        out('No hay sesión activa. Ejecuta `sii auth login`.');
        return;
      }
      out(describeOperating(ctx.operatingRut, ctx.isSelf, ctx.razonSocial));
    });

  return program;
}
