// `sii bienes-raices …` — the predios whose contribuciones you pay, from Mi SII (ADR-032). Thin
// call into the @albertomarturelo/sii-core task (ADR-003). Session-keyed (ADR-005): no `--rut`.
import type { Command } from 'commander';
import {
  bienesRaicesList,
  formatMoney,
  formatRut as fmtRut,
  type Runtime,
} from '@albertomarturelo/sii-core';
import { emit, out } from '../io.js';

export function registerBienesRaices(program: Command, runtime: Runtime): void {
  const br = program
    .command('bienes-raices')
    .description('Bienes raíces: predios y cuotas de contribuciones por pagar (Mi SII).');

  br.command('list')
    .description(
      'Session-keyed (tus propios predios; para una empresa, inicia sesión como ella). Los ' +
        'predios por los que pagas contribuciones habitualmente (seas o no el propietario), ' +
        'con sus cuotas por pagar: vencidas y vigentes, fecha de vencimiento y total a pagar. ' +
        'Una consulta al SII, solo lectura. Expone la dirección de cada predio (dato personal).',
    )
    .action(async () => {
      const r = await bienesRaicesList(runtime);
      emit(r, () => {
        out(`Bienes raíces — ${fmtRut(r.rut)}`);
        if (r.predios.length === 0) {
          out('  Sin predios por los que pagues contribuciones.');
          return;
        }
        for (const p of r.predios) {
          out(
            `\n  Rol ${p.rol}  ${p.comuna.nombre ?? `comuna ${p.comuna.codigo}`}  ` +
              `${p.direccion ?? '—'}  ${p.destino ?? ''}`,
          );
          out(`  Cuotas por pagar: ${p.cuotasVencidas} vencidas, ${p.cuotasVigentes} vigentes`);
          for (const c of p.cuotas) {
            out(
              `    ${c.anio ?? '?'}-${c.cuota ?? '?'}  ${c.condicion ?? '—'}  ` +
                `vence ${c.fechaVencimiento ?? '—'}  $${formatMoney(c.totalPago)}`,
            );
          }
        }
      });
    });
}
