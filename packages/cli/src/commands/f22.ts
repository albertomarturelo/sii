// `sii f22 …` — Declaración Anual de Renta (estado). Thin calls into @albertomarturelo/sii-core tasks
// (ADR-003). SESSION-KEYED (ADR-005): always reads the session principal — NO `--rut`;
// a represented empresa's F22 is reached by logging in AS the empresa (logout→login).
import type { Command } from 'commander';
import {
  ValidationError,
  f22Historial,
  f22Observaciones,
  f22Overview,
  f22Status,
  f22Terceros,
  f22TercerosDetalle,
  formatMoney as money,
  formatRut as fmtRut,
  type CampoTercero,
  type CodigoF22,
  type F22Grupos,
  type Runtime,
} from '@albertomarturelo/sii-core';
import { emit, out } from '../io.js';

const printCodigos = (codigos: readonly CodigoF22[]): void => {
  for (const c of codigos) out(`  ${c.codigo}  ${c.glosa ?? ''}  ${money(c.valor)}`);
};

/** The `formulario` view: the complete grid organized for a contador. Empty groups are still
 *  labeled so the structure is predictable; `otros` (non-PII, unclassified) prints only when
 *  it has rows. */
const printGrupos = (g: F22Grupos): void => {
  out('Ingresos:');
  printCodigos(g.ingresos);
  out('Deducciones:');
  printCodigos(g.deducciones);
  out('Retenciones · PPM · Créditos:');
  printCodigos(g.creditos);
  out('Cálculo (subtotales IGC/IUSC):');
  printCodigos(g.calculo);
  out('Resultado:');
  printCodigos(g.resultado);
  if (g.otros.length) {
    out('Otros:');
    printCodigos(g.otros);
  }
};

// A declarante's RUT is as SII printed it; one that fails Mod-11 still prints, unformatted.
const rutTercero = (rut: string): string => {
  try {
    return fmtRut(rut);
  } catch {
    return rut;
  }
};
const valorTercero = (v: CampoTercero['valor']): string =>
  v === null ? '—' : typeof v === 'number' ? v.toLocaleString('es-CL') : v;
const printCampos = (campos: readonly CampoTercero[], indent: string): void => {
  for (const c of campos)
    if (c.valor !== null) out(`${indent}${c.columna}: ${valorTercero(c.valor)}`);
};

