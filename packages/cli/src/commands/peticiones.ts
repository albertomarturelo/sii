// `sii peticiones …` — Peticiones Administrativas (SISPAD). Thin calls into
// @albertomarturelo/sii-core tasks (ADR-003). Body-RUT (ADR-005): `--rut` reads a represented
// empresa's petitions. Read-only for now; issuing new petitions is a future write surface.
import type { Command } from 'commander';
import { formatRut as fmtRut, peticionesList, type Runtime } from '@albertomarturelo/sii-core';
import { emit, out } from '../io.js';

// exactOptionalPropertyTypes: only carry `rut` when the override was passed.
const rutOpt = (rut?: string): { rut?: string } => (rut ? { rut } : {});

export function registerPeticiones(program: Command, runtime: Runtime): void {
  const pet = program
    .command('peticiones')
    .description('Peticiones administrativas ante el SII (SISPAD).');

  pet
    .command('list')
    .description('Lista las peticiones administrativas con su timeline de estados.')
    .option('--rut <rut>', 'Operar como una empresa representada (del conjunto operable).')
    .action(async (opts: { rut?: string }) => {
      const res = await peticionesList(runtime, { ...rutOpt(opts.rut) });
      emit(res, () => {
        out(`Peticiones administrativas — ${fmtRut(res.rut)}`);
        if (res.peticiones.length === 0) {
          out('Sin peticiones.');
          return;
        }
        for (const p of res.peticiones) {
          out(`\n  #${p.numero}  ${p.materia ?? '—'}`);
          out(`  Estado actual: ${p.estadoActual}`);
          for (const e of p.timeline) {
            const fecha = e.fecha ? e.fecha.slice(0, 10) : '—';
            out(`    ${fecha}  ${e.estado}`);
            if (e.mensaje) out(`             ↳ ${e.mensaje}`);
          }
        }
      });
    });
}
