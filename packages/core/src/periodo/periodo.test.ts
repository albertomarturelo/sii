import { describe, it, expect } from 'vitest';
import { Periodo } from './periodo.js';
import { ValidationError } from '../errors/index.js';

describe('Periodo', () => {
  it('parses the accepted separators to the same canonical YYYYMM', () => {
    for (const input of ['202606', '2026-06', '2026/06', '2026.06']) {
      const p = Periodo.parse(input);
      expect(p.canonical).toBe('202606');
      expect(p.formatted).toBe('2026-06');
      expect([p.year, p.month]).toEqual([2026, 6]);
    }
  });

  it('accepts a one-digit month when a separator is present', () => {
    for (const input of ['2026-5', '2026/5', '2026.5']) {
      expect(Periodo.parse(input).canonical).toBe('202605');
    }
  });

  it('zero-pads a single-digit month in both forms', () => {
    const p = Periodo.of(2026, 1);
    expect(p.canonical).toBe('202601');
    expect(p.formatted).toBe('2026-01');
  });

  it('rejects a malformed period (wrong length / non-numeric)', () => {
    // `20265` has no separator → must be 6 digits; bare year, 7 digits, letters → invalid.
    for (const bad of ['2026', '20265', '2026013', 'abc', '20-2606', '']) {
      expect(() => Periodo.parse(bad)).toThrow(ValidationError);
    }
  });

  it('rejects an out-of-range month and year', () => {
    expect(() => Periodo.parse('202600')).toThrow(ValidationError); // month 00
    expect(() => Periodo.parse('202613')).toThrow(ValidationError); // month 13
    expect(() => Periodo.of(1999, 6)).toThrow(ValidationError); // year < MIN
    expect(() => Periodo.of(2101, 6)).toThrow(ValidationError); // year > MAX
  });

  it('tryParse returns null instead of throwing on bad input', () => {
    expect(Periodo.tryParse('nope')).toBeNull();
    expect(Periodo.tryParse('202606')?.canonical).toBe('202606');
  });
});
