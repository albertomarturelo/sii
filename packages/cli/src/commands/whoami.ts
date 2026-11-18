// `sii whoami` — the authenticated account's own identity: razón social/nombre + email.
// Thin call into the @albertomarturelo/sii-core `whoami` task (ADR-003). Session-keyed: reads the
// login principal (ignores the operate pointer). Surfaces the user's OWN PII (opt-in by
// running the command); the values never reach the audit log (ADR-006 / CONVENTIONS).
import type { Command } from 'commander';
import { whoami, formatRut as fmtRut, type Runtime } from '@albertomarturelo/sii-core';
import { emit, out } from '../io.js';

export function registerWhoami(program: Command, runtime: Runtime): void {
  program
    .command('whoami')
    .description(
      'Session-keyed (la cuenta autenticada, ignora operate). Muestra la cuenta autenticada: ' +
        'RUT, tipo, razón social/nombre y email (tu PII propia), y el régimen que el SII registra: ' +
        'inicio de actividades, término de giro, desde cuándo debe F29 todos los meses, si es ' +
        'segunda categoría y el día de vencimiento del F29. Lo desconocido sale como «—».',
    )
    .action(async () => {
      const res = await whoami(runtime);
      emit(res, () => {
        out(`RUT:   ${fmtRut(res.rut)}`);
        out(`Tipo:  ${res.accountType}`);
        out(`${res.accountType === 'empresa' ? 'Razón social' : 'Nombre'}: ${res.nombre ?? '—'}`);
        out(`Email: ${res.email ?? '—'}`);
        const r = res.regimen;
        const cat = r.segundaCategoria === null ? '—' : r.segundaCategoria ? 'sí' : 'no';
        out(`Inicio de actividades: ${r.inicioActividades ?? '—'}`);
        out(`Término de giro:       ${r.terminoGiro ?? '—'}`);
        out(`F29 todos los meses desde: ${r.obligadoF29Desde ?? '—'}`);
        out(`Segunda categoría:     ${cat}`);
        out(`Día de vencimiento F29: ${r.diaF29 ?? '—'}`);
      });
    });
}
