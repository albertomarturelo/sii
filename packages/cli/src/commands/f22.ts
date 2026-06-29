// `sii f22 …` — Declaración Anual de Renta (estado). Thin calls into @sii/core tasks
// (ADR-003). SESSION-KEYED (ADR-005): always reads the session principal — NO `--rut`;
// a represented empresa's F22 is reached by logging in AS the empresa (logout→login).
import type { Command } from 'commander';
import {
  Rut,
  ValidationError,
  f22Observaciones,
  f22Overview,
  f22Status,
  type CodigoF22,
  type Runtime,
} from '@sii/core';
import { out } from '../io.js';

const money = (n: number | null): string => (n === null ? '—' : n.toLocaleString('es-CL'));
const fmtRut = (canonical: string): string => Rut.parse(canonical).formatted;

const printCodigos = (codigos: readonly CodigoF22[]): void => {
  for (const c of codigos) out(`  ${c.codigo}  ${c.glosa ?? ''}  ${money(c.valor)}`);
};

export function registerF22(program: Command, runtime: Runtime): void {
  const f22 = program.command('f22').description('Declaración Anual de Renta (F22).');

  f22
    .command('status')
    .description('Estado de la F22. Sin año: resumen de los últimos años; con año: detalle.')
    .argument('[año]', 'Año tributario (YYYY). Si se omite, muestra el resumen multi-año.')
    .option('--folio <n>', 'Folio específico de la declaración (por defecto: la vigente).')
    .option('--years <n>', 'Cuántos años incluir en el resumen (por defecto 5).')
    .option('--full', 'Grilla completa agrupada (ingresos, créditos, resultado).')
    .action(
      async (
        anioArg: string | undefined,
        opts: { folio?: string; years?: string; full?: boolean },
      ) => {
        if (!anioArg) {
          // `--folio`/`--full` select/expand one declaración within a year; both are
          // meaningless for the multi-year overview — reject instead of silently dropping.
          if (opts.folio || opts.full) {
            throw new ValidationError('El --folio/--full requieren indicar el año (YYYY).');
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
          ...(opts.full ? { full: true } : {}),
        });
        out(`F22 ${e.anio} — ${fmtRut(e.rut)}`);
        if (!e.tieneDeclaracion) {
          out('Sin declaración para el año.');
          return;
        }
        out(`Folio: ${e.folio ?? '—'}   Estado: ${e.estado ?? '—'}`);
        if (e.grupos) {
          // `--full`: the complete form (PII dropped) organized for a contador. Empty
          // groups are still labeled so the structure is predictable; `otros` (non-PII,
          // unclassified) only prints when it has rows.
          out('Ingresos:');
          printCodigos(e.grupos.ingresos);
          out('Deducciones:');
          printCodigos(e.grupos.deducciones);
          out('Retenciones · PPM · Créditos:');
          printCodigos(e.grupos.creditos);
          out('Resultado:');
          printCodigos(e.grupos.resultado);
          if (e.grupos.otros.length) {
            out('Otros:');
            printCodigos(e.grupos.otros);
          }
        } else {
          printCodigos(e.codigos);
        }
        out(`${e.codigos.length} código(s).`);
      },
    );

  f22
    .command('observaciones')
    .description('Observaciones (inconsistencias) de la F22 de un año tributario.')
    .argument('<año>', 'Año tributario (YYYY).')
    .option('--folio <n>', 'Folio específico de la declaración (por defecto: la vigente).')
    .action(async (anioArg: string, opts: { folio?: string }) => {
      const r = await f22Observaciones(runtime, {
        anio: anioArg,
        ...(opts.folio ? { folio: opts.folio } : {}),
      });
      out(`F22 ${r.anio} — ${fmtRut(r.rut)} (observaciones)`);
      if (!r.tieneDeclaracion) {
        out('Sin declaración para el año.');
        return;
      }
      if (r.observaciones.length === 0) {
        out('Sin observaciones.');
        return;
      }
      for (const o of r.observaciones) {
        out(`  ${o.codigo}  ${o.descripcion ?? ''}`);
        if (o.url) out(`        ${o.url}`);
      }
      out(`${r.observaciones.length} observación(es).`);
    });
}
