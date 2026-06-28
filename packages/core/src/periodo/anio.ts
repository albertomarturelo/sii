import { ValidationError } from '../errors/index.js';

// Tax years for the annual surfaces (F22 renta). SII's electronic renta era is
// recent; bound loosely and let SII reject truly out-of-range years server-side.
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** A validated **año tributario** (tax year), canonical `YYYY`. Sibling of `Periodo`
 *  (which is month-granularity, YYYYMM) for the annual surfaces. SII semantics: AT N
 *  reports año comercial N−1's income (AT 2025 = rentas 2024). The value is passed to
 *  SII's `periodo` field verbatim — no adjustment here. */
export class Anio {
  private constructor(readonly value: number) {}

  /** Parse + validate a 4-digit year (string or number). */
  static parse(input: string | number): Anio {
    const s = String(input).trim();
    if (!/^\d{4}$/.test(s)) {
      throw new ValidationError(`Año tributario inválido: "${input}" (esperado YYYY).`);
    }
    return Anio.of(Number(s));
  }

  static of(year: number): Anio {
    if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
      throw new ValidationError(
        `Año tributario fuera de rango: ${year} (${MIN_YEAR}–${MAX_YEAR}).`,
      );
    }
    return new Anio(year);
  }

  static tryParse(input: string | number): Anio | null {
    try {
      return Anio.parse(input);
    } catch {
      return null;
    }
  }

  /** Canonical `YYYY` — what SII's F22 `periodo` field takes. */
  get canonical(): string {
    return String(this.value);
  }
}
