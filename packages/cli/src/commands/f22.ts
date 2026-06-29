// `sii f22 …` — Declaración Anual de Renta (estado). Thin calls into @sii/core tasks
// (ADR-003). SESSION-KEYED (ADR-005): always reads the session principal — NO `--rut`;
// a represented empresa's F22 is reached by logging in AS the empresa (logout→login).
import type { Command } from 'commander';
import { Rut, ValidationError, f22Overview, f22Status, type Runtime } from '@sii/core';
import { out } from '../io.js';

const money = (n: number | null): string => (n === null ? '—' : n.toLocaleString('es-CL'));
const fmtRut = (canonical: string): string => Rut.parse(canonical).formatted;

export function registerF22(program: Command, runtime: Runtime): void {
  const f22 = program.command('f22').description('Declaración Anual de Renta (F22).');

  f22
    .command('status')
    .description('Estado de la F22. Sin año: resumen de los últimos años; con año: detalle.')
    .argument('[año]', 'Año tributario (YYYY). Si se omite, muestra el resumen multi-año.')
    .option('--folio <n>', 'Folio específico de la declaración (por defecto: la vigente).')
    .option('--years <n>', 'Cuántos años incluir en el resumen (por defecto 5).')
    .action(async (anioArg: string | undefined, opts: { folio?: string; years?: string }) => {
      if (!anioArg) {
        // `--folio` selects one declaración within a year; it's meaningless for the
        // multi-year overview — reject it instead of silently dropping it.
        if (opts.folio) {
          throw new ValidationError('El --folio requiere indicar el año (YYYY).');
        }
        const ov = await f22Overview(runtime, opts.years ? { years: Number(opts.years) } : {});
        out(`F22 — ${fmtRut(ov.rut)} (estado por año)`);
        for (const a of ov.anios) {
          const decl = a.declaraciones.find((d) => d.vigente) ?? a.declaraciones[0];
          const estado = a.tieneDeclaracion ? (decl?.estado ?? 'presentada') : 'Sin declaración';
          out(`  ${a.anio}  ${estado}`);
        }
        return;
      }
      const e = await f22Status(runtime, {
        anio: anioArg,
        ...(opts.folio ? { folio: opts.folio } : {}),
      });
      out(`F22 ${e.anio} — ${fmtRut(e.rut)}`);
      if (!e.tieneDeclaracion) {
        out('Sin declaración para el año.');
        return;
      }
      out(`Folio: ${e.folio ?? '—'}   Estado: ${e.estado ?? '—'}`);
      for (const c of e.codigos) {
        out(`  ${c.codigo}  ${c.glosa ?? ''}  ${money(c.valor)}`);
      }
      out(`${e.codigos.length} código(s).`);
    });
}
