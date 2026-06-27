import { ValidationError } from '../errors/index';

const WEIGHT_RESET = 7;

/** Chilean Mod-11 check digit for a RUT body (sii-py ADR-010, in-house). */
function computeDv(body: number): string {
  let sum = 0;
  let multiplier = 2;
  let n = body;
  while (n > 0) {
    sum += (n % 10) * multiplier;
    n = Math.floor(n / 10);
    multiplier = multiplier === WEIGHT_RESET ? 2 : multiplier + 1;
  }
  const r = 11 - (sum % 11);
  if (r === 11) return '0';
  if (r === 10) return 'K';
  return String(r);
}

/** A validated Chilean RUT. Canonical internal form is `<body>-<DV>`. */
export class Rut {
  private constructor(
    readonly body: number,
    readonly dv: string,
  ) {}

  /** Parse + validate. Accepts dotted / spaced / hyphenated input. Throws on a bad DV. */
  static parse(input: string): Rut {
    const cleaned = input.replace(/[.\s-]/g, '').toUpperCase();
    if (cleaned.length < 2) {
      throw new ValidationError(`RUT inválido: "${input}"`);
    }
    const dv = cleaned.slice(-1);
    const bodyStr = cleaned.slice(0, -1);
    if (!/^\d+$/.test(bodyStr) || !/^[0-9K]$/.test(dv)) {
      throw new ValidationError(`RUT inválido: "${input}"`);
    }
    const body = Number(bodyStr);
    const expected = computeDv(body);
    if (expected !== dv) {
      throw new ValidationError(`RUT con DV inválido: "${input}" (esperado -${expected})`);
    }
    return new Rut(body, dv);
  }

  static tryParse(input: string): Rut | null {
    try {
      return Rut.parse(input);
    } catch {
      return null;
    }
  }

  /** Machine-stable form: `<body>-<DV>` (e.g. `78362507-5`). */
  get canonical(): string {
    return `${this.body}-${this.dv}`;
  }

  /** Human form with thousands separators (e.g. `78.362.507-5`). */
  get formatted(): string {
    const dotted = String(this.body).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${dotted}-${this.dv}`;
  }

  equals(other: Rut): boolean {
    return this.body === other.body && this.dv === other.dv;
  }

  toString(): string {
    return this.canonical;
  }
}
