// `sii dte …` — Documentos Tributarios Electrónicos. Thin calls into @sii/core tasks
// (ADR-003). Each domain module owns a `commands/<mod>.ts` exporting a
// `register<Mod>(program, runtime)`; `program.ts` just calls it (append-only tree).
//
// `dte authorized` is the PUBLIC, login-free consulta (ADR-014): no session, any RUT.
import type { Command } from 'commander';
import { Rut, dteAuthorized, type Runtime } from '@sii/core';
import { emit, out } from '../io.js';

const fmtRut = (canonical: string): string => Rut.parse(canonical).formatted;

export function registerDte(program: Command, runtime: Runtime): void {
  const dte = program.command('dte').description('Documentos Tributarios Electrónicos (DTE).');

  dte
    .command('authorized')
    .description(
      'Consulta PÚBLICA (sin login) de los tipos de DTE que un RUT está autorizado a emitir.',
    )
    .argument('<rut>', 'RUT a consultar (cualquier RUT; consulta pública).')
    .action(async (rut: string) => {
      const res = await dteAuthorized(runtime, { rut });
      emit(res, () => {
        out(`DTE autorizados — ${fmtRut(res.rut)}`);
        if (!res.autorizado) {
          out(res.mensaje ?? 'El RUT no está autorizado a emitir DTE.');
          return;
        }
        if (res.razonSocial) out(`  Razón social: ${res.razonSocial}`);
        if (res.nResolucion) out(`  N° Resolución: ${res.nResolucion}`);
        if (res.fechaResolucion) out(`  Fecha Resolución: ${res.fechaResolucion}`);
        if (res.direccionRegional) out(`  Dirección Regional: ${res.direccionRegional}`);
        if (res.documentos.length === 0) {
          out('Sin documentos autorizados.');
          return;
        }
        for (const d of res.documentos) {
          const desaut = d.fechaDesautorizacion
            ? `  (desautorizado ${d.fechaDesautorizacion})`
            : '';
          out(`  ${d.codigo}  ${d.descripcion ?? ''}  ${d.fechaAutorizacion ?? '—'}${desaut}`);
        }
        out(`${res.documentos.length} tipo(s) de documento.`);
      });
    });
}
