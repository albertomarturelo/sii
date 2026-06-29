// `sii f29 …` — Declaración Mensual de IVA. Thin calls into @sii/core tasks (ADR-003).
// SESSION-KEYED (ADR-005): always reads the session principal — NO `--rut`; a represented
// empresa's F29 is reached by logging in AS the empresa (logout→login). If the operate
// pointer is set to an empresa, the task rejects with an actionable message.
import type { Command } from 'commander';
import { Rut, f29Draft, f29Status, type CodigoF29, type Runtime } from '@sii/core';
import { emit, out } from '../io.js';

const money = (n: number | null): string => (n === null ? '—' : n.toLocaleString('es-CL'));
const fmtRut = (canonical: string): string => Rut.parse(canonical).formatted;

const printCodigos = (codigos: readonly CodigoF29[]): void => {
  for (const c of codigos) out(`  ${c.codigo}  ${money(c.valor)}`);
};

export function registerF29(program: Command, runtime: Runtime): void {
  const f29 = program.command('f29').description('Declaración Mensual de IVA (F29).');

  f29
    .command('draft')
    .description('Propuesta de IVA (borrador del F29 prellenado por el SII) de un período.')
    .argument('<periodo>', 'Período tributario (YYYYMM o YYYY-MM).')
    .action(async (periodoArg: string) => {
      const p = await f29Draft(runtime, { periodo: periodoArg });
      emit(p, () => {
        out(`F29 ${p.periodo} — ${fmtRut(p.rut)} (propuesta IVA)`);
        if (!p.tienePropuesta) {
          out('Sin propuesta para el período.');
          return;
        }
        printCodigos(p.codigos);
        out(`${p.codigos.length} código(s) propuesto(s).`);
      });
    });

  f29
    .command('status')
    .description('Estado del F29 presentado/guardado de un período.')
    .argument('<periodo>', 'Período tributario (YYYYMM o YYYY-MM).')
    .action(async (periodoArg: string) => {
      const e = await f29Status(runtime, { periodo: periodoArg });
      emit(e, () => {
        out(`F29 ${e.periodo} — ${fmtRut(e.rut)} (estado)`);
        if (!e.tieneDeclaracion) {
          out('Nada presentado para el período.');
          return;
        }
        for (const d of e.declaraciones) {
          out(`  ${d.fecha ?? '—'}  ${d.estado ?? '—'}  folio ${d.folio ?? '—'}`);
        }
        out(`${e.declaraciones.length} declaración(es).`);
      });
    });
}
