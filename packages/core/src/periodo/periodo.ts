import { ValidationError } from '../errors/index.js';

// SII's RCV launched Aug 2017; allow a generous margin and let SII reject truly
// out-of-range periods server-side (verbatim). The bounds only catch typos locally.
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** A validated tax period at month granularity. Canonical machine form is `YYYYMM`
 *  (what SII's portal payloads expect, e.g. RCV `ptributario`). In-house — mirrors
 *  the `Rut` primitive's shape (parse / canonical / formatted). */
export class Periodo {
  private constructor(
    readonly year: number,
    readonly month: number,
  ) {}

  /** Parse + validate. Accepts `YYYYMM`, `YYYY-MM`, `YYYY/MM`, `YYYY.MM`. */
  static parse(input: string): Periodo {
    const cleaned = input.replace(/[-/.\s]/g, '');
    if (!/^\d{6}$/.test(cleaned)) {
      throw new ValidationError(`Período inválido: "${input}" (esperado YYYYMM).`);
    }
    return Periodo.of(Number(cleaned.slice(0, 4)), Number(cleaned.slice(4)));
  }

  /** Build from numeric year + month, validating both. */
  static of(year: number, month: number): Periodo {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new ValidationError(`Período con mes inválido: ${month} (esperado 1–12).`);
    }
    if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
      throw new ValidationError(
        `Período con año fuera de rango: ${year} (${MIN_YEAR}–${MAX_YEAR}).`,
      );
    }
    return new Periodo(year, month);
  }

  static tryParse(input: string): Periodo | null {
    try {
      return Periodo.parse(input);
    } catch {
      return null;
    }
  }

  /** Machine form SII expects: `YYYYMM` (e.g. `202606`). */
  get canonical(): string {
    return `${String(this.year).padStart(4, '0')}${String(this.month).padStart(2, '0')}`;
  }

  /** Human form `YYYY-MM` (e.g. `2026-06`). */
  get formatted(): string {
    return `${String(this.year).padStart(4, '0')}-${String(this.month).padStart(2, '0')}`;
  }
}
