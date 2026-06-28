import { describe, it, expect } from 'vitest';
import { Anio } from './anio.js';
import { ValidationError } from '../errors/index.js';

describe('Anio (año tributario)', () => {
  it('parses a 4-digit year from string or number', () => {
    expect(Anio.parse('2025').canonical).toBe('2025');
    expect(Anio.parse(2025).canonical).toBe('2025');
    expect(Anio.parse(' 2025 ').value).toBe(2025);
  });

  it('rejects non-4-digit / non-numeric input', () => {
    for (const bad of ['25', '20255', 'abc', '2025-01', '']) {
      expect(() => Anio.parse(bad)).toThrow(ValidationError);
    }
  });

  it('rejects an out-of-range year', () => {
    expect(() => Anio.of(1999)).toThrow(ValidationError);
    expect(() => Anio.of(2101)).toThrow(ValidationError);
  });

  it('tryParse returns null instead of throwing', () => {
    expect(Anio.tryParse('nope')).toBeNull();
    expect(Anio.tryParse('2024')?.canonical).toBe('2024');
  });
});