export function registerF22(program: Command, runtime: Runtime): void {
  const f22 = program.command('f22').description('Declaración Anual de Renta (F22).');

  f22
    .command('status')
    .description('Estado de la F22. Sin año: resumen de los últimos años; con año: detalle.')
    .argument('[año]', 'Año tributario (YYYY). Si se omite, muestra el resumen multi-año.')
    .option('--folio <n>', 'Folio específico de la declaración (por defecto: la vigente).')
    .option('--years <n>', 'Cuántos años incluir en el resumen (por defecto 5).')
    .action(async (anioArg: string | undefined, opts: { folio?: string; years?: string }) => {
      if (!anioArg) {
        // `--folio` selects one declaración within a year — meaningless for the multi-year
        // overview; reject instead of silently dropping it.
        if (opts.folio) {
          throw new ValidationError('El --folio requiere indicar el año (YYYY).');
        }
        const ov = await f22Overview(runtime, opts.years ? { years: Number(opts.years) } : {});
        emit(ov, () => {
          out(`F22 — ${fmtRut(ov.rut)} (estado por año)`);
          for (const a of ov.anios) {
            const decl = a.declaraciones.find((d) => d.vigente) ?? a.declaraciones[0];
            const estado = a.tieneDeclaracion ? (decl?.estado ?? 'presentada') : 'Sin declaración';
            out(`  ${a.anio}  ${estado}`);
          }
        });
        return;
      }
      const e = await f22Status(runtime, {
        anio: anioArg,
        ...(opts.folio ? { folio: opts.folio } : {}),
      });
      emit(e, () => {
        out(`F22 ${e.anio} — ${fmtRut(e.rut)}`);
        if (!e.tieneDeclaracion) {
          out('Sin declaración para el año.');
          return;
        }
        out(`Folio: ${e.folio ?? '—'}   Estado: ${e.estado ?? '—'}`);
        printCodigos(e.codigos);
        out(`${e.codigos.length} código(s).`);
      });
    });

  f22
    .command('formulario')
    .description(
      'Formulario completo de la F22 de un año, agrupado (ingresos, deducciones, retenciones·PPM·créditos, resultado).',
    )
    .argument('<año>', 'Año tributario (YYYY).')
    .option('--folio <n>', 'Folio específico de la declaración (por defecto: la vigente).')
    .action(async (anioArg: string, opts: { folio?: string }) => {
      const e = await f22Status(runtime, {
        anio: anioArg,
        full: true,
        ...(opts.folio ? { folio: opts.folio } : {}),
      });
      emit(e, () => {
        out(`F22 ${e.anio} — ${fmtRut(e.rut)} (formulario)`);
        if (!e.tieneDeclaracion) {
          out('Sin declaración para el año.');
          return;
        }
        out(`Folio: ${e.folio ?? '—'}   Estado: ${e.estado ?? '—'}`);
        if (e.grupos) printGrupos(e.grupos);
        out(`${e.codigos.length} código(s).`);
      });
    });

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
      emit(r, () => {
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
    });

  f22
    .command('historial')
    .description(
      'Historial de eventos de la F22 de un año (declaración recibida, devoluciones, giros, rectificatorias).',
    )
    .argument('<año>', 'Año tributario (YYYY).')
    .option('--folio <n>', 'Folio específico (por defecto: todos los folios del año).')
    .action(async (anioArg: string, opts: { folio?: string }) => {
      const r = await f22Historial(runtime, {
        anio: anioArg,
        ...(opts.folio ? { folio: opts.folio } : {}),
      });
      emit(r, () => {
        out(`F22 ${r.anio} — ${fmtRut(r.rut)} (historial)`);
        if (!r.tieneDeclaracion && r.eventos.length === 0 && r.foliosConError.length === 0) {
          out('Sin declaración para el año.');
          return;
        }
        for (const e of r.eventos) {
          out(`  ${e.fecha ?? '—'}  ${e.glosa ?? e.codigo}`);
        }
        if (r.eventos.length === 0 && r.foliosConError.length === 0) {
          out('Sin eventos.');
        } else {
          out(`${r.eventos.length} evento(s).`);
        }
        // SII errored on a folio — surface it, never hide it. Frame it as SII-side (it is:
        // SII's own UI fails identically on these folios — see sii-contract/f22.md) while
        // keeping its message verbatim (ADR-004); the JSON `error` stays the raw string.
        for (const fe of r.foliosConError) {
          out(
            `  ⚠ folio ${fe.folio}: el SII no entregó su historial (error interno del SII: ${fe.error})`,
          );
        }
      });
    });

  f22
    .command('terceros')
    .description(
      'Información de terceros del año: lo que informaron sobre ti tus agentes retenedores e ' +
        'informantes (empresas, bancos, AFP, corredoras) en sus declaraciones juradas. Sin ' +
        '--dj: el resumen por DJ (una consulta al SII). Con --dj: las filas de esa DJ, con el ' +
        'RUT y nombre de cada declarante (datos de terceros). Session-keyed: lee tu propia ' +
        'información; para una empresa, inicia sesión como ella.',
    )
    .argument('<año>', 'Año tributario (YYYY); 2026 = ingresos de 2025.')
    .option('--dj <código>', 'Código de la DJ cuyas filas leer (p. ej. 1887).')
    .option('--pagina <n>', 'Solo esa página de 10 filas (requiere --dj; por defecto: todas).')
    .action(async (anioArg: string, opts: { dj?: string; pagina?: string }) => {
      if (opts.dj === undefined) {
        // The resumen is one call with no pages; a page number without a DJ selects nothing.
        if (opts.pagina !== undefined) throw new ValidationError('El --pagina requiere --dj.');
        const r = await f22Terceros(runtime, { anio: anioArg });
        emit(r, () => {
          out(`F22 ${r.anio} — ${fmtRut(r.rut)} (información de terceros)`);
          for (const d of r.declaraciones) {
            out(`  ${d.dj}  ${d.titulo ?? ''}`);
            for (const fila of d.filas) printCampos(fila, '      ');
          }
          out(`${r.declaraciones.length} declaración(es). Filas de una: --dj <código>.`);
        });
        return;
      }
      const r = await f22TercerosDetalle(runtime, {
        anio: anioArg,
        dj: opts.dj,
        ...(opts.pagina !== undefined ? { pagina: opts.pagina } : {}),
      });
      emit(r, () => {
        out(`F22 ${r.anio} — ${fmtRut(r.rut)} (DJ ${r.dj}, información de terceros)`);
        for (const f of r.filas) {
          const quien = f.declaranteRut ? ` (${rutTercero(f.declaranteRut)})` : '';
          out(
            `  ${f.fechaPresentacion ?? '—'}  ${f.declaranteNombre ?? '—'}${quien}  ` +
              `folio ${f.folio ?? '—'}  ${f.estado ?? ''}`,
          );
          printCampos(f.campos, '      ');
        }
        out(
          `${r.filas.length} de ${r.registros} fila(s); página(s) ${r.paginasLeidas.join(', ')} ` +
            `de ${r.paginas}.`,
        );
        // SII failed a page: surface it verbatim, never hide it (ADR-004).
        for (const pe of r.paginasConError) out(`  ⚠ página ${pe.pagina}: ${pe.error}`);
        if (r.incompleto && r.paginasConError.length === 0) {
          out(`  ⚠ incompleto: lee el resto con --pagina <n> (hasta ${r.paginas}).`);
        }
      });
    });
}
