// `sii f29 …` — Declaración Mensual de IVA. Thin calls into @altumstack/sii-core tasks (ADR-003).
// SESSION-KEYED (ADR-005): always reads the session principal — NO `--rut`; a represented
// empresa's F29 needs the empresa's own session (logout→login). Fase 1 (robusta, sin GWT-RPC):
//   - formulario <periodo> : la propuesta de IVA, etiquetada + agrupada (fuente: propuesta).
//   - overview <desde> [hasta] | <año> : posición por mes (estado/folio/total) en un rango.
//   - status <periodo> : el estado crudo de las declaraciones del mes.
import type { Command } from 'commander';
import {
  Rut,
  f29Formulario,
  f29Overview,
  f29Status,
  F29_GRUPO_LABELS,
  type F29Grupo,
  type LineaF29,
  type Runtime,
} from '@altumstack/sii-core';
import { emit, out } from '../io.js';

const money = (n: number | null): string => (n === null ? '—' : n.toLocaleString('es-CL'));
const fmtRut = (canonical: string): string => Rut.parse(canonical).formatted;

const GROUP_ORDER: readonly F29Grupo[] = ['debitos', 'creditos', 'retenciones', 'otros', 'totales'];

const printLineas = (lineas: readonly LineaF29[]): void => {
  for (const l of lineas)
    out(`  ${l.codigo.padStart(4)} ${l.signo || ' '}  ${l.glosa ?? ''}  ${money(l.valor)}`);
};

export function registerF29(program: Command, runtime: Runtime): void {
  const f29 = program.command('f29').description('Declaración Mensual de IVA (F29).');

  f29
    .command('formulario')
    .description('Propuesta de IVA de un período, etiquetada y agrupada (débitos, créditos, etc.).')
    .argument('<periodo>', 'Período tributario (YYYYMM o YYYY-MM).')
    .action(async (periodoArg: string) => {
      const f = await f29Formulario(runtime, { periodo: periodoArg });
      emit(f, () => {
        out(`F29 ${f.periodo} — ${fmtRut(f.rut)} (formulario · fuente: ${f.fuente})`);
        if (!f.tienePropuesta) {
          out('Sin propuesta para el período.');
          return;
        }
        let total = 0;
        for (const g of GROUP_ORDER) {
          const lineas = f.grupos[g];
          if (lineas.length === 0) continue;
          out(`${F29_GRUPO_LABELS[g]}:`);
          printLineas(lineas);
          total += lineas.length;
        }
        out(`${total} código(s).`);
      });
    });

  f29
    .command('overview')
    .description('Posición de IVA por mes en un rango de fechas (estado, folio, total a pagar).')
    .argument('[desde]', 'Período inicial (YYYY-MM) o un año (YYYY) para el año completo.')
    .argument('[hasta]', 'Período final (YYYY-MM). Por defecto: el año en curso a la fecha.')
    .action(async (desdeArg: string | undefined, hastaArg: string | undefined) => {
      // Range semantics live in the task (one policy for CLI + MCP): bare YYYY →
      // whole year; YYYY-MM alone → that month; nothing → current year to date.
      const ov = await f29Overview(runtime, { desde: desdeArg, hasta: hastaArg });
      emit(ov, () => {
        out(`F29 — ${fmtRut(ov.rut)} (${ov.desde} → ${ov.hasta})`);
        for (const m of ov.meses) {
          const estado = m.tieneDeclaracion ? (m.estado ?? 'presentada') : 'Sin declaración';
          out(
            `  ${m.periodo}  ${estado.padEnd(20)} folio ${m.folio ?? '—'}  total ${money(m.total)}`,
          );
        }
      });
    });

  f29
    .command('status')
    .description('Estado de las declaraciones F29 presentadas/guardadas de un período.')
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
          out(
            `  ${d.fecha ?? '—'}  ${d.estado ?? '—'}  folio ${d.folio ?? '—'}  total ${money(d.total)}`,
          );
        }
        out(`${e.declaraciones.length} declaración(es).`);
      });
    });
}
