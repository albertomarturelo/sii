// Shared es-CL presentation helpers for the HUMAN renderings (CLI `--human`,
// MCP resource/tool text). Presentation only — tasks keep returning raw
// JSON-serializable values; that contract is untouched (ADR-012). Hoisted here
// after the same one-liners were copy-pasted across both surfaces.
import { Rut } from '../rut/index.js';

/** es-CL money rendering: thousands-grouped (`12.345.678`), `—` for a missing value. */
export function formatMoney(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('es-CL');
}

/** Canonical RUT (`76192083-9`) → display form with dots + DV (`76.192.083-9`). */
export function formatRut(canonical: string): string {
  return Rut.parse(canonical).formatted;
}
