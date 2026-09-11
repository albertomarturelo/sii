// `sii carpeta …` — Carpeta Tributaria. Thin calls into @albertomarturelo/sii-core tasks (ADR-003).
// SESSION-KEYED (ADR-005): reads the session principal's own Carpeta; no `--rut`. #110 ships
// `instituciones` (the live `enfinCodigo` catalog); #109 adds `regular` (the PDF, ADR-022).
import type { Command } from 'commander';
import { carpetaInstituciones, type Runtime } from '@albertomarturelo/sii-core';
import { emit, out } from '../io.js';

export function registerCarpeta(program: Command, runtime: Runtime): void {
  const carpeta = program
    .command('carpeta')
    .description(
      'Session-keyed. Carpeta Tributaria del titular de la sesión (para una empresa, inicia ' +
        'sesión como ella).',
    );

  carpeta
    .command('instituciones')
    .description(
      'Session-keyed. Lista VIGENTE de instituciones destinatarias de la Carpeta Tributaria ' +
        'Regular (el código que exige `carpeta regular --institucion`). Se lee del SII en cada ' +
        'llamada: los códigos cambian y no existe un catálogo local.',
    )
    .action(async () => {
      const res = await carpetaInstituciones(runtime);
      emit(res, () => {
        if (res.length === 0) {
          out('El SII no devolvió instituciones.');
          return;
        }
        out('Instituciones destinatarias — Carpeta Tributaria Regular (lista vigente del SII)');
        out(`  ${'Código'.padEnd(8)} ${'Abrev.'.padEnd(12)} Descripción`);
        for (const i of res) {
          out(
            `  ${i.codigo.padEnd(8)} ${(i.abreviacion ?? '—').padEnd(12)} ${i.descripcion ?? '—'}`,
          );
        }
        out(`${res.length} institución(es).`);
      });
    });
}
