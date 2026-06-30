// `sii bte …` — Boletas de Honorarios Electrónicas. Thin calls into @sii/core tasks
// (ADR-003). Each domain module owns a `commands/<mod>.ts` exporting a
// `register<Mod>(program, runtime)`; `program.ts` just calls it (append-only tree).
//
// SESSION-KEYED (ADR-005): reads the session principal; no `--rut`.
import type { Command } from 'commander';
import { Rut, bteList, type BteSide, type Runtime } from '@sii/core';
import { emit, out } from '../io.js';

const sideOf = (opts: { recibidas?: boolean }): BteSide =>
  opts.recibidas ? 'RECIBIDAS' : 'EMITIDAS';
const money = (n: number | null): string => (n === null ? '—' : n.toLocaleString('es-CL'));
const fmtRut = (canonical: string): string => Rut.parse(canonical).formatted;

export function registerBte(program: Command, runtime: Runtime): void {
  const bte = program.command('bte').description('Boletas de Honorarios Electrónicas (BHE/BTE).');

  bte
    .command('list')
    .description(
      'Boletas de honorarios de un período (EMITIDAS por defecto; --recibidas para las recibidas).',
    )
    .argument('<periodo>', 'Período tributario (YYYYMM o YYYY-MM).')
    .option('--recibidas', 'Boletas RECIBIDAS (por defecto: EMITIDAS).')
    .option('--emitidas', 'Boletas EMITIDAS (por defecto).')
    .action(async (periodo: string, opts: { recibidas?: boolean; emitidas?: boolean }) => {
      const res = await bteList(runtime, { periodo, side: sideOf(opts) });
      emit(res, () => {
        out(`BHE ${res.side} ${res.periodo} — ${fmtRut(res.rut)}`);
        if (res.boletas.length === 0) {
          out('Sin boletas en el período.');
          return;
        }
        for (const b of res.boletas) {
          const contraparte = b.contraparteRut ? fmtRut(b.contraparteRut) : '—';
          const anul = b.estado === 'ANUL' ? ' [ANULADA]' : '';
          out(
            `  folio=${b.folio ?? '—'}  ${b.fecha ?? '—'}  ${contraparte}  ${b.contraparteNombre ?? ''}  líquido=${money(b.honorariosLiquidos)}${anul}`,
          );
        }
        out(`${res.boletas.length} boleta(s); líquido total=${money(res.totales.liquido)}.`);
      });
    });
}
