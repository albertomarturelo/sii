// `sii f29 …` — Declaración Mensual de IVA. Thin calls into @albertomarturelo/sii-core tasks (ADR-003).
// SESSION-KEYED (ADR-005): always reads the session principal — NO `--rut`; a represented
// empresa's F29 needs the empresa's own session (logout→login). Fase 1 (robusta, sin GWT-RPC):
//   - formulario <periodo> : la propuesta de IVA, etiquetada + agrupada (fuente: propuesta).
//   - overview <desde> [hasta] | <año> : posición por mes (estado/folio/total) en un rango.
//   - status <periodo> : el estado crudo de las declaraciones del mes.
//   - pdf <periodo> : descarga el/los PDF de la declaración presentada (ADR-022).
//   - submit <periodo> [--confirm <total>] : PRESENTA la propuesta tal cual (ADR-029); por
//     defecto solo la vista previa.
import { join } from 'node:path';
import type { Command } from 'commander';
import {
  f29Formulario,
  f29Overview,
  f29Pdf,
  f29Status,
  f29Submit,
  f29SubmitPreview,
  formatMoney as money,
  formatRut as fmtRut,
  F29_GRUPO_LABELS,
  type F29Grupo,
  type LineaF29,
  F29_PDF_TIPO_ARGS,
  type F29PdfTipoArg,
  type Runtime,
} from '@albertomarturelo/sii-core';
// The default destination lives in the `./node` subpath (the pure core cannot know $HOME —
// ADR-016/ADR-022); the SURFACE applies it.
import { documentosDir } from '@albertomarturelo/sii-core/node';
import { emit, out } from '../io.js';

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

  f29
    .command('pdf')
    .description(
      'Descarga el PDF de la declaración F29 presentada de un período. ' +
        'El compacto es además el comprobante de pago cuando el período fue pagado.',
    )
    .argument('<periodo>', 'Período tributario (YYYYMM o YYYY-MM).')
    .option(
      '--tipo <tipo>',
      `Documento a descargar: ${F29_PDF_TIPO_ARGS.join(' | ')}.`,
      'compacto' satisfies F29PdfTipoArg,
    )
    .option(
      '--out <dir>',
      'Carpeta destino (por defecto, documentos/f29 bajo $SII_HOME, o ~/.sii sin ella).',
      join(documentosDir(), 'f29'),
    )
    .option('--folio <folio>', 'Folio específico (por defecto, la declaración vigente).')
    .action(async (periodoArg: string, opts: { tipo: string; out: string; folio?: string }) => {
      if (!(F29_PDF_TIPO_ARGS as readonly string[]).includes(opts.tipo)) {
        throw new Error(`--tipo debe ser uno de: ${F29_PDF_TIPO_ARGS.join(', ')}.`);
      }
      let folio: number | undefined;
      if (opts.folio !== undefined) {
        folio = Number(opts.folio);
        if (!Number.isInteger(folio) || folio <= 0) {
          throw new Error('--folio debe ser un número entero positivo.');
        }
      }
      const res = await f29Pdf(runtime, {
        periodo: periodoArg,
        tipo: opts.tipo as F29PdfTipoArg,
        directorio: opts.out,
        ...(folio !== undefined ? { folio } : {}),
      });
      emit(res, () => {
        out(`F29 ${res.periodo} — ${fmtRut(res.rut)} · folio ${res.folio} (${res.estado ?? '—'})`);
        for (const d of res.documentos) {
          out(`  ${d.tipo.padEnd(8)} ${(d.bytes / 1024).toFixed(1)} KB  ${d.path}`);
        }
        // A partial failure must be visible: the sibling that DID land is above (ADR-004).
        for (const e of res.documentosConError) out(`  ${e.tipo.padEnd(8)} ERROR: ${e.error}`);
      });
    });

  // --- submit (WRITE surface, ADR-029) — files a legally-binding declaración ---
  f29
    .command('submit')
    .description(
      'Session-keyed (tu propia declaración; para una empresa, inicia sesión como ella). ' +
        'PRESENTA el F29 del período con la propuesta de SII tal cual (acto legal). Por defecto ' +
        'solo muestra la vista previa, que deja un borrador «Guardada» en SII sin presentarlo; ' +
        'usa --confirm <total> para presentar. La propuesta de SII puede estar incompleta (PPM, ' +
        'retenciones, documentos fuera del RCV): revísala antes. No paga: si hay total a pagar, ' +
        'pagas en SII.',
    )
    .argument('<periodo>', 'Período tributario (YYYYMM o YYYY-MM).')
    .option(
      '--confirm <total>',
      'PRESENTA el F29. Debe repetir el TOTAL A PAGAR (código 91) de la vista previa.',
    )
    .action(async (periodoArg: string, opts: { confirm?: string }) => {
      if (opts.confirm === undefined) {
        const p = await f29SubmitPreview(runtime, { periodo: periodoArg });
        emit(p, () => {
          out(`F29 ${p.periodo} — ${fmtRut(p.rut)} (vista previa de la presentación)`);
          for (const g of GROUP_ORDER) {
            const lineas = p.propuesta[g];
            if (lineas.length === 0) continue;
            out(`${F29_GRUPO_LABELS[g]}:`);
            printLineas(lineas);
          }
          if (p.calculados.length > 0) {
            out('Calculado por las fórmulas de SII:');
            printLineas(p.calculados);
          }
          out(`TOTAL A PAGAR (91): ${money(p.total)}`);
          out('Se dejó un borrador «Guardada» en SII; no se presentó nada.');
          if (p.desacuerdos.length > 0) {
            out('NO se puede presentar: el borrador de SII no coincide con la propuesta en:');
            for (const d of p.desacuerdos) out(`  ${d.codigo.padStart(4)}  ${d.motivo}`);
            return;
          }
          out(
            'La propuesta de SII puede estar incompleta (PPM, retenciones, documentos fuera del ' +
              'RCV). Si está bien, presenta con:',
          );
          out(`  sii f29 submit ${p.periodo} --confirm ${p.total}`);
        });
        return;
      }
      const r = await f29Submit(runtime, { periodo: periodoArg, total: opts.confirm });
      emit(r, () => {
        out(`F29 ${r.periodo} PRESENTADO — ${fmtRut(r.rut)}`);
        out(`  Folio: ${r.folio ?? '—'} · estado: ${r.estado ?? '—'}`);
        out(`  TOTAL A PAGAR: ${money(r.total)}`);
        if (r.total > 0) {
          out(
            r.pagoUrl
              ? `  Paga en SII: ${r.pagoUrl}`
              : '  Hay un total a pagar: págalo en SII (este comando no paga).',
          );
        }
      });
    });
}
