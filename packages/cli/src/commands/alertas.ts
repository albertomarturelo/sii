// `sii alertas` — what SII holds against you but does not push (ADR-030). A thin call into the
// @albertomarturelo/sii-core task (ADR-003); the source list and the date are parsed there, so
// the CLI and the MCP share one meaning. Session-keyed (ADR-005): no `--rut`.
import type { Command } from 'commander';
import {
  alertas,
  formatMoney,
  formatRut as fmtRut,
  type Alerta,
  type Runtime,
} from '@albertomarturelo/sii-core';
import { emit, out } from '../io.js';

/** What the alerta is about, in one short label. */
function sobre(a: Alerta): string {
  if (a.periodo) return `F29 ${a.periodo}`;
  if (a.anio) return `F22 ${a.anio}`;
  if (a.peticion !== null) return `petición #${a.peticion}`;
  if (a.contribucion) return `rol ${a.contribucion.rol} cuota ${a.contribucion.cuota}`;
  return a.origen;
}

function linea(a: Alerta): string {
  switch (a.tipo) {
    case 'f22_observacion':
      return `observación ${a.codigo ?? '—'}${a.mensaje ? `: ${a.mensaje}` : ''}`;
    case 'f29_sin_declarar':
      return (
        `sin declarar; con pago venció el ${a.vencimiento?.conPago ?? a.fecha ?? '—'}, ` +
        `sin pago vence el ${a.vencimiento?.sinPago ?? '—'} (fecha estimada)`
      );
    case 'contribuciones_vencida':
    case 'contribuciones_por_vencer':
      return (
        `contribuciones ${a.tipo === 'contribuciones_vencida' ? 'vencida' : 'por vencer'}` +
        `${a.contribucion?.comuna ? ` (${a.contribucion.comuna})` : ''}, ` +
        `total $${formatMoney(a.contribucion?.monto ?? null)}`
      );
    default:
      return `${a.estado ?? '—'}${a.mensaje ? `: ${a.mensaje}` : ''}`;
  }
}

export function registerAlertas(program: Command, runtime: Runtime): void {
  program
    .command('alertas')
    .description(
      'Session-keyed (tus propias alertas; para una empresa, inicia sesión como ella). Lo que ' +
        'el SII registra y no avisa: observaciones del F22 (últimos 3 años tributarios), F29 ' +
        'guardados sin enviar, rechazados o sin declarar (últimos 12 períodos, desde tu inicio de ' +
        'actividades y según tu vencimiento: día 12 o 20) y el último ' +
        'estado de tus peticiones administrativas, y las cuotas de contribuciones vencidas o que ' +
        'vencen en 30 días. Para una cuenta solo de segunda categoría (honorarios), un mes sin ' +
        'F29 se avisa solo si sus boletas emitidas llevan retención del emisor (una consulta de ' +
        'boletas más por mes candidato). Solo lectura. Con todas las fuentes son ' +
        '~20 consultas pausadas al SII (~20 s); una rutina frecuente puede limitarlas con ' +
        '--fuentes. Cada alerta trae un id estable para comparar entre ejecuciones.',
    )
    .option(
      '--fuentes <lista>',
      'Fuentes separadas por coma: f22,f29,peticiones,bienes_raices (por defecto: todas).',
    )
    .option(
      '--desde <fecha>',
      'Solo alertas desde esa fecha (AAAA-MM-DD); las sin fecha se mantienen.',
    )
    .action(async (opts: { fuentes?: string; desde?: string }) => {
      const r = await alertas(runtime, { fuentes: opts.fuentes, desde: opts.desde });
      emit(r, () => {
        out(`Alertas — ${fmtRut(r.rut)}`);
        if (r.alertas.length === 0) out('  Sin alertas.');
        for (const a of r.alertas) out(`  ${a.fecha ?? '          '}  ${sobre(a)}  ${linea(a)}`);
        for (const f of r.fuentes) {
          if (f.estado === 'error')
            out(`  ⚠ ${f.origen}: no se pudo leer (${f.error?.error ?? '—'})`);
          if (f.estado === 'no_declarante')
            out(`  ${f.origen}: sin F29 vigentes en 12 meses; no se revisan meses sin declarar.`);
        }
        if (r.incompleto) out('Resultado incompleto: una fuente falló.');
      });
    });
}
