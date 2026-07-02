// `sii bte …` — Boletas de Honorarios Electrónicas. Thin calls into @altumstack/sii-core tasks
// (ADR-003). Each domain module owns a `commands/<mod>.ts` exporting a
// `register<Mod>(program, runtime)`; `program.ts` just calls it (append-only tree).
//
// SESSION-KEYED (ADR-005): reads the session principal; no `--rut`.
import type { Command } from 'commander';
import {
  bteEmit,
  bteEmitPreview,
  bteList,
  formatMoney as money,
  formatRut as fmtRut,
  type BteEmitArgs,
  type BteRetiene,
  type BteSide,
  type Runtime,
} from '@altumstack/sii-core';
import { emit, out } from '../io.js';

const sideOf = (opts: { recibidas?: boolean }): BteSide =>
  opts.recibidas ? 'RECIBIDAS' : 'EMITIDAS';

/** Parse a repeatable `--linea "<monto>:<glosa>"` into { glosa, monto }. Monto is the digits
 *  before the FIRST colon (so a glosa may contain colons); a bad shape throws for commander. */
function parseLinea(
  value: string,
  acc: { glosa: string; monto: number }[],
): { glosa: string; monto: number }[] {
  const i = value.indexOf(':');
  if (i < 0) throw new Error(`--linea inválida: "${value}" (formato "<monto>:<glosa>").`);
  const monto = Number(value.slice(0, i).trim().replace(/[.\s]/g, ''));
  const glosa = value.slice(i + 1).trim();
  if (!Number.isInteger(monto) || monto <= 0 || glosa === '') {
    throw new Error(`--linea inválida: "${value}" (monto entero positivo + glosa).`);
  }
  acc.push({ glosa, monto });
  return acc;
}

const retieneOf = (v: string): BteRetiene => {
  const s = v.toLowerCase();
  if (s === 'receptor') return 'RECEPTOR';
  if (s === 'emisor') return 'EMISOR';
  throw new Error(`--retiene inválido: "${v}" (usa "receptor" o "emisor").`);
};

/** Parse an optional `--fecha YYYY-MM-DD` into the {dia,mes,anio} the task expects. */
function parseFecha(v: string): { dia: number; mes: number; anio: number } {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim());
  if (!m) throw new Error(`--fecha inválida: "${v}" (formato YYYY-MM-DD).`);
  return { anio: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
}

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

  // --- emit (WRITE surface, ADR-017) — issues a legally-binding boleta ---
  bte
    .command('emit')
    .description(
      'EMITE una boleta de honorarios electrónica (acto legal). Por defecto hace --dry-run ' +
        '(vista previa sin emitir); usa --confirm <monto-total> para emitir de verdad.',
    )
    .requiredOption('--receptor <rut>', 'RUT del receptor (destinatario).')
    .requiredOption('--nombre <nombre>', 'Nombre o razón social del receptor.')
    .requiredOption('--domicilio <domicilio>', 'Domicilio del receptor.')
    .requiredOption('--region <n>', 'Código de región del SII (1–16).', (v: string) => Number(v))
    .requiredOption('--comuna <n>', 'Código de comuna del SII.', (v: string) => Number(v))
    .requiredOption(
      '--linea <monto:glosa>',
      'Línea de honorarios "<monto>:<glosa>" (repetible, hasta 4).',
      parseLinea,
      [] as { glosa: string; monto: number }[],
    )
    .option('--retiene <quien>', 'Quién retiene el PPM: "receptor" (def.) o "emisor".', 'receptor')
    .option('--fecha <YYYY-MM-DD>', 'Fecha de la boleta (por defecto: hoy; ±3 meses).')
    .option('--sin-detalle', 'No mostrar el detalle de actividades en la boleta.')
    .option('--enviar <email>', 'Además, enviar el PDF por correo al receptor (solo al emitir).')
    .option('--sin-copia', 'No enviar copia del correo al emisor.')
    .option('--dry-run', 'Vista previa: calcula retención/líquido SIN emitir (por defecto).')
    .option(
      '--confirm <monto-total>',
      'EMITE la boleta. Debe repetir el monto bruto total (suma de líneas) como confirmación.',
    )
    .action(
      async (opts: {
        receptor: string;
        nombre: string;
        domicilio: string;
        region: number;
        comuna: number;
        linea: { glosa: string; monto: number }[];
        retiene: string;
        fecha?: string;
        sinDetalle?: boolean;
        enviar?: string;
        sinCopia?: boolean;
        dryRun?: boolean;
        confirm?: string;
      }) => {
        const args: BteEmitArgs = {
          receptor: opts.receptor,
          receptorNombre: opts.nombre,
          receptorDomicilio: opts.domicilio,
          region: opts.region,
          comuna: opts.comuna,
          lineas: opts.linea,
          retiene: retieneOf(opts.retiene),
          ...(opts.fecha ? { fecha: parseFecha(opts.fecha) } : {}),
          ...(opts.sinDetalle ? { mostrarDetalle: false } : {}),
        };

        // Default is the SAFE preview. Real emission requires --confirm <monto> whose value
        // equals the sum of the line montos (a deliberate double-entry of the amount committed).
        if (opts.confirm === undefined) {
          const preview = await bteEmitPreview(runtime, args);
          emit(preview, () => {
            out(`BHE vista previa — receptor ${fmtRut(opts.receptor)}`);
            out(`  Total honorarios: ${money(preview.totalHonorarios)}`);
            out(
              `  Retención (${preview.porcentajeRetencion ?? '—'}%, retiene ${preview.retiene}): ${money(preview.retencion)}`,
            );
            out(`  Líquido a recibir: ${money(preview.liquido)}`);
            out('NO se emitió. Para emitir: repite --confirm <monto-total-bruto>.');
          });
          return;
        }

        const totalBruto = opts.linea.reduce((s, l) => s + l.monto, 0);
        const confirmMonto = Number(opts.confirm.replace(/[.\s]/g, ''));
        if (confirmMonto !== totalBruto) {
          throw new Error(
            `--confirm no coincide: recibí ${confirmMonto} pero el total bruto es ${totalBruto}. ` +
              'Repite exactamente el monto bruto total para emitir.',
          );
        }
        const res = await bteEmit(runtime, {
          ...args,
          ...(opts.enviar ? { enviarA: opts.enviar } : {}),
          ...(opts.sinCopia ? { copiaEmisor: false } : {}),
        });
        emit(res, () => {
          out(`BHE EMITIDA — receptor ${fmtRut(opts.receptor)}`);
          out(`  Código de barras: ${res.codBarras}`);
          out(
            `  Total ${money(res.totalHonorarios)} · retención ${money(res.retencion)} · líquido ${money(res.liquido)}`,
          );
          out(`  PDF: ${res.pdfUrl}`);
          if (res.enviado !== undefined)
            out(`  Correo al receptor: ${res.enviado ? 'enviado' : 'no enviado'}`);
        });
      },
    );
}
