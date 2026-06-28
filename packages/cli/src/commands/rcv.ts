// `sii rcv …` — Registro de Compras y Ventas. Thin calls into @sii/core tasks
// (ADR-003). Each domain module owns a `commands/<mod>.ts` exporting a
// `register<Mod>(program, runtime)`; `program.ts` just calls it, so the shared
// command tree stays append-only across parallel modules (RCV sets this pattern).
import type { Command } from 'commander';
import { Rut, rcvList, rcvSummary, type RcvSide, type Runtime } from '@sii/core';
import { out } from '../io.js';

const sideOf = (opts: { venta?: boolean }): RcvSide => (opts.venta ? 'VENTA' : 'COMPRA');
// exactOptionalPropertyTypes: only carry `rut` when the override was passed.
const rutOpt = (rut?: string): { rut?: string } => (rut ? { rut } : {});
const money = (n: number | null): string => (n === null ? '—' : n.toLocaleString('es-CL'));
const fmtRut = (canonical: string): string => Rut.parse(canonical).formatted;

export function registerRcv(program: Command, runtime: Runtime): void {
  const rcv = program.command('rcv').description('Registro de Compras y Ventas (RCV).');

  rcv
    .command('summary')
    .description('Resumen por tipo de documento para un período (COMPRAS por defecto).')
    .argument('<periodo>', 'Período tributario (YYYYMM o YYYY-MM).')
    .option('--venta', 'Consulta el registro de VENTAS (por defecto: COMPRAS).')
    .option('--rut <rut>', 'Operar como una empresa representada (del conjunto operable).')
    .action(async (periodo: string, opts: { venta?: boolean; rut?: string }) => {
      const res = await rcvSummary(runtime, { periodo, side: sideOf(opts), ...rutOpt(opts.rut) });
      out(`RCV ${res.side} ${res.periodo} — ${fmtRut(res.rut)}`);
      if (res.rows.length === 0) {
        out('Sin documentos en el período.');
        return;
      }
      for (const r of res.rows) {
        out(
          `  ${r.codigoTipoDoc ?? '—'}  ${r.descripcion ?? ''}  docs=${r.totalDocumentos ?? '—'}  total=${money(r.montoTotal)}`,
        );
      }
      if (res.totalDocumentos !== null) out(`Total documentos: ${res.totalDocumentos}`);
    });

  rcv
    .command('list')
    .description('Detalle de documentos de un tipo para un período.')
    .argument('<periodo>', 'Período tributario (YYYYMM o YYYY-MM).')
    .requiredOption('--tipo <codigo>', 'Código de tipo de documento DTE (ej. 33, 34, 39).')
    .option('--venta', 'Consulta el registro de VENTAS (por defecto: COMPRAS).')
    .option('--rut <rut>', 'Operar como una empresa representada (del conjunto operable).')
    .action(async (periodo: string, opts: { tipo: string; venta?: boolean; rut?: string }) => {
      const res = await rcvList(runtime, {
        periodo,
        side: sideOf(opts),
        codigoTipoDoc: opts.tipo,
        ...rutOpt(opts.rut),
      });
      out(`RCV ${res.side} ${res.periodo} tipo ${res.codigoTipoDoc} — ${fmtRut(res.rut)}`);
      if (res.docs.length === 0) {
        out('Sin documentos de este tipo en el período.');
        return;
      }
      for (const d of res.docs) {
        const contraparte = d.rutEmisor ? fmtRut(d.rutEmisor) : '—';
        out(
          `  folio=${d.folio ?? '—'}  ${contraparte}  ${d.fechaEmision ?? '—'}  total=${money(d.montoTotal)}`,
        );
      }
      out(`${res.docs.length} documento(s).`);
    });
}
